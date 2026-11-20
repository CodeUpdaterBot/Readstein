'use client';

import { BookOpen } from 'lucide-react';
import type { ReedyMessagePart } from '../../store/reedyStore';

export type CitationPartType = Extract<ReedyMessagePart, { type: 'citation' }>;

/** Handler shape every citation renderer takes. Extra params keep it assignable from `(cfi) => void`. */
export type CitationHandler = (cfi: string, citation: CitationPartType) => void;

/**
 * Citation chip — clickable when an `onClick` handler is wired (the notebook
 * integration passes a handler that calls `getView(bookKey)?.goTo(cfi)`).
 * Static when no handler (e.g. preview rendering in tests).
 *
 * On the library surface a citation also names the work it came from
 * (`bookTitle`), because it may be from any book on the shelf rather than the
 * one open — the handler receives the whole citation so it can open that work.
 */
export function CitationPart({
  part,
  onClick,
}: {
  part: CitationPartType;
  onClick?: CitationHandler;
}) {
  const baseClass =
    'border-base-content/10 bg-base-200/60 my-1 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] text-start';
  const body = (
    <>
      <BookOpen className='text-base-content/60 mt-0.5 size-3 shrink-0' />
      <div className='flex min-w-0 flex-col gap-0.5 text-start'>
        {part.bookTitle ? (
          <div className='text-primary truncate font-medium' title={part.bookTitle}>
            {part.bookTitle}
          </div>
        ) : null}
        <div className={part.bookTitle ? 'text-base-content/70' : 'text-base-content font-medium'}>
          {part.chapterTitle ?? `Section ${part.sectionIndex + 1}`}
        </div>
        <div className='text-base-content/70 line-clamp-3'>{part.snippet}</div>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type='button'
        className={`${baseClass} hover:bg-base-200 transition-colors`}
        onClick={() => onClick(part.cfi, part)}
        title={part.bookTitle ? `${part.bookTitle} — ${part.cfi}` : part.cfi}
      >
        {body}
      </button>
    );
  }
  return <div className={baseClass}>{body}</div>;
}
