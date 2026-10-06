'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdArrowUpward, MdArrowDownward, MdClose, MdSearch } from 'react-icons/md';

import type {
  Book,
  LibrarySearchConfig,
  LibrarySearchMatch,
  LibrarySearchSectionResult,
  LibrarySearchTarget,
} from '@/types/book';
import type { AppService } from '@/types/system';
import { useTranslation } from '@/hooks/useTranslation';
import BookCover from '@/components/BookCover';
import {
  createLibrarySearchSession,
  resolveSearchResultCfi,
  searchLibraryBooks,
  type LibrarySearchSession,
} from '@/services/librarySearchService';
import { createBookFilter } from '../utils/libraryUtils';
import {
  makeLibrarySearchKey,
  readLibrarySearchSnapshot,
  writeLibrarySearchSnapshot,
} from '../utils/librarySearchSnapshot';
import {
  bandIndexForYear,
  booksInBand,
  buildUniformYearBands,
  buildWholeLibraryBand,
  collectDatedWorks,
  formatYearBandLabel,
  type DatedWork,
  type YearBand,
} from '../utils/yearBands';

/**
 * The spiral (radial) view of library search.
 *
 * The same search the shelf runs, laid out along the timeline instead of in a
 * list. The dial is concentric: the hub holds the query, the first ring is the
 * years the current results occupy, the next ring the works in the selected year,
 * and the panel to the right the passages that actually matched. Every ring is
 * scrollable — up for newer, down for older — so the whole collection can be
 * walked like a combination lock without typing anything.
 *
 * It reuses `searchLibraryBooks` exactly as the shelf does, so results stream in
 * and the dial fills out live as books are scanned.
 */

interface SpiralSearchViewProps {
  appService: AppService;
  books: Book[];
  query: string;
  config: LibrarySearchConfig;
  target: LibrarySearchTarget;
  onQueryChange: (query: string) => void;
  /** Ask the page to switch to full-text search, as the header's toggle does. */
  onRequestContentSearch?: () => void;
  onSelectResult: (book: Book, cfi: string) => void;
  /**
   * Open a work outright. The dial is a browse surface as much as a results one:
   * with no query there is nothing to jump *to*, so a work only needs opening.
   */
  onOpenBook?: (book: Book) => void;
  onExit: () => void;
}

interface ResultGroup {
  book: Book;
  matchCount: number;
  sections: LibrarySearchSectionResult[];
}

/**
 * How finely the timeline is cut, coarsest first: the step here is the width of
 * *every* tile on the ring, so a zoom never leaves the ring with mismatched
 * widths. Ctrl+wheel (or the zoom buttons on a touch screen) walks this list — up
 * for a finer cut, down for a coarser one.
 *
 * Read the other way, from the bottom, zooming out widens the step by a single
 * year at a time to begin with, which is what a scale should do; past a decade it
 * widens faster, so the whole collection stays a handful of gestures away. The
 * coarsest entry is the collection itself in one band, whose label is the
 * library's own first and last year.
 */
const ZOOM_STEPS: number[] = [
  Number.POSITIVE_INFINITY,
  1000,
  500,
  300,
  200,
  150,
  100,
  75,
  50,
  40,
  30,
  25,
  20,
  15,
  12,
  10,
  9,
  8,
  7,
  6,
  5,
  4,
  3,
  2,
  1,
];
/** A decade per tile: readable dates, and a sensible number of stops. */
const DEFAULT_ZOOM = ZOOM_STEPS.indexOf(10);
/**
 * How thick the ring is drawn at the two ends of the zoom, as a fraction of its
 * full thickness. Zoomed all the way out the one band that covers the whole
 * library is a fat tile; at one year per band the tiles are slivers. Watching the
 * ring thicken and thin is what makes a zoom read as scale rather than as tiles
 * being swapped out.
 */
const RING_THIN = 0.63;
const RING_FAT = 1.25;

/**
 * A floor, as a fraction of the dial's height, on how thin a plate may get. The
 * finest bands still have to look like tiles you can read and hit rather than
 * slivers, whatever the zoom and however small the window.
 */
const MIN_PLATE_THICKNESS = 0.055;

/**
 * The match-density gauge on each tile: one tick per this many matching passages,
 * up to a handful of ticks. A glance at the ring then ranks the decades at once,
 * where the exact count under each date has to be read tile by tile.
 */
const MATCHES_PER_TICK = 3;
/** Seven ticks, so a band of twenty-one or more matches reads as saturated. */
const MAX_DENSITY_TICKS = 7;
/** A tick is a small rounded bar, lying along the tile's arc. */
const TICK_LENGTH = 9;
const TICK_THICKNESS = 5;
/** Clear air between marks, so a full gauge stays countable rather than a line. */
const TICK_GAP = 2.5;
/** The share of a tile's arc the gauge starts out using, and the most it may use. */
const TICK_SPREAD = 0.48;
const TICK_SPREAD_MAX = 0.85;

/**
 * Arc presets. A phone cannot give the ring the same room a desktop can, so the
 * compact dial shows fewer, wider bands and gives the hub a bigger share of the
 * radius — a touch target the size of a desktop hub is unusable with a thumb.
 */
const ARC_PRESETS = {
  wide: { visibleBands: 7, stepDeg: 18 },
  compact: { visibleBands: 5, stepDeg: 24 },
} as const;

