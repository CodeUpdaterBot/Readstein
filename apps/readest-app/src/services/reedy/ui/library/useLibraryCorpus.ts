'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { AISettings } from '@/services/ai/types';
import { openReedy } from '../../db/open';
import { BookIndexer } from '../../retrieval/BookIndexer';
import {
  LibraryIndexer,
  type BookDocLoader,
  type LibraryIndexProgress,
  type LibraryIndexReport,
} from '../../retrieval/LibraryIndexer';
import { createReedyModels } from '../../models/registry';

/**
 * Lifecycle of the library-wide corpus, as the UI needs to see it.
 */
export type LibraryCorpusStatus =
  | { phase: 'loading' }
  /** No corpus built yet — the surface should offer to build one. */
  | { phase: 'empty' }
  | { phase: 'indexing'; progress: LibraryIndexProgress }
  | { phase: 'ready'; works: number; lastIndexedAt: number | null }
  | { phase: 'error'; message: string };

const IDLE_PROGRESS: LibraryIndexProgress = {
  phase: 'resolving',
  bookIndex: 0,
  totalBooks: 0,
  bookTitle: '',
  indexed: 0,
  skipped: 0,
  empty: 0,
  failed: 0,
};

/**
 * Owns the library-wide AI corpus: reads its status from the shared Reedy store
 * and (re)builds it on request by sweeping the live library through
 * {@link LibraryIndexer}.
 *
 * The build is deliberately resumable and backgroundable — status lives per
 * book on `reedy_book_meta`, so re-running indexes only what is new or stale and
 * an interrupted sweep continues where it stopped.
 */
export function useLibraryCorpus({
  appService,
  books,
  aiSettings,
}: {
  appService: AppService | null;
  books: Book[];
  aiSettings: AISettings | undefined;
}) {
  const [status, setStatus] = useState<LibraryCorpusStatus>({ phase: 'loading' });
  const controllerRef = useRef<AbortController | null>(null);
  const models = useMemo(() => (aiSettings ? createReedyModels(aiSettings) : null), [aiSettings]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!appService) return;
    try {
      const { db } = await openReedy(appService);
      const metas = await db.listBookMeta();
      const indexed = metas.filter((m) => m.indexingStatus === 'indexed' && m.chunkCount > 0);
      if (indexed.length === 0) {
        setStatus({ phase: 'empty' });
        return;
      }
      setStatus({
        phase: 'ready',
        works: indexed.length,
        lastIndexedAt: Math.max(0, ...indexed.map((m) => m.indexedAt ?? 0)) || null,
      });
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [appService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const build = useCallback(async (): Promise<LibraryIndexReport | null> => {
    if (!appService || !models) return null;
    // Never run two sweeps at once — they would both write the same tables.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus({ phase: 'indexing', progress: IDLE_PROGRESS });

    // Documents are opened one at a time and released as soon as their book is
    // indexed, so a full-shelf sweep never holds more than a couple of files.
    const opened = new Map<string, { doc: BookDoc; file: unknown }>();
    const release = (hash: string): void => {
      const entry = opened.get(hash);
      if (!entry) return;
      opened.delete(hash);
      const doc = entry.doc as unknown as { destroy?: () => void | Promise<void> };
      void doc.destroy?.();
      const file = entry.file as { close?: () => void | Promise<void> } | null;
      void file?.close?.();
    };

    const load: BookDocLoader = async (book) => {
      const [content, nativeFilePath] = await Promise.all([
        appService.loadBookContent(book),
        appService.resolveNativeBookFilePath(book),
      ]);
      try {
        const bookDoc = (
          await new DocumentLoader(content.file, {
            nativeFilePath: nativeFilePath ?? undefined,
          }).open()
        ).book as BookDoc;
        opened.set(book.hash, { doc: bookDoc, file: content.file });
        return bookDoc;
      } catch (err) {
        const file = content.file as unknown as { close?: () => void | Promise<void> };
        void file.close?.();
        throw err;
      }
    };

    try {
      const { db } = await openReedy(appService);
      const indexer = new LibraryIndexer(db, new BookIndexer(db));
      const report = await indexer.run(books, models.embedding, load, {
        signal: controller.signal,
        onProgress: (progress) => setStatus({ phase: 'indexing', progress }),
        onBookDone: (book) => release(book.hash),
      });
      for (const hash of [...opened.keys()]) release(hash);
      await refresh();
      return report;
    } catch (err) {
      for (const hash of [...opened.keys()]) release(hash);
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [appService, models, books, refresh]);

  return { status, build, cancel, refresh, models };
}
