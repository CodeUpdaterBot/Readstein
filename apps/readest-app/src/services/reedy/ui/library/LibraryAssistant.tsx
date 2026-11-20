'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, X } from 'lucide-react';
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
import { useReedyStore } from '../../store/reedyStore';
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
  const resetStore = useReedyStore((s) => s.reset);
  const { send, abort } = useReedyTurn(runtime);

  // One conversation, reset when the surface is (re)opened.
  useEffect(() => {
    resetStore();
  }, [resetStore]);

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
    <div className='border-base-content/10 bg-base-100 flex h-full w-full flex-col border-s'>
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
    </div>
  );
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
