'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Component, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAssistantRuntime,
  type ThreadMessage,
  type ThreadHistoryAdapter,
} from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { aiLogger, createTauriAdapter } from '@/services/ai';
import {
  LegacyIdbBackend,
  ReedyBackend,
  ReedySourceStore,
  selectBackend,
  type RetrievalBackend,
  type SourceItem,
} from '@/services/ai/adapters';
import type { EmbeddingProgress, AISettings, AIMessage } from '@/services/ai/types';
import type { RetrievedChunk } from '@/services/reedy/retrieval/BookRetriever';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import { ReedyAssistant } from '@/services/reedy/ui/ReedyAssistant';
import type { ReadingContextSnapshot } from '@/services/reedy/tools/builtins/types';

import { Button } from '@/components/ui/button';
import { Loader2Icon, BookOpenIcon } from 'lucide-react';
import { Thread } from '@/components/assistant/Thread';

const INDEX_STATUS_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class ChatRuntimeBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
          <p className='text-foreground text-sm font-medium'>AI chat failed to start</p>
          <p className='text-muted-foreground max-w-xs text-xs'>{this.state.error.message}</p>
          <Button size='sm' className='h-8 text-xs' onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Helper function to convert AIMessage array to ExportedMessageRepository format
// Each message needs to be wrapped with { message, parentId } structure
function convertToExportedMessages(
  aiMessages: AIMessage[],
): { message: ThreadMessage; parentId: string | null }[] {
  return aiMessages.map((msg, idx) => {
    const baseMessage = {
      id: msg.id,
      content: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
      metadata: { custom: {} },
    };

    // Build role-specific message to satisfy ThreadMessage union type
    const threadMessage: ThreadMessage =
      msg.role === 'user'
        ? ({
            ...baseMessage,
            role: 'user' as const,
            attachments: [] as const,
          } as unknown as ThreadMessage)
        : ({
            ...baseMessage,
            role: 'assistant' as const,
            status: { type: 'complete' as const, reason: 'stop' as const },
          } as unknown as ThreadMessage);

    return {
      message: threadMessage,
      parentId: idx > 0 ? (aiMessages[idx - 1]?.id ?? null) : null,
    };
  });
}

interface AIAssistantProps {
  bookKey: string;
}

// inner component that uses the runtime hook
const AIAssistantChat = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  currentPage,
  backend,
  sourceStore,
  currentTurnId,
  setCurrentTurnId,
  onSourceClick,
  onResetIndex,
  onDisableSpoilerProtection,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  currentPage: number;
  backend: RetrievalBackend;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  setCurrentTurnId: (id: string) => void;
  onSourceClick?: (source: SourceItem) => void;
  onResetIndex: () => void;
  onDisableSpoilerProtection: () => void;
}) => {
  const {
    activeConversationId,
    messages: storedMessages,
    addMessage,
    isLoadingHistory,
  } = useAIChatStore();

  // use a ref to keep up-to-date options without triggering re-renders of the runtime
  const optionsRef = useRef({
    settings: aiSettings,
    bookHash,
    bookTitle,
    authorName,
    currentPage,
    backend,
    sourceStore,
    onTurnStart: setCurrentTurnId,
  });

  // update ref on every render with latest values
  useEffect(() => {
    optionsRef.current = {
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      currentPage,
      backend,
      sourceStore,
      onTurnStart: setCurrentTurnId,
    };
  });

  const storedMessagesRef = useRef(storedMessages);
  storedMessagesRef.current = storedMessages;
  const conversationIdRef = useRef(activeConversationId);
  conversationIdRef.current = activeConversationId;

  // create adapter ONCE and keep it stable
  const adapter = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- intentional: we read optionsRef inside a deferred callback, not during render
    return createTauriAdapter(() => optionsRef.current);
  }, []);

  // Create history adapter to load/persist messages. Identity is tied to the
  // conversation id only — recreating it on every storedMessages change made
  // useLocalRuntime reload an empty thread and hide the composer.
  const historyAdapter = useMemo<ThreadHistoryAdapter | undefined>(() => {
    if (!activeConversationId) return undefined;

    return {
      async load() {
        return {
          messages: convertToExportedMessages(storedMessagesRef.current),
        };
      },
      async append(item) {
        const msg = item.message;
        const conversationId = conversationIdRef.current;
        if (conversationId && msg.role !== 'system') {
          const textContent = msg.content
            .filter(
              (part): part is { type: 'text'; text: string } =>
                'type' in part && part.type === 'text',
            )
            .map((part) => part.text)
            .join('\n');

          if (textContent) {
            await addMessage({
              conversationId,
              role: msg.role as 'user' | 'assistant',
              content: textContent,
            });
          }
        }
      },
    };
  }, [activeConversationId, addMessage]);

  return (
    <AIAssistantWithRuntime
      adapter={adapter}
      historyAdapter={historyAdapter}
      onResetIndex={onResetIndex}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={!!activeConversationId}
      sourceStore={sourceStore}
      currentTurnId={currentTurnId}
      onSourceClick={onSourceClick}
      spoilerProtection={aiSettings.spoilerProtection}
      onDisableSpoilerProtection={onDisableSpoilerProtection}
    />
  );
};