/** Width below which the three-column layout cannot work and we stack instead. */
const COMPACT_WIDTH = 820;

/**
 * Dial geometry, all derived from the measured height so the arc keeps its shape
 * at any window size. The arc's centre sits off the left edge: that is what makes
 * the plates fan out and the labels bulge towards the middle, and it leaves the
 * hub room to sit inside the innermost radius.
 */
const dialGeometry = (height: number, compact = false) => ({
  cx: -0.06 * height,
  cy: height / 2,
  // The compact dial keeps the plates thin but pushes the hub out to a usable
  // size, so the inner radius has to clear it.
  rPlateInner: (compact ? 0.34 : 0.36) * height,
  rPlateOuter: (compact ? 0.5 : 0.53) * height,
  hubCx: (compact ? 0.155 : 0.155) * height,
  hubR: (compact ? 0.15 : 0.125) * height,
  width: (compact ? 0.52 : 0.54) * height,
});

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Annular sector between two angles, for one year band's plate. */
const sectorPath = (
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number,
): string => {
  const a1 = toRadians(startDeg);
  const a2 = toRadians(endDeg);
  // Past 180° the renderer must be told to take the long way round; otherwise it
  // draws the minor arc and the sector folds through itself.
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const p = (r: number, a: number) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return [
    `M ${p(rInner, a1)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${p(rInner, a2)}`,
    `L ${p(rOuter, a2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p(rOuter, a1)}`,
    'Z',
  ].join(' ');
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const SpiralSearchView: React.FC<SpiralSearchViewProps> = ({
  appService,
  books,
  query,
  config,
  target,
  onQueryChange,
  onRequestContentSearch,
  onSelectResult,
  onOpenBook,
  onExit,
}) => {
  const _ = useTranslation();
  const dialRef = useRef<HTMLDivElement>(null);
  const worksRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<LibrarySearchSession | null>(null);
  const booksRef = useRef(books);
  const configRef = useRef(config);
  booksRef.current = books;
  configRef.current = config;

  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [groups, setGroups] = useState<Map<string, ResultGroup>>(new Map());
  const [phase, setPhase] = useState<'idle' | 'searching' | 'completed'>('idle');
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  // Where the ring thickness is heading for the current zoom, and where it is now
  // — interpolated below so the change is seen rather than just applied.
  const ringTarget = useMemo(() => {
    const progress = ZOOM_STEPS.length > 1 ? zoom / (ZOOM_STEPS.length - 1) : 1;
    return RING_THIN + (RING_FAT - RING_THIN) * (1 - progress);
  }, [zoom]);
  const [ringScale, setRingScale] = useState(ringTarget);
  const ringScaleRef = useRef(ringTarget);
  // What is selected is held by identity — the year a band covers, the hash of a
  // work — never by position. A content scan streams its results in, and every
  // arrival inserts a band into the timeline; with an index, each arrival slid the
  // user's selection onto a neighbouring century and the ring appeared to reset
  // under them, while the slots for older bands never seemed to fill.
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedWorkHash, setSelectedWorkHash] = useState<string | null>(null);
  const [selectedMatch, setSelectedMatch] = useState(0);

  const textSearchActive = target === 'text' && query.trim().length > 0;

  // --- live streaming search, exactly as the shelf runs it -------------------
  const searchKey = useMemo(
    () => makeLibrarySearchKey(books, config, query),
    [books, config, query],
  );

  useEffect(() => {
    if (!textSearchActive) {
      setGroups(new Map());
      setPhase('idle');
      setProgress(0);
      return;
    }
    // A scan that already finished for exactly these books, options and query is
    // adopted as-is. The shelf's result list and this dial run the same scan, so
    // flipping between them must not sweep the whole library a second time.
    const cached = readLibrarySearchSnapshot(searchKey);
    if (cached) {
      setGroups(new Map(cached.groups.map((group) => [group.book.hash, group])));
      setPhase('completed');
      setProgress(100);
      return;
    }
    const controller = new AbortController();
    setGroups(new Map());
    setPhase('searching');
    setProgress(0);
    const session = (sessionRef.current ??= createLibrarySearchSession(appService));
    // Accumulated here as well as in state, so the finished scan can be handed on
    // without reading back the state the loop is still filling.
    const collected = new Map<string, ResultGroup>();
    const timeout = setTimeout(async () => {
      try {
        for await (const event of searchLibraryBooks(appService, booksRef.current, query, {
          config: configRef.current,
          signal: controller.signal,
          session,
        })) {
          if (controller.signal.aborted) return;
          if (event.type === 'progress') {
            setProgress(Math.round(event.progress * 100));
          } else if (event.type === 'result') {
            const existing = collected.get(event.book.hash);
            collected.set(event.book.hash, {
              book: event.book,
              matchCount: (existing?.matchCount ?? 0) + event.result.subitems.length,
              sections: [...(existing?.sections ?? []), event.result],
            });
            setGroups(new Map(collected));
          } else if (event.type === 'completed') {
            setPhase('completed');
            setProgress(100);
            writeLibrarySearchSnapshot({
              searchKey,
              groups: [...collected.values()],
              issues: [],
              skipped: 0,
              truncated: Boolean(event.truncated),
              expandedBooks: [],
            });
          }
        }
      } catch {
        setPhase('completed');
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [appService, query, textSearchActive, searchKey]);

  // --- the timeline the dial plots -------------------------------------------
  // With a text search running, only books that have matched so far occupy the
  // ring — so the years shown are the years of real hits, and they appear as the
  // scan reaches them. Without a query it is the whole shelf, filtered by the
  // same metadata match the list view uses for a book search.
  const candidateBooks = useMemo(() => {
    if (textSearchActive) return [...groups.values()].map((group) => group.book);
    const filter = createBookFilter(query.trim() ? query : null);
    return books.filter((book) => !book.deletedAt && filter(book));
  }, [textSearchActive, groups, books, query]);

  const stepYears = ZOOM_STEPS[clamp(zoom, 0, ZOOM_STEPS.length - 1)] ?? 1;
  // Every dated component of every work in play, collected once — the bands and the
  // span the hub quotes both read from this.
  const datedWorks = useMemo(() => collectDatedWorks(candidateBooks), [candidateBooks]);

  // How much history the results actually touch: the latest year any of them
  // occupies, less the earliest. Counted inclusively, so a run from 1950 to 2099
  // reads as the 150 years its tiles already say it is.
  //
  // Years before Christ are simply negative numbers here. This is a subtraction of
  // years, never a difference between printed labels, so 400 BC to 100 BC comes out
  // as the 301 years it looks like rather than folding back towards zero.
  const resultSpanYears = useMemo(() => {
    if (datedWorks.length === 0) return 0;
    let earliest = datedWorks[0]!.year;
    let latest = datedWorks[0]!.year;
    for (const work of datedWorks) {
      earliest = Math.min(earliest, work.year);
      latest = Math.max(latest, work.year, work.endYear);
    }
    return Math.max(1, latest - earliest + 1);
  }, [datedWorks]);

  const bands: YearBand[] = useMemo(
    () =>
      Number.isFinite(stepYears)
        ? buildUniformYearBands(datedWorks, stepYears)
        : buildWholeLibraryBand(datedWorks),
    [datedWorks, stepYears],
  );

  // What each tile covers, for the hub header: "48 bands | 10yr". At the coarsest
  // zoom there is no step to quote, so the reach of the results stands in for it.
  const bandWidthYears = Number.isFinite(stepYears) ? stepYears : resultSpanYears;

  // Matching passages per band, for the density gauge. Null when nothing is being
  // searched for: there is no density to show, and a ring of empty gauges would
  // only be noise. Counted per distinct work, so a composite manuscript's several
  // dated parts do not multiply its matches.
  const bandMatchCounts = useMemo(() => {
    if (!textSearchActive) return null;
    return bands.map((item) => {
      let total = 0;
      const counted = new Set<string>();
      for (const work of item.works) {
        const hash = work.book.hash;
        if (counted.has(hash)) continue;
        counted.add(hash);
        total += groups.get(hash)?.matchCount ?? 0;
      }
      return total;
    });
  }, [bands, groups, textSearchActive]);
  // Whether any band has anything to gauge at all — one flag for the whole ring, so
  // every date sits at the same radius and the type stays one size.
  const showGauge = bandMatchCounts !== null && bandMatchCounts.some((count) => count > 0);

  const bandCount = bands.length;
  // The selected band, found by the year it covers: bands arriving around it — newer
  // above, older below — then leave the selection exactly where the user put it.
  // With nothing chosen yet, start in the middle of the collection rather than at one
  // end: the ring then has bands on both sides of the selection instead of a row of
  // tiles along the top and an empty half below it.
  const defaultYear = bandCount > 0 ? bands[Math.floor((bandCount - 1) / 2)]!.lo : null;
  const selectedBand = useMemo(() => {
    if (bandCount === 0) return -1;
    return bandIndexForYear(bands, selectedYear ?? defaultYear!);
  }, [bands, bandCount, selectedYear, defaultYear]);
  // Pin that first choice once there is something to choose, so bands arriving later
  // — newer above, older below — never drag the selection along with them.
  useEffect(() => {
    if (selectedYear === null && defaultYear !== null) setSelectedYear(defaultYear);
  }, [defaultYear, selectedYear]);
  // Live selection for the native listeners further down, which are attached once
  // and would otherwise close over values from the render that attached them.
  const ringSelection = useRef<{
    bands: YearBand[];
    selectedBand: number;
    bandBooks: Book[];
    selectedWork: number;
  }>({ bands: [], selectedBand: -1, bandBooks: [], selectedWork: 0 });
  /** Walk `steps` bands along the timeline, newer being positive. */
  const stepBand = useCallback((steps: number) => {
    const live = ringSelection.current;
    if (live.bands.length === 0) return;
    const next = clamp(live.selectedBand + steps, 0, live.bands.length - 1);
    const target = live.bands[next];
    if (target) setSelectedYear(target.lo);
  }, []);
  /** Walk `steps` works inside the selected band. */
  const stepWork = useCallback((steps: number) => {
    const live = ringSelection.current;
    if (live.bandBooks.length === 0) return;
    const next = clamp(live.selectedWork + steps, 0, live.bandBooks.length - 1);
    const target = live.bandBooks[next];
    if (target) setSelectedWorkHash(target.hash);
  }, []);

  // Animate the ring thickness over a few frames: a zoom should look like the
  // tiles swelling or shrinking, which is the cue that tells the user the scale
  // changed at all.
  useEffect(() => {
    const from = ringScaleRef.current;
    if (Math.abs(from - ringTarget) < 0.001) return;
    let frame = 0;
    // The origin is the first frame's own timestamp: requestAnimationFrame and
    // performance.now() need not share a clock, and mixing them walks the radius
    // negative — the plate then renders inside out and vanishes.
    let started: number | null = null;
    const step = (now: number) => {
      started ??= now;
      const t = clamp((now - started) / 260, 0, 1);
      const eased = 1 - (1 - t) ** 3; // settle rather than stop dead
      const value = from + (ringTarget - from) * eased;
      ringScaleRef.current = value;
      setRingScale(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ringTarget]);

  const band = bands[selectedBand];

  // A zoom re-cuts the bands and moves every edge. Nothing special needs doing about
  // it now: the selection is a year, so it survives the re-cut on its own.
  const bandBooks = useMemo(() => (band ? booksInBand(band) : []), [band]);

  // Same for the work: found by hash, so matches streaming into this band cannot
  // swap out the work whose passages are on screen.
  const selectedWork = useMemo(() => {
    if (bandBooks.length === 0) return 0;
    const found = selectedWorkHash
      ? bandBooks.findIndex((item) => item.hash === selectedWorkHash)
      : -1;
    return found >= 0 ? found : 0;
  }, [bandBooks, selectedWorkHash]);
  useEffect(() => {
    if (selectedWorkHash === null && bandBooks.length > 0) {
      setSelectedWorkHash(bandBooks[0]!.hash);
    }
  }, [bandBooks, selectedWorkHash]);
  // Only a change of *band* or of *work* moves the reading position on; a result
  // arriving somewhere else in the library must not pull the user out of a passage.
  useEffect(() => {
    setSelectedMatch(0);
  }, [band?.lo, selectedWorkHash]);

  useEffect(() => {
    ringSelection.current = { bands, selectedBand, bandBooks, selectedWork };
  });

  const work = bandBooks[selectedWork];
  const group = work ? groups.get(work.hash) : undefined;
  // The band's works carry the dated component each book occupies *there*, so a
  // composite work shows the date of the part the user actually stopped on.
  const bandWorkByHash = useMemo(() => {
    const map = new Map<string, DatedWork>();
    for (const item of band?.works ?? []) {
      if (!map.has(item.book.hash)) map.set(item.book.hash, item);
    }
    return map;
  }, [band]);

  // --- measurement ----------------------------------------------------------
  useEffect(() => {
    const node = dialRef.current?.parentElement;
    if (!node) return;
    const measure = () =>
      setSize({ width: node.clientWidth, height: Math.max(node.clientHeight, 420) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A phone cannot host three columns, so below the breakpoint the dial, the works
  // and the passages stack. The dial is then sized from the *width* as well: its
  // arc is a fraction of its height, so an unconstrained tall dial would be wider
  // than the screen.
  const compact = size.width < COMPACT_WIDTH;
  const dialHeight = compact
    ? Math.max(Math.min(size.height * 0.5, size.width / 0.52), 340)
    : size.height;
  const arc = compact ? ARC_PRESETS.compact : ARC_PRESETS.wide;
  const geometry = useMemo(() => dialGeometry(dialHeight, compact), [dialHeight, compact]);

  // --- wheel spins a ring (native listener: the handler must be cancelable) ---
  useEffect(() => {
    const node = dialRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || bandCount === 0) return;
      event.preventDefault();
      // Ctrl/Cmd + wheel re-cuts the timeline instead of moving along it: the
      // bands get finer (zoom in) or coarser (zoom out), like the scale control on
      // a timeline axis.
      if (event.ctrlKey || event.metaKey) {
        setZoom((current) =>
          clamp(current + (event.deltaY < 0 ? 1 : -1), 0, ZOOM_STEPS.length - 1),
        );
        return;
      }
      // Otherwise, like a combination lock: up for newer years, down for older.
      stepBand(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [bandCount, stepBand]);

  useEffect(() => {
    const node = worksRef.current;
    // Compact shows the works as a horizontally scrolling strip, which must keep
    // its native scrolling rather than having the wheel re-routed to selection.
    if (!node || compact) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || bandBooks.length === 0) return;
      event.preventDefault();
      stepWork(event.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [bandBooks.length, compact, stepWork]);

  // Touch has no wheel. Dragging the dial walks the timeline (up for newer, the
  // same direction as the wheel), and the pair of buttons under it replaces
  // ctrl+scroll for zooming.
  useEffect(() => {
    const node = dialRef.current;
    if (!node || !compact) return;
    let lastY = 0;
    const onTouchStart = (event: TouchEvent) => {
      lastY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? lastY;
      const dy = y - lastY;
      if (Math.abs(dy) < 24) return;
      lastY = y;
      stepBand(dy < 0 ? 1 : -1);
      event.preventDefault();
    };
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
    };
  }, [compact, bandCount, stepBand]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onExit();
        return;
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && bandCount > 0) {
        event.preventDefault();
        stepBand(event.key === 'ArrowUp' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bandCount, onExit, stepBand]);

  const openMatch = useCallback(
    async (book: Book, targetMatch?: LibrarySearchMatch) => {
      const session = sessionRef.current;
      const cfi =
        session && targetMatch
          ? await resolveSearchResultCfi(session, book, targetMatch.locator)
          : null;
      onSelectResult(book, cfi ?? '');
    },
    [onSelectResult],
  );

  const ringInner = geometry.rPlateInner;
  const ringThickness = Math.max(
    (geometry.rPlateOuter - ringInner) * ringScale,
    dialHeight * MIN_PLATE_THICKNESS,
  );
  const ringOuter = ringInner + ringThickness;
  // With a gauge on the tiles, the outer edge of every plate belongs to it, so hold
  // the date back from that edge — a label centred in the full thickness runs its
  // last glyphs into the marks. With no gauge there is nothing to make room for,
  // and a label held off-centre just looks wrong, so the lane collapses to nothing.
  const gaugeLane = showGauge ? Math.min(TICK_THICKNESS * 4, ringThickness * 0.3) : 0;
  // What is left is the date's — a fatter ring also means more arc to write along.
  const ringLabel = ringInner + (ringThickness - gaugeLane) / 2;

  const visibleBands = useMemo(() => {
    const half = (arc.visibleBands - 1) / 2;
    const items: { band: YearBand; index: number; offset: number }[] = [];
    for (let offset = -half; offset <= half; offset++) {
      const index = selectedBand + offset;
      const visible = bands[index];
      if (visible) items.push({ band: visible, index, offset });
    }
    return items;
  }, [bands, selectedBand, arc.visibleBands]);

  // Matches for the selected work, each kept next to its section label so the
  // passage cards can say where in the book they came from.
  const matchEntries = useMemo(
    () =>
      group
        ? group.sections.flatMap((section) =>
            section.subitems.map((subitem) => ({ section: section.label, match: subitem })),
          )
        : [],
    [group],
  );
  // How many passages the search has found across the whole library, against how
  // many belong to the work currently selected. A dial is for seeing the *shape*
  // of a search, so the library-wide total is the headline and the selection is
  // the detail underneath it.
  const totalResults = useMemo(
    () => [...groups.values()].reduce((sum, item) => sum + item.matchCount, 0),
    [groups],
  );
  const plural = (count: number, one: string, many: string) =>
    _(count === 1 ? one : many, { count });

  const headline = textSearchActive
    ? phase === 'searching'
      ? plural(totalResults, '{{count}} result so far', '{{count}} results so far')
      : plural(totalResults, '{{count}} result', '{{count}} results')
    : plural(candidateBooks.length, '{{count}} work', '{{count}} works');
  // Under the headline: the stretch of history the results reach across, rather
  // than a second count of the same thing.
  const subline = resultSpanYears
    ? plural(resultSpanYears, 'across {{count}} year', 'across {{count}} years')
    : '';

  const workWindow = 7;
  const windowHalf = Math.floor(workWindow / 2);
  const windowStart = clamp(
    selectedWork - windowHalf,
    0,
    Math.max(bandBooks.length - workWindow, 0),
  );
  const visibleWorks = bandBooks.slice(windowStart, windowStart + workWindow);

  return (
    <div
      className={clsx(
        'bg-base-100 relative flex h-full w-full overflow-hidden',
        compact ? 'flex-col' : 'flex-row',
      )}
    >
      {/* ------------------------------------------------------------ the dial */}
      <div
        ref={dialRef}
        className={
          compact
            ? 'relative mx-auto shrink-0 touch-none select-none'
            : 'relative h-full shrink-0 select-none'
        }
        style={compact ? { width: geometry.width, height: dialHeight } : { width: geometry.width }}
        aria-label={_('Year dial')}
      >
        <svg
          width={geometry.width}
          height={compact ? dialHeight : size.height}
          className='block overflow-visible'
        >
          {visibleBands.map(({ band: item, index, offset }) => {
            // Negated: a higher index is a later year, and later years belong
            // above the horizon — the dial reads newest at the top, oldest at the
            // bottom, matching the scroll hints.
            const centre = -offset * arc.stepDeg;
            const half = arc.stepDeg / 2 - 0.4;
            const isSelected = index === selectedBand;
            const fade = 1 - Math.min(Math.abs(offset) / (arc.visibleBands / 2), 1) * 0.85;
            const labelX = geometry.cx + ringLabel * Math.cos(toRadians(centre));
            const labelY = geometry.cy + ringLabel * Math.sin(toRadians(centre));
            // Fit the date to the tile it sits in. A tile's arc is fixed by the
            // step angle, so when a range is long — "1405-1414" needs about twice
            // the room of "1405" — the type has to be what gives, or the ends of
            // the range are simply cut off.
            const baseFont = Math.max(dialHeight * 0.023, 12);
            const tileArc = toRadians(Math.max(arc.stepDeg - 1.4, 1)) * ringLabel;
            const dateFont = Math.max(
              Math.min(baseFont, (tileArc * 0.94) / Math.max(item.label.length * 0.62, 1)),
              dialHeight * 0.013,
            );
            const path = sectorPath(
              geometry.cx,
              geometry.cy,
              ringInner,
              ringOuter,
              centre - half,
              centre + half,
            );
            // Density gauge: ticks riding just inside the tile's outer edge and
            // spread along its arc, so they belong unmistakably to this date range
            // and read as a scale rather than as decoration.
            const wanted = Math.ceil((bandMatchCounts?.[index] ?? 0) / MATCHES_PER_TICK);
            const tickRadius = ringOuter - TICK_THICKNESS / 2 - 1.5;
            // Marks keep one size and one shape; it is the band they sit in that
            // gives way. Widen it only as far as the marks need, so a light gauge
            // stays near the middle of the tile and a full one reaches out — and if
            // even the widest band cannot hold them all at full size (a saturated
            // tile at the deepest zoom on a phone), show as many as fit rather than
            // shrinking them.
            const tickArcLength = tickRadius * toRadians(Math.max(arc.stepDeg - 0.8, 1));
            const tickCapacity = Math.max(
              Math.floor((tickArcLength * TICK_SPREAD_MAX + TICK_GAP) / (TICK_LENGTH + TICK_GAP)),
              1,
            );
            const tickCount = Math.min(wanted, MAX_DENSITY_TICKS, tickCapacity);
            const tickNeeded = tickCount * TICK_LENGTH + Math.max(tickCount - 1, 0) * TICK_GAP;
            const tickSpread = Math.min(
              Math.max(tickNeeded / Math.max(tickArcLength, 1), TICK_SPREAD),
              TICK_SPREAD_MAX,
            );
            const tickStart = (1 - tickSpread) / 2;
            return (
              <g
                key={`${item.lo}-${item.hi}`}
                opacity={fade}
                className='cursor-pointer transition-opacity duration-200'
                onClick={() => {
                  // Selecting by the band's own year keeps the choice put while the
                  // scan keeps inserting bands around it.
                  setSelectedYear(item.lo);
                  setSelectedWorkHash(null);
                }}
              >
                <path
                  d={path}
                  className={clsx(
                    // Colours only. `transition-all` would let the browser
                    // interpolate the path's `d` as well, and a quick scroll then
                    // re-cuts the bands while the old shapes are still morphing —
                    // tiles appear to slide and swing inwards. The geometry is
                    // ours to animate (see the ring scale), not the renderer's.
                    'transition-colors duration-200',
                    isSelected
                      ? 'fill-primary stroke-primary'
                      : 'fill-base-200/70 stroke-base-content/20 hover:fill-base-300',
                  )}
                  strokeWidth={isSelected ? 1.5 : 0.75}
                />
                {tickCount > 0 && (
                  <g className='pointer-events-none' data-density-ticks={tickCount}>
                    {Array.from({ length: tickCount }, (_, tick) => {
                      // Inset from the tile's ends so the marks never crowd its
                      // edges, and spread evenly so the count is countable at a
                      // glance.
                      const along = tickCount === 1 ? 0.5 : tick / (tickCount - 1);
                      const angle = centre - half + half * 2 * (tickStart + along * tickSpread);
                      const x = geometry.cx + tickRadius * Math.cos(toRadians(angle));
                      const y = geometry.cy + tickRadius * Math.sin(toRadians(angle));
                      return (
                        <rect
                          key={tick}
                          x={-TICK_LENGTH / 2}
                          y={-TICK_THICKNESS / 2}
                          width={TICK_LENGTH}
                          height={TICK_THICKNESS}
                          rx={1.5}
                          transform={`translate(${x} ${y}) rotate(${angle + 90})`}
                          className='fill-error'
                        />
                      );
                    })}
                  </g>
                )}
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor='middle'
                  dominantBaseline='middle'
                  className={clsx(
                    'pointer-events-none font-sans',
                    isSelected ? 'fill-primary-content font-semibold' : 'fill-base-content/85',
                  )}
                  style={{ fontSize: dateFont }}
                >
                  {item.label}
                </text>
                <text
                  x={labelX}
                  y={labelY + Math.max(dateFont * 1.18, 13)}
                  textAnchor='middle'
                  dominantBaseline='middle'
                  className={clsx(
                    'pointer-events-none font-sans uppercase tracking-[0.1em]',
                    isSelected ? 'fill-primary-content/85' : 'fill-base-content/55',
                  )}
                  style={{ fontSize: Math.max(dateFont * 0.5, 8) }}
                >
                  {isSelected
                    ? _('Selected')
                    : plural(item.works.length, '{{count}} work', '{{count}} works')}
                </text>
              </g>
            );
          })}
        </svg>

        {/* hub: the query itself */}
        <div
          className='absolute flex items-center justify-center'
          style={{
            left: geometry.hubCx - geometry.hubR,
            top: geometry.cy - geometry.hubR,
            width: geometry.hubR * 2,
            height: geometry.hubR * 2,
          }}
        >
          <div className='border-base-content/25 bg-base-200/85 flex h-full w-full flex-col items-stretch overflow-hidden rounded-full border text-center shadow-lg backdrop-blur'>
            {/* Header chord. The circle clips a full-width strip into a chord, so the
                top of the hub reads as a header rather than as type floating in a
                bubble — and the strip is a genuinely darker band, not a lighter
                overlay, so the separation reads as structure. It carries the scale — how many tiles there are and how many
                years each covers — and the gesture that changes it. The count wears
                the accent colour, so it belongs to the selected range. */}
            <div className='bg-black/25 flex flex-col items-center gap-0.5 px-2 pt-5 pb-2'>
              {/* One string, one colour: the step belongs to the count, and a pipe
                  with a gap on one side only reads as a typo. */}
              <div
                className='text-primary text-[11px] leading-tight font-semibold tracking-[0.1em] uppercase'
                data-testid='dial-scale'
              >
                {bandWidthYears > 0
                  ? `${plural(bands.length, '{{count}} band', '{{count}} bands')} | ${bandWidthYears}yr`
                  : plural(bands.length, '{{count}} band', '{{count}} bands')}
              </div>
              {!compact && (
                <span className='text-base-content/85 text-[9px] font-medium tracking-[0.06em] uppercase'>
                  {_('Ctrl + scroll to zoom')}
                </span>
              )}
            </div>

            {/* The field sits in the widest part of the circle and wears an outline,
                so it reads as somewhere to type rather than as a caption. */}
            <div className='flex flex-1 flex-col items-center justify-center gap-2 px-2.5'>
              <div className='border-base-content/30 bg-base-100/60 focus-within:border-primary flex w-full items-center justify-center gap-1.5 rounded-full border px-2 py-1 transition-colors'>
                <MdSearch className='text-base-content/50 h-3.5 w-3.5 shrink-0' />
                <input
                  type='text'
                  value={query}
                  placeholder={_('Search')}
                  spellCheck='false'
                  onChange={(event) => {
                    const next = event.target.value;
                    // Typing here searches exactly as typing in the header does: a
                    // query meant to be found *in* the books switches the target to
                    // full text, so the dial fills with real matches.
                    if (next.trim() && target !== 'text') onRequestContentSearch?.();
                    onQueryChange(next);
                  }}
                  className='placeholder:text-base-content/50 min-w-0 flex-1 bg-transparent text-center text-sm outline-none'
                />
                {query && (
                  <button
                    type='button'
                    onClick={() => onQueryChange('')}
                    aria-label={_('Clear Search')}
                    className='text-base-content/40 hover:text-base-content shrink-0'
                  >
                    <MdClose className='h-3.5 w-3.5' />
                  </button>
                )}
              </div>
              {textSearchActive && phase === 'searching' && (
                <div className='bg-base-content/15 h-[2px] w-3/4 overflow-hidden rounded-full'>
                  <div
                    className='bg-primary h-full transition-all'
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>

            {/* Footer chord: what is in front of you, and how much of it falls inside
                the range you have selected. */}
            <div className='bg-black/25 flex flex-col items-center gap-0.5 px-2 pt-2 pb-6'>
              <div className='text-warning text-[12px] leading-tight font-semibold'>{headline}</div>
              {subline && (
                <div className='text-base-content/85 text-[9px] leading-tight font-medium tracking-[0.08em] uppercase'>
                  {subline}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* scroll hints — the two gestures the dial responds to */}
        <div className='text-base-content pointer-events-none absolute top-4 left-4 flex flex-col items-start gap-0.5 text-[10px] font-medium tracking-[0.16em] uppercase'>
          <span className='flex items-center gap-1'>
            <MdArrowUpward className='h-3 w-3' /> {compact ? _('Drag up') : _('Scroll up')}
          </span>
          <span className='ps-4'>{_('for newer')}</span>
        </div>
        <div className='text-base-content pointer-events-none absolute bottom-4 left-4 flex flex-col items-start gap-0.5 text-[10px] font-medium tracking-[0.16em] uppercase'>
          <span className='ps-4'>{_('for older')}</span>
          <span className='flex items-center gap-1'>
            <MdArrowDownward className='h-3 w-3' /> {compact ? _('Drag down') : _('Scroll down')}
          </span>
        </div>

        {/* A phone has no ctrl+wheel, so the same zoom is offered as two buttons,
            tucked at the dial's edge where they cannot cover the arc. */}
        {compact && (
          <div className='absolute right-1 bottom-1 flex flex-col gap-1'>
            <button
              type='button'
              aria-label={_('Zoom out')}
              title={_('Zoom out')}
              onClick={() => setZoom((current) => clamp(current - 1, 0, ZOOM_STEPS.length - 1))}
              className='border-base-content/25 bg-base-200/85 text-base-content/80 flex h-9 w-9 items-center justify-center rounded-full border text-lg leading-none'
            >
              \u2212
            </button>
            <button
              type='button'
              aria-label={_('Zoom in')}
              title={_('Zoom in')}
              onClick={() => setZoom((current) => clamp(current + 1, 0, ZOOM_STEPS.length - 1))}
              className='border-base-content/25 bg-base-200/85 text-base-content/80 flex h-9 w-9 items-center justify-center rounded-full border text-lg leading-none'
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- works in the band */}
      <div
        className={clsx(
          'flex min-w-0 flex-col',
          compact ? 'w-full shrink-0 gap-1 px-3' : 'h-full flex-1 justify-center ps-4 pe-6',
        )}
      >
        <div
          className={clsx(
            'text-base-content/70 text-[10px] font-medium tracking-[0.18em] uppercase',
            compact ? 'px-1' : 'mb-2',
          )}
        >
          {band
            ? _(
                bandBooks.length === 1
                  ? '{{count}} work from {{range}}'
                  : '{{count}} works from {{range}}',
                { count: bandBooks.length, range: band.label },
              )
            : _('No works')}
        </div>
        <div
          ref={worksRef}
          className={clsx('flex', compact ? 'gap-3 overflow-x-auto px-1 pb-2' : 'flex-col gap-2')}
        >
          {visibleWorks.length === 0 && (
            <p className='text-base-content/50 max-w-xs text-sm'>
              {textSearchActive && phase === 'searching'
                ? _('Scanning your books…')
                : _('Nothing here yet.')}
            </p>
          )}
          {visibleWorks.map((item, index) => {
            const absoluteIndex = windowStart + index;
            const offset = absoluteIndex - selectedWork;
            // Sagitta of the arc: the selected work sits furthest right and the
            // neighbours curve away from it, so the ring reads as a ring. In the
            // compact strip the cards scroll horizontally instead, so no offset.
            const shift = compact ? 0 : -(offset * offset) * 3.5;
            const isSelected = absoluteIndex === selectedWork;
            const resultGroup = groups.get(item.hash);
            return (
              <button
                key={item.hash}
                type='button'
                onClick={() => {
                  setSelectedWorkHash(item.hash);
                  setSelectedMatch(0);
                  // With no search running there are no passages to reveal, so a
                  // tap on a work is simply a way to open it.
                  if (!textSearchActive && onOpenBook) onOpenBook(item);
                }}
                title={!textSearchActive ? _('Open {{title}}', { title: item.title }) : undefined}
                className={clsx(
                  'flex items-center gap-3 border px-3 py-2.5 text-left transition-colors',
                  compact ? 'min-w-[15rem] shrink-0 snap-start' : 'w-full max-w-[30rem]',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-base-content/12 bg-base-200/40 hover:bg-base-200/70',
                )}
                style={{
                  transform: shift ? `translateX(${shift}px)` : undefined,
                  opacity: isSelected ? 1 : 0.82,
                }}
              >
                {/* The book's own cover, scaled to fit. A bare format badge hid the
                    one thing the eye actually uses to find a book in a list. */}
                <div className='relative shrink-0'>
                  <BookCover
                    book={item}
                    mode='list'
                    coverFit='fit'
                    className='bg-base-300 h-16 w-11 overflow-hidden rounded'
                    imageClassName='rounded'
                  />
                  <span className='bg-base-100/85 text-base-content/80 absolute end-0.5 bottom-0.5 rounded px-1 text-[8px] leading-tight font-medium uppercase'>
                    {item.format}
                  </span>
                </div>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>{item.title}</span>
                  <span className='text-base-content/55 block truncate text-[11px]'>
                    {(() => {
                      const dated = bandWorkByHash.get(item.hash);
                      return dated ? `${formatYearBandLabel(dated.year, dated.endYear)}  ·  ` : '';
                    })()}
                    {item.author || _('Unknown author')}
                    {resultGroup
                      ? `  ·  ${_('{{count}} results', { count: resultGroup.matchCount })}`
                      : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------ where it matched, and */}
      <aside
        className={clsx(
          'border-base-content/15 flex flex-col',
          compact
            ? 'min-h-0 w-full flex-1 border-t'
            : 'h-full w-[24rem] shrink-0 border-s xl:w-[28rem]',
        )}
      >
        <div className='border-base-content/15 flex items-center justify-between gap-2 border-b px-4 py-3'>
          {/* The work whose passages are on show is also a way into the book
              itself — with or without a search behind those passages. */}
          <button
            type='button'
            disabled={!work || !onOpenBook}
            onClick={() => {
              if (work && onOpenBook) onOpenBook(work);
            }}
            aria-label={work ? _('Open {{title}}', { title: work.title }) : _('Nothing selected')}
            className={clsx(
              'group min-w-0 flex-1 text-left',
              work && onOpenBook ? 'cursor-pointer' : 'cursor-default',
            )}
          >
            <div className='text-base-content/45 text-[10px] tracking-[0.18em] uppercase'>
              {work
                ? _('{{count}} results from this work', { count: matchEntries.length })
                : _('Matched passages')}
            </div>
            <div
              className={clsx(
                'truncate text-sm font-medium',
                work && onOpenBook && 'group-hover:text-primary group-hover:underline',
              )}
            >
              {work?.title ?? _('Nothing selected')}
            </div>
          </button>
          <button
            type='button'
            onClick={onExit}
            aria-label={_('Close spiral view')}
            className='text-base-content/50 hover:text-base-content shrink-0'
          >
            <MdClose className='h-4 w-4' />
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
          {matchEntries.length === 0 && (
            <p className='text-base-content/50 text-sm'>
              {textSearchActive
                ? _('No matches in this work yet.')
                : _('Search the contents to see matching passages here.')}
            </p>
          )}
          <div className='flex flex-col gap-2'>
            {matchEntries.map((item, index) => (
              <button
                key={index}
                type='button'
                onClick={() => {
                  setSelectedMatch(index);
                  if (work) void openMatch(work, item.match);
                }}
                className={clsx(
                  'border px-3 py-2 text-left transition-colors',
                  index === selectedMatch
                    ? 'border-primary bg-primary/5'
                    : 'border-base-content/12 hover:bg-base-200/60',
                )}
              >
                <div className='text-base-content/45 mb-1 text-[10px] tracking-[0.12em] uppercase'>
                  {item.section}
                </div>
                <p className='text-base-content/80 text-[13px] leading-snug'>
                  …{item.match.excerpt.pre}
                  <mark className='bg-primary/25 text-base-content px-0.5'>
                    {item.match.excerpt.match}
                  </mark>
                  {item.match.excerpt.post}…
                </p>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
};

export default SpiralSearchView;
