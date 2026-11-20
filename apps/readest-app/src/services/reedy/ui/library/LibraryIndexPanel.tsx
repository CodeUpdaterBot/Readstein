'use client';

import { BookOpenIcon, Loader2Icon, LibraryBig, RotateCw, TriangleAlert } from 'lucide-react';
import type { LibraryCorpusStatus } from './useLibraryCorpus';

/**
 * Corpus status + build action for the library chat (the library-scope analogue
 * of the reader's `IndexingStatus`). Matching the app's existing language: the
 * same `btn btn-primary btn-sm`, `bg-base-200` track and `/60` muted text the
 * reader's indexing panel uses.
 */
export function LibraryIndexPanel({
  status,
  workCount,
  onBuild,
  onCancel,
}: {
  status: LibraryCorpusStatus;
  /** Live library size, shown before a corpus exists. */
  workCount: number;
  onBuild: () => void;
  onCancel: () => void;
}) {
  if (status.phase === 'loading') {
    return (
      <Centered>
        <Loader2Icon className='text-primary size-6 animate-spin' />
      </Centered>
    );
  }

  if (status.phase === 'indexing') {
    const { progress } = status;
    const chunk = progress.chunkProgress;
    // The bar tracks the book in flight (reading pages, then embedding them) so
    // a large PDF visibly moves; the works counter above gives overall position.
    const bookPct = chunk && chunk.total > 0 ? Math.round((chunk.current / chunk.total) * 100) : 0;
    const worksPct =
      progress.totalBooks > 0 ? Math.round((progress.bookIndex / progress.totalBooks) * 100) : 0;
    const pct = chunk ? bookPct : worksPct;
    return (
      <Centered>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <div className='text-center'>
          <p className='text-base-content mb-1 text-sm font-medium'>Building your library index…</p>
          <p className='text-base-content/60 max-w-[16rem] truncate text-xs'>
            {progress.bookTitle || 'Resolving works…'}
          </p>
          <p className='text-base-content/60 mt-0.5 text-xs'>
            {progress.bookIndex} / {progress.totalBooks} works
          </p>
          {chunk ? (
            <p className='text-base-content/50 mt-0.5 text-[11px] tabular-nums'>
              {chunk.phase === 'chunking' ? 'Reading pages' : 'Embedding'}: {chunk.current} /{' '}
              {chunk.total}
            </p>
          ) : null}
        </div>
        <div className='bg-base-200 h-1.5 w-40 overflow-hidden rounded-full'>
          <div
            className='bg-primary h-full transition-all duration-300'
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className='text-base-content/50 flex gap-3 text-[11px]'>
          <span>{progress.indexed} indexed</span>
          <span>{progress.skipped} up to date</span>
          {progress.empty > 0 && <span>{progress.empty} no text</span>}
          {progress.failed > 0 && <span>{progress.failed} failed</span>}
        </div>
        {progress.notice ? (
          <p className='text-base-content/60 max-w-[19rem] text-[11px]'>{progress.notice}</p>
        ) : null}
        {progress.lastError ? (
          <div className='max-w-[20rem]'>
            <p className='text-base-content/50 mb-0.5 text-[10px] uppercase'>Last error</p>
            <p className='text-red-600 text-[11px] break-words'>{progress.lastError}</p>
          </div>
        ) : null}
        <button className='btn btn-ghost btn-xs text-xs' onClick={onCancel}>
          Stop
        </button>
      </Centered>
    );
  }

  if (status.phase === 'error') {
    return (
      <Centered>
        <div className='bg-warning/10 rounded-full p-3'>
          <TriangleAlert className='text-warning size-6' />
        </div>
        <div className='text-center'>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>Indexing failed</h3>
          <p className='text-base-content/60 max-w-[18rem] text-xs'>{status.message}</p>
        </div>
        <button className='btn btn-outline btn-sm h-8 text-xs' onClick={onBuild}>
          <RotateCw className='me-1.5 size-3.5' />
          Try again
        </button>
      </Centered>
    );
  }

  if (status.phase === 'ready') {
    return (
      <Centered>
        <div className='bg-primary/10 rounded-full p-3'>
          <LibraryBig className='text-primary size-6' />
        </div>
        <div className='text-center'>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>
            {status.works} work{status.works === 1 ? '' : 's'} indexed
          </h3>
          <p className='text-base-content/60 max-w-[18rem] text-xs'>
            Your whole library is searchable as one corpus.
          </p>
        </div>
        <button className='btn btn-ghost btn-xs text-xs' onClick={onBuild}>
          <RotateCw className='me-1.5 size-3.5' />
          Update index
        </button>
      </Centered>
    );
  }

  // empty
  return (
    <Centered>
      <div className='bg-primary/10 rounded-full p-3'>
        <BookOpenIcon className='text-primary size-6' />
      </div>
      <div className='text-center'>
        <h3 className='text-base-content mb-0.5 text-sm font-medium'>Build your library index</h3>
        <p className='text-base-content/60 mx-auto max-w-[20rem] text-xs'>
          Turn your {workCount} book{workCount === 1 ? '' : 's'} into one searchable corpus so you
          can ask across all of them. English works only; it runs in the background and resumes if
          interrupted.
        </p>
      </div>
      <button className='btn btn-primary btn-sm h-8 text-xs' onClick={onBuild}>
        <LibraryBig className='me-1.5 size-3.5' />
        Start indexing
      </button>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
      {children}
    </div>
  );
}