const AIAssistantWithRuntime = ({
  adapter,
  historyAdapter,
  onResetIndex,
  isLoadingHistory,
  hasActiveConversation,
  sourceStore,
  currentTurnId,
  onSourceClick,
  spoilerProtection,
  onDisableSpoilerProtection,
}: {
  adapter: NonNullable<ReturnType<typeof createTauriAdapter>>;
  historyAdapter?: ThreadHistoryAdapter;
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  onSourceClick?: (source: SourceItem) => void;
  spoilerProtection: boolean;
  onDisableSpoilerProtection: () => void;
}) => {
  const runtime = useLocalRuntime(adapter, {
    adapters: historyAdapter ? { history: historyAdapter } : undefined,
  });

  if (!runtime) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
      </div>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadWrapper
        onResetIndex={onResetIndex}
        isLoadingHistory={isLoadingHistory}
        hasActiveConversation={hasActiveConversation}
        sourceStore={sourceStore}
        currentTurnId={currentTurnId}
        onSourceClick={onSourceClick}
        spoilerProtection={spoilerProtection}
        onDisableSpoilerProtection={onDisableSpoilerProtection}
      />
    </AssistantRuntimeProvider>
  );
};

const ThreadWrapper = ({
  onResetIndex,
  isLoadingHistory,
  hasActiveConversation,
  sourceStore,
  currentTurnId,
  onSourceClick,
  spoilerProtection,
  onDisableSpoilerProtection,
}: {
  onResetIndex: () => void;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  sourceStore: ReedySourceStore;
  currentTurnId: string | null;
  onSourceClick?: (source: SourceItem) => void;
  spoilerProtection: boolean;
  onDisableSpoilerProtection: () => void;
}) => {
  const [sources, setSources] = useState<RetrievedChunk[]>(
    currentTurnId ? sourceStore.get(currentTurnId) : [],
  );
  const assistantRuntime = useAssistantRuntime();
  const { setActiveConversation } = useAIChatStore();

  // Subscribe to the active turn's slot in the source store. Replaces the
  // pre-Reedy 500ms poll over a module-global lastSources (per plan §M1.7).
  useEffect(() => {
    if (!currentTurnId) {
      setSources([]);
      return;
    }
    setSources(sourceStore.get(currentTurnId));
    return sourceStore.subscribe(currentTurnId, setSources);
  }, [currentTurnId, sourceStore]);

  const handleClear = useCallback(() => {
    sourceStore.clear();
    setSources([]);
    setActiveConversation(null);
    assistantRuntime.switchToNewThread();
  }, [assistantRuntime, setActiveConversation, sourceStore]);

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <Thread
        sources={sources}
        onSourceClick={onSourceClick}
        onClear={handleClear}
        onResetIndex={onResetIndex}
        isLoadingHistory={isLoadingHistory}
        hasActiveConversation={hasActiveConversation}
        spoilerProtection={spoilerProtection}
        onDisableSpoilerProtection={onDisableSpoilerProtection}
      />
    </div>
  );
};

