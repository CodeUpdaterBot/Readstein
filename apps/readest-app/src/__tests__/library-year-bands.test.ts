// The spiral search dial lays the library out along the timeline, so the year
// bands it draws have to be trustworthy: every band the same width in years,
// aligned so the dates read as round numbers, covering every dated work, and
// honest about the years the library has nothing in.
import { describe, expect, it } from 'vitest';

import type { Book } from '@/types/book';
import {
  bandIndexForYear,
  booksInBand,
  buildUniformYearBands,
  buildWholeLibraryBand,
  collectDatedWorks,
  findYearGaps,
  formatYearBandLabel,
  formatYearLabel,
  parseYear,
} from '@/app/library/utils/yearBands';

const book = (hash: string, metadata: Partial<Book['metadata']>): Book =>
  ({ hash, title: `Book ${hash}`, metadata }) as Book;

const point = (hash: string, year: number): Book =>
  book(hash, { published: String(year) } as Book['metadata']);

describe('collectDatedWorks', () => {
  it('prefers the multi-date components so composite works contribute each part', () => {
    const palimpsest = book('a', {
      publishedDates: [
        { start: 901, end: 1000, part: 'principal text' },
        { start: 1101, end: 1200, part: 'added leaves' },
      ],
    } as Book['metadata']);
    const works = collectDatedWorks([palimpsest]);
    expect(works.map((work) => work.year)).toEqual([901, 1101]);
    expect(works[0]!.part).toBe('principal text');
  });

  it('falls back to the single published year, and skips books with no date', () => {
    const works = collectDatedWorks([point('a', 1459), book('b', {})]);
    expect(works).toHaveLength(1);
    expect(works[0]!.year).toBe(1459);
  });
});

describe('buildUniformYearBands', () => {
  const spread = (years: number[]): Book[] => years.map((year, i) => point(`b${i}`, year));

  it('returns nothing for an empty timeline', () => {
    expect(buildUniformYearBands([], 10)).toEqual([]);
  });

  it('gives every band the same width, whatever the data does', () => {
    // What this replaced: cutting wherever the data fell put a ten-year tile
    // beside a one-year tile beside another ten-year tile, and the ring read as
    // though the sort order had wandered.
    const books = spread([1090, 1095, 1100, 1105, 1110, 1140, 1141]);
    const bands = buildUniformYearBands(collectDatedWorks(books), 10);
    for (const band of bands) expect(band.hi - band.lo).toBe(9);
    expect(bands.map((band) => band.label)).toEqual([
      '1090\u20131099',
      '1100\u20131109',
      '1110\u20131119',
      '1140\u20131149',
    ]);
  });

  it('aligns bands to the grid so their dates are round numbers', () => {
    const bands = buildUniformYearBands(collectDatedWorks(spread([1459])), 10);
    expect(bands[0]!.lo).toBe(1450);
    expect(bands[0]!.hi).toBe(1459);
    expect(bands[0]!.label).toBe('1450\u20131459');
  });

  it('widens the step with the zoom, one year at a time at the fine end', () => {
    const works = collectDatedWorks(spread([1400, 1405, 1412, 1420, 1431]));
    expect(buildUniformYearBands(works, 1).map((band) => band.label)).toEqual([
      '1400',
      '1405',
      '1412',
      '1420',
      '1431',
    ]);
    expect(buildUniformYearBands(works, 2).map((band) => band.label)).toEqual([
      '1400\u20131401',
      '1404\u20131405',
      '1412\u20131413',
      '1420\u20131421',
      '1430\u20131431',
    ]);
    // And a decade of step collapses the same years into fewer, wider tiles.
    expect(buildUniformYearBands(works, 10).map((band) => band.lo)).toEqual([
      1400, 1410, 1420, 1430,
    ]);
  });

  it('plots only years the library holds, leaving holes unbanded', () => {
    // The 16th century and then straight to the 20th: the 1700s hold nothing, and
    // the dial must not manufacture a band there — every band is a year range a
    // book actually occupies. The hole is still discoverable, via findYearGaps.
    const books = spread([1530, 1560, 1590, 1600, 1620, 1650, 1680, 1900, 1910, 1920]);
    const works = collectDatedWorks(books);
    const bands = buildUniformYearBands(works, 10);
    for (const band of bands) {
      expect(band.works.length).toBeGreaterThan(0);
      const occupied = band.works.some((work) => work.year >= band.lo && work.year <= band.hi);
      expect(occupied).toBe(true);
    }
    const covered = new Set(bands.flatMap((band) => band.works.map((work) => work.year)));
    expect(covered.size).toBe(works.length);
    expect(bands.some((band) => band.lo === 1700)).toBe(false);
    expect(findYearGaps(works)[0]!.span).toBeGreaterThan(200);
  });

  it('covers every work exactly once and never overlaps', () => {
    const books = spread([401, 700, 705, 710, 810, 900, 1405, 1459, 1530, 1900, 1950, 2020]);
    const works = collectDatedWorks(books);
    for (const step of [1, 5, 25]) {
      const bands = buildUniformYearBands(works, step);
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i]!.lo).toBeGreaterThan(bands[i - 1]!.hi);
      }
      const placements = bands.flatMap((band) =>
        band.works.map((work) => work.book.hash + ':' + work.year),
      );
      expect(new Set(placements).size).toBe(works.length);
    }
  });

  it('puts a work with two dated parts in two different bands', () => {
    const palimpsest = book('p', {
      publishedDates: [
        { start: 901, end: 1000 },
        { start: 1801, end: 1900 },
      ],
    } as Book['metadata']);
    const bands = buildUniformYearBands(collectDatedWorks([palimpsest]), 10);
    const hosts = bands.filter((band) => band.works.some((work) => work.book.hash === 'p'));
    expect(hosts).toHaveLength(2);
    expect(hosts.map((band) => band.lo)).toEqual([900, 1800]);
  });

  it('labels single-year and ranged bands readably', () => {
    expect(formatYearBandLabel(1405, 1405)).toBe('1405');
    expect(formatYearBandLabel(1400, 1409)).toBe('1400\u20131409');
  });
});

