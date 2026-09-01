import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { hostCoverNeedsPull, isLanHomeMirrorableBook } from '@/services/lanHome/mirror';

const book = (overrides: Partial<Book> = {}): Book =>
  ({
    hash: 'abc',
    format: 'EPUB',
    title: 'A Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Book;

describe('lan home mirror helpers', () => {
  it('pulls a cover when the phone has none', () => {
    expect(
      hostCoverNeedsPull({ hasCover: true, coverHash: 'aaa' }, { coverHash: null }, false),
    ).toBe(true);
  });

  it('pulls a cover when the host hash differs', () => {
    expect(
      hostCoverNeedsPull(
        { hasCover: true, coverHash: 'new' },
        { coverHash: 'old', coverUpdatedAt: 9 },
        true,
      ),
    ).toBe(true);
  });

  it('skips a cover when the content hash already matches', () => {
    expect(
      hostCoverNeedsPull(
        { hasCover: true, coverHash: 'same', coverMtime: 999 },
        { coverHash: 'same', coverUpdatedAt: 1 },
        true,
      ),
    ).toBe(false);
  });

  it('falls back to cover mtime when the host has no hash yet', () => {
    expect(
      hostCoverNeedsPull(
        { hasCover: true, coverMtime: 200 },
        { coverHash: 'local', coverUpdatedAt: 100 },
        true,
      ),
    ).toBe(true);
    expect(
      hostCoverNeedsPull(
        { hasCover: true, coverMtime: 50 },
        { coverHash: 'local', coverUpdatedAt: 100 },
        true,
      ),
    ).toBe(false);
  });

  it('does not pull when the host has no cover', () => {
    expect(hostCoverNeedsPull({ hasCover: false }, { coverHash: null }, false)).toBe(false);
  });

  it('leaves OPDS / ABS stubs out of the desktop mirror', () => {
    expect(isLanHomeMirrorableBook(book())).toBe(true);
    expect(isLanHomeMirrorableBook(book({ url: 'https://opds.example/book' }))).toBe(false);
    expect(isLanHomeMirrorableBook(book({ absMediaType: 'podcast' }))).toBe(false);
  });
});