/**
 * Phase 4.3 router. Switches between the legacy / Reedy-MVP path
 * (LegacyAIAssistant) and the Phase 4 agent-runtime path
 * (ReedyAgentAssistantBridge) based on aiSettings.reedy.runtime.
 *
 * The split is at component boundary rather than inside one component
 * so hooks always run in stable order on whichever path is rendered.
 */
const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const bookData = getBookData(bookKey);

  const reedyRuntime = settings?.aiSettings?.reedy?.runtime ?? 'mvp';
  const useAgentRuntime =
    settings?.aiSettings?.enabled === true &&
    settings?.aiSettings?.reedy?.enabled === true &&
    reedyRuntime === 'agent' &&
    !!appService &&
    isTauriAppPlatform() &&
    !!bookData?.bookDoc;

  if (useAgentRuntime) return <ReedyAgentAssistantBridge bookKey={bookKey} />;
  return <LegacyAIAssistant bookKey={bookKey} />;
};

const AIAssistantRoot = ({ bookKey }: AIAssistantProps) => {
  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <ChatRuntimeBoundary>
        <AIAssistant bookKey={bookKey} />
      </ChatRuntimeBoundary>
    </div>
  );
};

const LegacyAIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const bookData = getBookData(bookKey);
  // Reactive: chat context follows the user's current reading position.
  const progress = useBookProgress(bookKey);

  const [isLoading, setIsLoading] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexed, setIndexed] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const currentPage = progress?.pageinfo?.current ?? 0;
  const aiSettings = settings?.aiSettings;

  // Per-instance source store, plus the active backend chosen via the same
  // selectBackend gate the chat adapter will hit (Reedy on Tauri when
  // enabled; legacy IDB otherwise).
  const sourceStore = useMemo(() => new ReedySourceStore(), []);
  const backend = useMemo<RetrievalBackend | null>(() => {
    if (!aiSettings) return null;
    const legacy = new LegacyIdbBackend(aiSettings);
    const useReedy = !!aiSettings.reedy?.enabled && !!appService && isTauriAppPlatform();
    const reedy: RetrievalBackend | null = useReedy
      ? new ReedyBackend(appService as AppService, aiSettings)
      : null;
    return selectBackend({ settings: aiSettings, isTauri: isTauriAppPlatform(), legacy, reedy });
  }, [aiSettings, appService]);

  // check if book is indexed on mount
  useEffect(() => {
    let cancelled = false;
    if (!bookHash || !backend) {
      setIsLoading(false);
      return;
    }
    withTimeout(
      backend.isIndexed(bookHash),
      INDEX_STATUS_TIMEOUT_MS,
      'Timed out while checking whether this book is indexed',
    )
      .then((result) => {
        if (cancelled) return;
        setIndexed(result);
        setIsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        aiLogger.rag.indexError(bookHash, (e as Error).message);
        setIndexError((e as Error).message);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookHash, backend]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings || !backend) return;
    setIsIndexing(true);
    setIndexError(null);
    try {
      await backend.indexBook(bookData.bookDoc, bookHash, { onProgress: setIndexProgress });
      setIndexed(true);
    } catch (e) {
      const message = (e as Error).message || String(e);
      aiLogger.rag.indexError(bookHash, message);
      setIndexError(message);
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [bookData?.bookDoc, bookHash, aiSettings, backend]);

  const handleResetIndex = useCallback(async () => {
    if (!appService || !backend) return;
    if (!(await appService.ask(_('Are you sure you want to re-index this book?')))) return;
    await backend.clearBook(bookHash);
    setIndexed(false);
  }, [bookHash, appService, backend, _]);

  const handleDisableSpoilerProtection = useCallback(async () => {
    if (!settings?.aiSettings) return;
    const newSettings = {
      ...settings,
      aiSettings: {
        ...settings.aiSettings,
        spoilerProtection: false,
        spoilerDefaultMigrated: true,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  }, [settings, setSettings, saveSettings, envConfig]);

  // Navigate the reader to a clicked source's CFI. Legacy backend chunks have
  // no CFI so the Thread component renders them as static rows — only Reedy
  // sources are clickable in M1.10.
  const handleSourceClick = useCallback(
    (source: SourceItem) => {
      if (!source.cfi) return;
      getView(bookKey)?.goTo(source.cfi);
    },
    [bookKey, getView],
  );

  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-muted-foreground text-sm'>{_('Enable AI in Settings')}</p>
      </div>
    );
  }

  // Checking index status used to return null, which left the Notebook pane
  // completely empty after New Chat / conversation click.
  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
      </div>
    );
  }

  const progressPercent =
    indexProgress?.phase === 'embedding' && indexProgress.total > 0
      ? Math.round((indexProgress.current / indexProgress.total) * 100)
      : 0;

  if (!indexed && !isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-primary/10 rounded-full p-3'>
          <BookOpenIcon className='text-primary size-6' />
        </div>
        <div>
          <h3 className='text-foreground mb-0.5 text-sm font-medium'>{_('Index This Book')}</h3>
          <p className='text-muted-foreground text-xs'>
            {_('Enable AI search and chat for this book')}
          </p>
        </div>
        <Button onClick={handleIndex} size='sm' className='h-8 text-xs'>
          <BookOpenIcon className='mr-1.5 size-3.5' />
          {_('Start Indexing')}
        </Button>
        {indexError ? <p className='text-red-600 max-w-xs text-xs'>{indexError}</p> : null}
      </div>
    );
  }

  if (isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <div>
          <p className='text-foreground mb-1 text-sm font-medium'>{_('Indexing book...')}</p>
          <p className='text-muted-foreground text-xs'>
            {indexProgress?.phase === 'embedding'
              ? `${indexProgress.current} / ${indexProgress.total} chunks`
              : _('Preparing...')}
          </p>
        </div>
        <div className='bg-muted h-1.5 w-32 overflow-hidden rounded-full'>
          <div
            className='bg-primary h-full transition-all duration-300'
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  if (!backend) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-muted-foreground text-sm'>{_('AI backend is unavailable')}</p>
      </div>
    );
  }

  return (
    <AIAssistantChat
      aiSettings={aiSettings}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      currentPage={currentPage}
      backend={backend}
      sourceStore={sourceStore}
      currentTurnId={currentTurnId}
      setCurrentTurnId={setCurrentTurnId}
      onSourceClick={handleSourceClick}
      onResetIndex={handleResetIndex}
      onDisableSpoilerProtection={handleDisableSpoilerProtection}
    />
  );
};

