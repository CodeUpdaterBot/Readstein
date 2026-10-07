import { describe, expect, it } from 'vitest';

import { applyHostLibraryMetadata } from '@/utils/bookTitle';

/**
 * The desktop row is the source of truth for the catalog, so a synced device has to end up
 * able to do everything the desktop can. The bug this pins: only title, author and tags
 * were mirrored, so a phone received no publication years and the timeline dial rendered
 * "0 bands" with no tiles while the desktop looked perfect.
 */
const makeBook = (overrides: Record<string, unknown> = {}) =>
  ({
    hash: 'h1',
    title: 'Old Title',
    author: 'Author',
    tags: [],
    metadata: {},
    ...overrides,
  }) as unknown as Parameters<typeof applyHostLibraryMetadata>[0];

const metaOf = (book: unknown): Record<string, unknown> =>
  (book as { metadata: Record<string, unknown> }).metadata;

describe('host library metadata mirror', () => {
  it('brings the publication years across, so the dial can band', () => {
    const book = makeBook();
    const changed = applyHostLibraryMetadata(book, {
      metadata: { published: 1584, publishedDates: [1584, 1610] },
    });
    expect(changed).toBe(true);
    expect(metaOf(book)['published']).toBe(1584);
    expect(metaOf(book)['publishedDates']).toEqual([1584, 1610]);
  });

  it('creates metadata when the local record has none at all', () => {
    const book = makeBook({ metadata: undefined });
    applyHostLibraryMetadata(book, { metadata: { published: 1516 } });
    expect(metaOf(book)['published']).toBe(1516);
  });

  it('mirrors the rest of the record too, not just the years', () => {
    const book = makeBook();
    applyHostLibraryMetadata(book, {
      metadata: { language: 'la', publisher: 'Plantin', series: 'Opera', seriesIndex: 2 },
    });
    expect(metaOf(book)['language']).toBe('la');
    expect(metaOf(book)['publisher']).toBe('Plantin');
    expect(metaOf(book)['series']).toBe('Opera');
    expect(metaOf(book)['seriesIndex']).toBe(2);
  });

  it('does not report an edit when the device already matches the PC', () => {
    const book = makeBook({ metadata: { published: 1584, publishedDates: [1584] } });
    const changed = applyHostLibraryMetadata(book, {
      title: 'Old Title',
      author: 'Author',
      metadata: { published: 1584, publishedDates: [1584] },
    });
    expect(changed).toBe(false);
  });

  it('keeps the device’s own years when the PC row has none', () => {
    // A book the user annotated locally must not lose data because the host was silent.
    const book = makeBook({ metadata: { published: 1584 } });
    applyHostLibraryMetadata(book, { metadata: {} });
    expect(metaOf(book)['published']).toBe(1584);
  });

  it('mirrors grouping so shelves survive the mirror', () => {
    const book = makeBook();
    const changed = applyHostLibraryMetadata(book, {
      groupId: 'abc1234',
      groupName: 'Translations',
    });
    expect(changed).toBe(true);
    expect((book as { groupId?: string }).groupId).toBe('abc1234');
    expect((book as { groupName?: string }).groupName).toBe('Translations');
  });
});
