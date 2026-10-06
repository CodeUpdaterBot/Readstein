import type { Book } from '@/types/book';

/**
 * One dated component of one work.
 *
 * A book is not always a single moment: a palimpsest, a composite manuscript or a
 * collected edition carries several production dates, and each of them should be
 * findable on its own. So the dial works in *components*, not books, and a book
 * with three dated parts occupies three places on the year ring.
 */
export interface DatedWork {
  book: Book;
  /** Earliest year of the component. */
  year: number;
  /** Latest year of the component; equals `year` for a single-point date. */
  endYear: number;
  /** Scholarly wording when the metadata carries it. */
  label: string;
  /** Which part of a composite work this component is, when named. */
  part: string;
}

/** A contiguous slice of the timeline carrying a readable number of works. */
export interface YearBand {
  /** Inclusive: `lo` <= year <= `hi`. */
  lo: number;
  hi: number;
  label: string;
  works: DatedWork[];
}

/**
 * A stretch of years with no dated works at all.
 *
 * Deliberately *not* part of the dial: the dial plots the library, so every band
 * on it is a year range some book actually occupies. This is the separate
 * "where are the holes?" analysis — the basis for deciding what to acquire next.
 */
export interface YearGap {
  lo: number;
  hi: number;
  /** Number of empty years, inclusive. */
  span: number;
}

/**
 * How the dial slices time.
 *
 * Every band on a ring is the *same* width in years, and the zoom levels are those
 * widths: one year per band, two, three, and on up. Slicing wherever the data
 * happens to fall — what this view did first — puts a ten-year tile beside a
 * single-year tile beside another ten-year tile, and the ring then reads as though
 * the sort order wandered. A fixed step leaves zoom as the only thing that changes.
 */
const DEFAULT_MIN_GAP_YEARS = 20;
/**
 * Read a year out of metadata, keeping its sign. Dates before Christ are negative
 * years internally — there is no year zero to anchor on, and a timeline that
 * cannot go below 1 is not a timeline of manuscripts.
 */
export const parseYear = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/(-?\d{1,6})/);
  if (!match) return null;
  const year = parseInt(match[1]!, 10);
  if (Number.isNaN(year)) return null;
  // "300 BC" is the same fact as the year -300, written the other way round.
  const isBeforeChrist = /\b(?:bc|bce)\b/i.test(text);
  const isAnnoDomini = /\b(?:ad|ce)\b/i.test(text);
  if (isBeforeChrist && year > 0) return -year;
  if (isAnnoDomini && year < 0) return Math.abs(year);
  return year;
};

/** A single year, written with its era. */
export const formatYearLabel = (year: number): string => (year < 0 ? `${-year} BC` : `${year}`);

export const formatYearBandLabel = (lo: number, hi: number): string => {
  if (lo === hi) return formatYearLabel(lo);
  // Both ends before Christ read chronologically ("400-300 BC"), so the signs come
  // off and the order is preserved rather than flipped.
  if (lo < 0 && hi < 0) return `${-lo}\u2013${-hi} BC`;
  if (lo < 0) return `${-lo} BC\u2013${hi}`;
  return `${lo}\u2013${hi}`;
};

/**
 * Every dated component of every book, earliest first. Prefers the multi-date
 * metadata (`publishedDates`) so composite works contribute each of their parts,
 * and falls back to the single `published` year.
 */
export const collectDatedWorks = (books: Book[]): DatedWork[] => {
  const works: DatedWork[] = [];
  for (const book of books) {
    const metadata = book.metadata;
    let contributed = false;
    for (const component of metadata?.publishedDates ?? []) {
      const year = parseYear(component?.start);
      if (year === null) continue;
      works.push({
        book,
        year,
        endYear: parseYear(component?.end) ?? year,
        label: component?.label ?? '',
        part: component?.part ?? '',
      });
      contributed = true;
    }
    if (contributed) continue;
    const fallback = parseYear(metadata?.published);
    if (fallback === null) continue;
    works.push({ book, year: fallback, endYear: fallback, label: '', part: '' });
  }
  return works.sort((a, b) => a.year - b.year || a.book.hash.localeCompare(b.book.hash));
};

/**
 * Cut the timeline into bands of a fixed number of years: one band per step of the
 * grid, skipping the steps no work occupies.
 *
 * Bands are aligned to the grid — a decade begins on a *0 year — so their labels
 * are round numbers rather than wherever the first book happened to sit, and every
 * band at a given zoom is the same width. A work dated in several periods appears
 * in each of them, which is how a composite manuscript belongs in both the ninth
 * and the twelfth century.
 */
export const buildUniformYearBands = (works: DatedWork[], stepYears: number): YearBand[] => {
  if (works.length === 0) return [];
  const step = Math.max(1, Math.trunc(stepYears));
  const buckets = new Map<number, DatedWork[]>();
  for (const work of works) {
    const lo = Math.floor(work.year / step) * step;
    const bucket = buckets.get(lo);
    if (bucket) bucket.push(work);
    else buckets.set(lo, [work]);
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([lo, bucket]) => ({
      lo,
      hi: lo + step - 1,
      label: formatYearBandLabel(lo, lo + step - 1),
      works: bucket,
    }));
};

/**
 * The whole collection as one band — the coarsest zoom. Its label is the library's
 * own first and last year rather than a rounded range: at this scale the extent is
 * the information.
 */
export const buildWholeLibraryBand = (works: DatedWork[]): YearBand[] => {
  if (works.length === 0) return [];
  let lo = works[0]!.year;
  let hi = works[0]!.year;
  for (const work of works) {
    lo = Math.min(lo, work.year);
    hi = Math.max(hi, work.year, work.endYear);
  }
  return [{ lo, hi, label: formatYearBandLabel(lo, hi), works: [...works] }];
};

/**
 * Empty stretches between worked years, longest first. Feeds the "where are the
 * holes in this library?" view — the basis for asking what to acquire next.
 */
export const findYearGaps = (
  works: DatedWork[],
  options: { minGapYears?: number } = {},
): YearGap[] => {
  const minGapYears = options.minGapYears ?? DEFAULT_MIN_GAP_YEARS;
  if (works.length < 2) return [];
  const years = [...new Set(works.map((work) => work.year))].sort((a, b) => a - b);
  const gaps: YearGap[] = [];
  for (let i = 1; i < years.length; i++) {
    const lo = years[i - 1]! + 1;
    const hi = years[i]! - 1;
    const span = hi - lo + 1;
    if (span >= minGapYears) gaps.push({ lo, hi, span });
  }
  return gaps.sort((a, b) => b.span - a.span);
};

/** Index of the band holding `year`, or the nearest band when none does. */
export const bandIndexForYear = (bands: YearBand[], year: number): number => {
  if (bands.length === 0) return -1;
  const exact = bands.findIndex((band) => year >= band.lo && year <= band.hi);
  if (exact >= 0) return exact;
  let best = 0;
  let bestDistance = Infinity;
  bands.forEach((band, index) => {
    const distance = year < band.lo ? band.lo - year : year - band.hi;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
};

/** Distinct books in a band, in library order. */
export const booksInBand = (band: YearBand): Book[] => {
  const seen = new Set<string>();
  const books: Book[] = [];
  for (const work of band.works) {
    if (seen.has(work.book.hash)) continue;
    seen.add(work.book.hash);
    books.push(work.book);
  }
  return books;
};