describe('findYearGaps', () => {
  it('reports the empty stretches, longest first', () => {
    const works = collectDatedWorks([point('a', 1500), point('b', 1550), point('c', 1900)]);
    const gaps = findYearGaps(works);
    expect(gaps[0]).toEqual({ lo: 1551, hi: 1899, span: 349 });
    expect(gaps[1]).toEqual({ lo: 1501, hi: 1549, span: 49 });
  });
});

describe('band lookup', () => {
  it('finds the band holding a year and the distinct books in it', () => {
    const books = [point('a', 1459), point('b', 1460), point('c', 2020)];
    const bands = buildUniformYearBands(collectDatedWorks(books), 10);
    const index = bandIndexForYear(bands, 1459);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(booksInBand(bands[index]!).map((b) => b.hash)).toContain('a');
  });
});

describe('years before Christ', () => {
  it('reads BC metadata as negative years, so the timeline can cross the era', () => {
    expect(parseYear('300 BC')).toBe(-300);
    expect(parseYear('300 BCE')).toBe(-300);
    expect(parseYear('-50')).toBe(-50);
    expect(parseYear('AD 400')).toBe(400);
    expect(parseYear(2024)).toBe(2024);
    expect(parseYear('c. 310-315')).toBe(310);
    expect(parseYear('')).toBeNull();
  });

  it('labels BC years and ranges chronologically rather than flipping them', () => {
    expect(formatYearLabel(-300)).toBe('300 BC');
    expect(formatYearBandLabel(-400, -300)).toBe('400\u2013300 BC');
    expect(formatYearBandLabel(-300, 100)).toBe('300 BC\u2013100');
    expect(formatYearBandLabel(1405, 1405)).toBe('1405');
  });

  it('bands a timeline that starts before the era', () => {
    const books = [
      book('a', { published: '400 BC' } as Book['metadata']),
      book('b', { published: '-350' } as Book['metadata']),
      book('c', { published: '-300' } as Book['metadata']),
      book('d', { published: '2024' } as Book['metadata']),
    ];
    const bands = buildUniformYearBands(collectDatedWorks(books), 10);
    expect(bands[0]!.lo).toBeLessThan(0);
    expect(bands[0]!.label).toContain('BC');
    for (const band of bands) expect(band.works.length).toBeGreaterThan(0);
    const covered = new Set(bands.flatMap((band) => band.works.map((work) => work.year)));
    expect(covered.size).toBe(4);
  });
});

describe('whole-library range', () => {
  it('can present the collection as one band spanning its exact extent', () => {
    // The dial's coarsest zoom: the single band states the library's own span
    // rather than a rounded-off decade, because at that scale the extent *is* the
    // information.
    const books = [401, 700, 1459, 2029].map((year, i) => point(`w${i}`, year));
    const bands = buildWholeLibraryBand(collectDatedWorks(books));
    expect(bands).toHaveLength(1);
    expect(bands[0]!.lo).toBe(401);
    expect(bands[0]!.hi).toBe(2029);
    expect(bands[0]!.label).toBe('401\u20132029');
    expect(bands[0]!.works).toHaveLength(4);
  });

  it('reaches the end of a work whose date is a span', () => {
    const ranged = book('r', { publishedDates: [{ start: 900, end: 1850 }] } as Book['metadata']);
    const bands = buildWholeLibraryBand(collectDatedWorks([point('a', 401), ranged]));
    expect(bands[0]!.lo).toBe(401);
    expect(bands[0]!.hi).toBe(1850);
  });
});
