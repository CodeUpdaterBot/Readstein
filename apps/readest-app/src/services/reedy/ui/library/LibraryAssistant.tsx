'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Maximize2, Minimize2, RotateCw, X } from 'lucide-react';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { AISettings } from '@/services/ai/types';
import { AgentRuntime } from '../../runtime/AgentRuntime';
import { BookRetriever } from '../../retrieval/BookRetriever';
import { LibraryIndexer } from '../../retrieval/LibraryIndexer';
import { openReedy } from '../../db/open';
import { createReedyModels } from '../../models/registry';
import { ToolRegistry } from '../../tools/ToolRegistry';
import { createLookupLibraryPassageTool } from '../../tools/builtins';
import {
  LIBRARY_POLICY,
  createLibraryLayer,
  createPolicyLayer,
  createToolCatalogLayer,
  type LibraryManifest,
} from '../../context';
import { useReedyStore, type ReedyMessage } from '../../store/reedyStore';
import { ConversationList } from './ConversationList';
import type { ConversationSummary } from '../../db/ReedyDb';
import { useReedyTurn } from '../useReedyTurn';
import { AgentThread } from '../AgentThread';
import { Composer } from '../Composer';
import type { CitationPartType } from '../parts/CitationPart';
import { LibraryIndexPanel } from './LibraryIndexPanel';
import { useLibraryCorpus } from './useLibraryCorpus';

/** One session id for the library conversation (the analogue of a book hash). */
export const LIBRARY_SESSION_ID = 'library';

/** Cap on the works named to the agent in its shelf manifest. */
const MANIFEST_SAMPLE_LIMIT = 80;

export interface LibraryAssistantProps {
  appService: AppService | null;
  books: Book[];
  aiSettings: AISettings | undefined;
  /** Open a cited work at a CFI (null/absent book hash → the citation's own work). */
  onOpenCitation: (bookHash: string | null, cfi: string) => void;
  onClose: () => void;
  /** The pane is at full width. The parent owns the resize state. */
  expanded?: boolean;
  onToggleExpand?: () => void;
}

/**
 * The library-wide AI chat: one conversation across every indexed work on the
 * shelf.
 *
 * Structured like the reader's `ReedyAssistant` — same store, same runtime, same
 * thread and composer — but scoped to the library instead of a single book: the
 * tool is `lookupLibraryPassage`, the prompt carries the shelf manifest rather
 * than a reading position, and a citation names the work it came from so it can
 * be opened in the reader.
 */