/**
 * Bridge from the notebook AI tab into the Phase 4 ReedyAssistant.
 *
 * Kept separate from AIAssistant so legacy props/state don't leak in
 * and we don't pay the cost of constructing the agent runtime when the
 * user is on the MVP path. The flag check in AIAssistant guarantees this
 * only renders when aiSettings.reedy.runtime === 'agent'.
 */
const ReedyAgentAssistantBridge = ({ bookKey }: AIAssistantProps) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const bookData = getBookData(bookKey);
  // Reactive: agent runtime needs the latest reading position to seed
  // tool calls.
  const progress = useBookProgress(bookKey);

  const bookHash = bookKey.split('-')[0] || '';
  const aiSettings = settings?.aiSettings;

  const readingContext = useMemo<ReadingContextSnapshot>(
    () => ({
      cfi: progress?.location ?? null,
      sectionIndex: progress?.section?.current ?? 0,
      chapterTitle: progress?.sectionLabel ?? null,
      pageNumber: progress?.pageinfo?.current ?? 0,
    }),
    [progress],
  );

  const handleNavigate = useCallback(
    (cfi: string) => {
      getView(bookKey)?.goTo(cfi);
    },
    [bookKey, getView],
  );

  if (!aiSettings || !appService || !bookData?.bookDoc) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-muted-foreground text-sm'>Open a book to use AI chat.</p>
      </div>
    );
  }

  return (
    <ReedyAssistant
      appService={appService as AppService}
      bookDoc={bookData.bookDoc}
      bookHash={bookHash}
      bookKey={bookKey}
      aiSettings={aiSettings}
      readingContext={readingContext}
      onNavigateToCfi={handleNavigate}
    />
  );
};

export default AIAssistantRoot;