export function LibraryAssistant({
  appService,
  books,
  aiSettings,
  onOpenCitation,
  onClose,
  expanded,
  onToggleExpand,
}: LibraryAssistantProps) {
  const models = useMemo(() => (aiSettings ? createReedyModels(aiSettings) : null), [aiSettings]);
  const [ready, setReady] = useState<{ db: ReedyDbLike; retriever: BookRetriever } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const { status, build, cancel } = useLibraryCorpus({ appService, books, aiSettings });

  // The index panel is the only place the build can be started or stopped, so
  // it must stay reachable once a corpus exists — a partial corpus is a normal
  // state ("3 of 261 works") and the user needs a way back to it. Reaching
  // 'ready' hands the surface back to the conversation; a failure keeps the
  // panel so its "Try again" is reachable.
  const [showIndex, setShowIndex] = useState(false);
  useEffect(() => {
    if (status.phase === 'ready') setShowIndex(false);
  }, [status.phase]);

  useEffect(() => {
    if (!appService) return;
    let alive = true;
    void openReedy(appService)
      .then(({ db }) => {
        if (!alive) return;
        setReady({ db, retriever: new BookRetriever(db) });
      })
      .catch((err) => {
        if (alive) setOpenError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [appService]);

  // Shelf manifest read at prompt-build time via a ref, so the runtime memo
  // doesn't rebuild on every corpus-status change.
  const manifestRef = useRef<LibraryManifest>({ workCount: 0, sampleTitles: [], empty: true });
  useEffect(() => {
    manifestRef.current = {
      workCount: status.phase === 'ready' ? status.works : 0,
      sampleTitles: sampleWorkTitles(books),
      empty: status.phase !== 'ready',
    };
  }, [status, books]);

  const runtime = useMemo(() => {
    if (!ready || !models) return null;
    const reg = new ToolRegistry();
    reg.register(
      createLookupLibraryPassageTool({
        retriever: ready.retriever,
        activeEmbeddingModel: models.embedding,
      }),
    );
    const layers = [
      createPolicyLayer(LIBRARY_POLICY),
      createLibraryLayer(() => manifestRef.current),
      createToolCatalogLayer(reg.list()),
    ];
    return new AgentRuntime({ model: models.chat, tools: reg, layers });
  }, [ready, models]);

  const messages = useReedyStore((s) => s.messages);
  const isRunning = useReedyStore((s) => s.isRunning);
  const setMessages = useReedyStore((s) => s.setMessages);
  const { send, abort } = useReedyTurn(runtime);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Read inside the save effect without making it a dependency (which would
  // re-run the save on every list refresh).
  const conversationsRef = useRef<ConversationSummary[]>([]);

  const refreshConversations = useCallback(async () => {
    if (!ready) return;
    const list = await ready.db.listConversations();
    conversationsRef.current = list;
    setConversations(list);
  }, [ready]);

  // Resume the most recent conversation when the pane opens, or start one.
  // Closing the pane used to throw the thread away.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      const list = await ready.db.listConversations();
      if (!alive) return;
      conversationsRef.current = list;
      setConversations(list);
      const latest = list[0];
      if (latest) {
        setConversationId(latest.id);
        const stored = (await ready.db.loadConversationMessages(latest.id)) as ReedyMessage[];
        if (alive) setMessages(stored);
      } else {
        const id = newConversationId();
        await ready.db.createConversation(id, null);
        if (!alive) return;
        setConversationId(id);
        setMessages([]);
        await refreshConversations();
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, setMessages, refreshConversations]);

  // Persist as the thread grows, debounced so a streaming answer is not written
  // once per token. The title comes from the first thing the user asked, and is
  // only set while the conversation has none — a rename stays a rename.
  useEffect(() => {
    if (!ready || !conversationId || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      void ready.db
        .saveConversationMessages(conversationId, messages)
        .then(async () => {
          const current = conversationsRef.current.find((c) => c.id === conversationId);
          const title = titleOf(messages.find((m) => m.role === 'user'));
          if (title && !current?.title) {
            await ready.db.renameConversation(conversationId, title);
          }
          await refreshConversations();
        })
        .catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [ready, conversationId, messages, refreshConversations]);

  const openConversation = useCallback(
    async (id: string) => {
      if (!ready) return;
      setConversationId(id);
      setMessages((await ready.db.loadConversationMessages(id)) as ReedyMessage[]);
      setShowHistory(false);
    },
    [ready, setMessages],
  );

  const newConversation = useCallback(async () => {
    if (!ready) return;
    const id = newConversationId();
    await ready.db.createConversation(id, null);
    setConversationId(id);
    setMessages([]);
    setShowHistory(false);
    await refreshConversations();
  }, [ready, setMessages, refreshConversations]);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      if (!ready) return;
      await ready.db.renameConversation(id, title);
      await refreshConversations();
    },
    [ready, refreshConversations],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!ready) return;
      await ready.db.deleteConversation(id);
      const list = await ready.db.listConversations();
      conversationsRef.current = list;
      setConversations(list);
      if (id !== conversationId) return;
      const next = list[0];
      if (next) {
        setConversationId(next.id);
        setMessages((await ready.db.loadConversationMessages(next.id)) as ReedyMessage[]);
      } else {
        await newConversation();
      }
    },
    [ready, conversationId, setMessages, newConversation],
  );

  const handleSend = useCallback(
    (text: string) => {
      if (!runtime) return;
      void send({
        sessionId: LIBRARY_SESSION_ID,
        bookHash: LIBRARY_SESSION_ID,
        userMessage: text,
      });
    },
    [runtime, send],
  );

  const handleCitation = useCallback(
    (cfi: string, citation: CitationPartType) => {
      onOpenCitation(citation.bookHash ?? null, cfi);
    },
    [onOpenCitation],
  );

  return (
    <div className='border-base-content/10 bg-base-100 relative flex h-full w-full flex-col border-s'>
      <div className='border-base-content/10 flex shrink-0 items-center justify-between border-b px-3 py-2'>
        <div className='flex min-w-0 flex-col'>
          <span className='text-base-content text-sm font-medium'>Your library</span>
          <span className='text-base-content/50 truncate text-[11px]'>
            {status.phase === 'ready'
              ? status.expected > status.works
                ? `${status.works} of ${status.expected} works indexed`
                : `${status.works} work${status.works === 1 ? '' : 's'} searchable`
              : 'Ask across every book you hold'}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-0.5'>
          <button
            type='button'
            onClick={() => setShowHistory((v) => !v)}
            aria-label='Conversations'
            title='Conversations'
            className='text-base-content/50 hover:text-base-content touch-target flex size-7 items-center justify-center rounded-full'
          >
            <History className='size-4' />
          </button>
          {onToggleExpand ? (
            <button
              type='button'
              onClick={onToggleExpand}
              aria-label={expanded ? 'Restore chat width' : 'Expand chat to full window'}
              title={expanded ? 'Restore width' : 'Full window'}
              className='text-base-content/50 hover:text-base-content touch-target flex size-7 items-center justify-center rounded-full'
            >
              {expanded ? <Minimize2 className='size-4' /> : <Maximize2 className='size-4' />}
            </button>
          ) : null}
          {status.phase === 'ready' ? (
            <button
              type='button'
              onClick={() => setShowIndex((open) => !open)}
              aria-label='Library index status'
              title={
                showIndex
                  ? 'Back to chat'
                  : status.expected > status.works
                    ? `Index status — ${status.expected - status.works} works left to index`
                    : 'Index status'
              }
              className='text-base-content/50 hover:text-base-content touch-target flex size-7 items-center justify-center rounded-full'
            >
              <RotateCw className='size-4' />
            </button>
          ) : null}
          <button
            type='button'
            onClick={onClose}
            aria-label='Close library chat'
            title='Close'
            className='text-base-content/50 hover:text-base-content touch-target flex size-7 items-center justify-center rounded-full'
          >
            <X className='size-4' />
          </button>
        </div>
      </div>

      {!aiSettings?.enabled ? (
        <CenteredNote>Enable AI in Settings to chat with your library.</CenteredNote>
      ) : openError ? (
        <CenteredNote>{openError}</CenteredNote>
      ) : !ready ? (
        <CenteredNote>Loading…</CenteredNote>
      ) : status.phase !== 'ready' || showIndex ? (
        <LibraryIndexPanel
          status={status}
          workCount={books.length}
          onBuild={() => void build()}
          onCancel={cancel}
        />
      ) : (
        <>
          <div className='min-h-0 flex-1'>
            <AgentThread
              messages={messages}
              isRunning={isRunning}
              onSourceClick={handleCitation}
              emptyState={
                <div className='text-base-content/60 flex flex-col gap-1 px-6 text-center text-sm'>
                  <span>Ask your library anything.</span>
                  <span className='text-base-content/45 text-xs'>
                    Answers are drawn from your books and cite the work they came from.
                  </span>
                </div>
              }
            />
          </div>
          <Composer
            isRunning={isRunning}
            onSend={handleSend}
            onAbort={abort}
            placeholder='Ask your library…'
          />
        </>
      )}

      {/* History slides in over the thread rather than resizing it, so switching
          conversations never reflows the message you were reading. */}
      {showHistory ? (
        <div className='absolute inset-0 z-20 flex'>
          <ConversationList
            conversations={conversations}
            currentId={conversationId}
            onSelect={(id) => void openConversation(id)}
            onNew={() => void newConversation()}
            onRename={(id, title) => void renameConversation(id, title)}
            onDelete={(id) => void deleteConversation(id)}
          />
          <button
            type='button'
            aria-label='Close conversations'
            onClick={() => setShowHistory(false)}
            className='flex-1 bg-black/20'
          />
        </div>
      ) : null}
    </div>
  );
}

/** A fresh conversation id — nothing server-side mints one. */
function newConversationId(): string {
  return `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A conversation's name: the first thing the user asked. */
function titleOf(message: ReedyMessage | undefined): string | null {
  if (!message || message.role !== 'user') return null;
  const text = (message as { text?: string }).text?.trim() ?? '';
  if (!text) return null;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** The ReedyDb type is structural here; imported lazily to keep the import list flat. */
type ReedyDbLike = Awaited<ReturnType<typeof openReedy>>['db'];

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-full items-center justify-center p-4'>
      <p className='text-base-content/60 max-w-xs text-center text-sm'>{children}</p>
    </div>
  );
}

/**
 * Titles for the agent's shelf manifest — the deduplicated English works, i.e.
 * exactly what the corpus holds, capped so the prompt stays bounded.
 */
function sampleWorkTitles(books: Book[]): string[] {
  const titles = LibraryIndexer.toCandidates(books)
    .filter((c) => (c.language ?? '').toLowerCase().startsWith('en'))
    .map((c) => c.title)
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of titles) {
    const key = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= MANIFEST_SAMPLE_LIMIT) break;
  }
  return out;
}
