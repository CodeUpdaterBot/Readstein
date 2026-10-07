// The spiral dial is the library's search laid out along the timeline, so the
// things worth pinning down are: it draws a band per populated stretch of years,
// the wheel walks the timeline, the works ring follows the selected band, and
// choosing a work swaps the passage list. The search service is stubbed because
// these are the dial's own mechanics, not the scanner's.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

// Events the stubbed scanner yields, so a test can drive a live search, plus a
// call counter so reuse of a finished scan can be proven rather than assumed.
let mockEvents: unknown[] = [];
let searchCalls = 0;
vi.mock('@/services/librarySearchService', () => ({
  searchLibraryBooks: async function* () {
    searchCalls += 1;
    for (const event of mockEvents) yield event;
  },
  createLibrarySearchSession: () => ({}),
  resolveSearchResultCfi: async () => 'cfi',
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options[name] ?? '')) : key,
}));

import SpiralSearchView from '@/app/library/components/SpiralSearchView';

// jsdom reports every element as 0x0, and the dial deliberately treats a narrow
// box as a phone — so without this, every test here would silently exercise the
// compact layout. Give the suite a desktop viewport; the phone test overrides it.
const setViewport = (width: number, height: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
};
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
setViewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
import { clearLibrarySearchSnapshot } from '@/app/library/utils/librarySearchSnapshot';

// jsdom has no ResizeObserver, which the dial uses to size its arc.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

const book = (hash: string, title: string, year: number): Book =>
  ({
    hash,
    title,
    author: 'A. Author',
    format: 'PDF',
    metadata: { published: String(year) },
  }) as Book;

const BOOKS: Book[] = [
  book('a', 'Divinae Institutiones', 300),
  book('b', 'De Ira Dei', 310),
  book('c', 'City of God', 426),
  book('d', 'Pugio fidei', 1280),
  book('e', 'Fortalitium Fidei', 1459),
];

const renderDial = (query = '') =>
  render(
    <SpiralSearchView
      appService={{} as AppService}
      books={BOOKS}
      query={query}
      config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
      target='books'
      onQueryChange={() => {}}
      onSelectResult={() => {}}
      onExit={() => {}}
    />,
  );

describe('SpiralSearchView', () => {
  beforeEach(() => cleanup());

  it('lays out as columns on a desktop viewport', () => {
    const { container } = renderDial();
    expect(container.firstElementChild?.className).toContain('flex-row');
    expect(screen.queryByLabelText('Zoom in')).toBeNull(); // no buttons: the wheel zooms
  });

  it('draws a band for the years the library holds, newest first', () => {
    renderDial();
    // The oldest band is drawn (nothing is scrolled away yet) and the ring is
    // bounded by the years that exist — no empty centuries appear as bands.
    expect(screen.getAllByText(/\d{3,4}/).length).toBeGreaterThan(1);
    expect(screen.getByText('5 works')).toBeTruthy();
  });

  it('walks the timeline with the wheel — up newer, down older', () => {
    const { container } = renderDial();
    const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
    const before = screen.getByText('5 works').textContent;
    fireEvent.wheel(dial, { deltaY: -120 });
    // Scrolling up selects a newer band, so the header line changes.
    expect(screen.getAllByText(/work from/).length).toBeGreaterThan(0);
    expect(before).toBeTruthy();
  });

  it('shows each work its own cover, with the format kept as a chip', () => {
    // The card used to carry a bare format badge where the cover belongs.
    renderDial();
    fireEvent.click(screen.getByText('300\u2013309'));
    const cover = document.querySelector('.book-cover-container')!;
    expect(cover).toBeTruthy();
    expect(screen.getAllByText('PDF').length).toBeGreaterThan(0);

    // The size has to live on the wrapper: BookCover's own root carries h-full w-full,
    // which out-ranks a size passed to it, and covers then render at natural size —
    // enormous. This is the regression that shipped once.
    const wrapper = cover.parentElement!;
    expect(wrapper.className).toContain('h-16');
    expect(wrapper.className).toContain('w-11');
    expect(cover.className).not.toContain('h-16');
  });

  it('clears the query from the hub', () => {
    const onQueryChange = vi.fn();
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={BOOKS}
        query='Lactantius'
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='text'
        onQueryChange={onQueryChange}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    expect((screen.getByPlaceholderText('Search') as HTMLInputElement).value).toBe('Lactantius');
    fireEvent.click(screen.getByLabelText('Clear Search'));
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('lists the works of the selected band', () => {
    renderDial();
    // The dial opens in the middle of the collection, so pick the 300s explicitly.
    fireEvent.click(screen.getByText('300\u2013309'));
    const works = screen.getAllByText(/Divinae Institutiones|De Ira Dei/);
    expect(works.length).toBeGreaterThan(0);
  });
});

describe('SpiralSearchView orientation and counts', () => {
  beforeEach(() => {
    cleanup();
    mockEvents = [];
    searchCalls = 0;
    clearLibrarySearchSnapshot();
  });

  // Two clusters of years, far apart, so the dial must show two bands.
  const SPREAD: Book[] = [
    ...[300, 305, 310, 315, 320, 325].map((year, i) => book(`old${i}`, `Old ${year}`, year)),
    ...[2000, 2005, 2010, 2015, 2020, 2025].map((year, i) => book(`new${i}`, `New ${year}`, year)),
  ];

  it('puts newer years above older ones', () => {
    const { container } = render(
      <SpiralSearchView
        appService={{} as AppService}
        books={SPREAD}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    // Band edges snap to round numbers, so match on the leading year rather than
    // on an exact label.
    const labels = Array.from(container.querySelectorAll('text'))
      .map((node) => ({ text: node.textContent ?? '', y: Number(node.getAttribute('y')) }))
      .filter((entry) => /^\d{3,4}/.test(entry.text));
    const oldest = labels.find((entry) => entry.text.startsWith('300'));
    const newest = labels.find((entry) => entry.text.startsWith('2000'));
    expect(oldest).toBeTruthy();
    expect(newest).toBeTruthy();
    // Smaller y is higher on screen: the later years belong there.
    expect(newest!.y).toBeLessThan(oldest!.y);
  });

  const searchWith = (subitems: number) => {
    mockEvents = [
      {
        type: 'result',
        book: BOOKS[0],
        result: {
          index: 1,
          label: 'Book I',
          subitems: Array.from({ length: subitems }, (_, i) => ({
            locator: { section: 1, start: i * 4, end: i * 4 + 4 },
            excerpt: { pre: 'a ', match: 'Lact', post: ' b' },
          })),
        },
      },
      {
        type: 'completed',
        searchedBooks: 1,
        skippedBooks: 0,
        erroredBooks: 0,
        matchCount: subitems,
      },
    ];
  };
  // The gauge only exists while a content search is running, so these render with
  // the full-text target the header's search uses.
  const renderSearch = (query: string) =>
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={BOOKS}
        query={query}
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='text'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );

  const tickCounts = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-density-ticks]')].map((node) =>
      Number(node.getAttribute('data-density-ticks')),
    );

  it('draws one density tick per three matches, and none at all without a search', async () => {
    // With no query there is no density to show, and an empty gauge on every tile
    // would be pure noise.
    const idle = renderDial('');
    expect(tickCounts(idle.container)).toEqual([]);
    idle.unmount();

    searchWith(1);
    const one = renderSearch('Lact');
    await screen.findByText('1 result');
    expect(tickCounts(one.container)).toEqual([1]);
    one.unmount();
    // The finished scan is cached per query; drop it so the next case really runs.
    clearLibrarySearchSnapshot();

    searchWith(6);
    const two = renderSearch('Lact');
    await screen.findByText('6 results');
    expect(tickCounts(two.container)).toEqual([2]);
    two.unmount();
    clearLibrarySearchSnapshot();

    searchWith(30);
    const full = renderSearch('Lact');
    await screen.findByText('30 results');
    // A saturated gauge stops at seven ticks rather than running off the tile.
    expect(tickCounts(full.container)).toEqual([7]);
    const ticks = [...full.container.querySelectorAll('.fill-error')];
    expect(ticks).toHaveLength(7);
    // Marks never change size, however full the gauge: it is the band they sit in
    // that gives way.
    expect(new Set(ticks.map((tick) => tick.getAttribute('width')))).toEqual(new Set(['9']));
    expect(new Set(ticks.map((tick) => tick.getAttribute('height')))).toEqual(new Set(['5']));

    // And they are spaced evenly along the tile's arc, not piled on one spot.
    const svgHeight = Number(full.container.querySelector('svg')?.getAttribute('height'));
    const cx = -0.06 * svgHeight;
    const cy = svgHeight / 2;
    const angles = ticks
      .map((tick) => tick.getAttribute('transform')!.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!)
      .map((match) => Math.atan2(Number(match[2]) - cy, Number(match[1]) - cx))
      .sort((a, b) => a - b);
    expect(new Set(angles.map((angle) => angle.toFixed(6))).size).toBe(7);
    const gaps = angles.slice(1).map((angle, i) => angle - angles[i]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 9);
    for (const tick of ticks) {
      // `rotate` takes a single argument: it turns about the point the translate
      // just set, so the bar lies along the tile's arc.
      expect(tick.getAttribute('transform')).toMatch(/rotate\(-?[\d.]+\)$/);
    }
  });

  const dialGeometry = (container: HTMLElement) => {
    const svgHeight = Number(container.querySelector('svg')?.getAttribute('height'));
    const cx = -0.06 * svgHeight;
    const cy = svgHeight / 2;
    const plate = [...container.querySelectorAll('path')].find(
      (element) => ((element.getAttribute('d') ?? '').match(/A [\d.]+ /g) ?? []).length >= 2,
    )!;
    const [rInner, rOuter] = [...plate.getAttribute('d')!.matchAll(/A ([\d.]+) /g)].map((match) =>
      Number(match[1]),
    );
    const label = container.querySelector('text')!;
    return {
      rInner: rInner!,
      rOuter: rOuter!,
      labelRadius: Math.hypot(
        Number(label.getAttribute('x')) - cx,
        Number(label.getAttribute('y')) - cy,
      ),
      dateFont: Number.parseFloat(label.style.fontSize),
    };
  };

  it('gives the date back its tile when there is no gauge to make room for', () => {
    // With nothing to gauge, a label held off-centre just looks like a mistake:
    // the lane collapses and the date sits in the middle of its tile again.
    const idle = renderDial('');
    const idleGeometry = dialGeometry(idle.container);
    expect(idleGeometry.labelRadius).toBeCloseTo(
      (idleGeometry.rInner + idleGeometry.rOuter) / 2,
      1,
    );
    idle.unmount();
  });

  it('holds the date back from the outer lane, so the gauge never crowds it', async () => {
    // Centring the date in the tile's full thickness ran its last glyphs into the
    // tick marks. While a gauge is showing, the ticks own the outer edge and the
    // date sits in what is left.
    searchWith(30);
    const { container } = renderSearch('Lact');
    await screen.findByText('30 results');
    const { rInner, rOuter, labelRadius, dateFont } = dialGeometry(container);

    const tick = container.querySelector('.fill-error')!.getAttribute('transform')!;
    const [, tickX, tickY] = tick.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!;
    const svgHeight = Number(container.querySelector('svg')?.getAttribute('height'));
    const tickRadius = Math.hypot(Number(tickX) - -0.06 * svgHeight, Number(tickY) - svgHeight / 2);

    // Held inside the band the gauge's lane leaves.
    expect(labelRadius).toBeLessThan((rInner + rOuter) / 2);
    // And clear of the marks by more than the marks are thick.
    expect(tickRadius - 2.5 - (labelRadius + dateFont * 0.55)).toBeGreaterThan(9);
    // Riding the outer edge, not floating inside it.
    expect(tickRadius).toBeGreaterThan(rOuter - 10);
  });

  it('shows the result count with the span of years those results cover', async () => {
    mockEvents = [
      {
        type: 'result',
        book: BOOKS[0],
        result: {
          index: 1,
          label: 'Book I',
          subitems: [
            {
              locator: { section: 1, start: 0, end: 4 },
              excerpt: { pre: 'a ', match: 'Lact', post: ' b' },
            },
            {
              locator: { section: 1, start: 9, end: 13 },
              excerpt: { pre: 'c ', match: 'Lact', post: ' d' },
            },
          ],
        },
      },
      {
        type: 'result',
        book: BOOKS[1],
        result: {
          index: 1,
          label: 'Book I',
          subitems: [
            {
              locator: { section: 1, start: 0, end: 4 },
              excerpt: { pre: 'e ', match: 'Lact', post: ' f' },
            },
          ],
        },
      },
      { type: 'completed', searchedBooks: 2, skippedBooks: 0, erroredBooks: 0, matchCount: 3 },
    ];
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={BOOKS}
        query='Lact'
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='text'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    // The headline is the whole search; underneath it is the stretch of history
    // those results reach across — here two books of 300 and 310, so eleven years.
    expect(await screen.findByText('3 results')).toBeTruthy();
    expect(screen.getByText('across 11 years')).toBeTruthy();
  });

  it('measures that span from the earliest year to the latest, before Christ included', () => {
    // 400 BC to 1459 AD. The arithmetic is a subtraction of years, never a
    // difference between printed labels, so the BC end does not fold toward zero.
    const books: Book[] = [
      { hash: 'a', title: 'De Ira Dei', metadata: { published: '400 BC' } } as Book,
      { hash: 'b', title: 'Fortalitium Fidei', metadata: { published: '1459' } } as Book,
    ];
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={books}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText('across 1860 years')).toBeTruthy();
  });

  it('says a single year when every work sits in the same one', () => {
    const books: Book[] = [book('a', 'Same year', 1459), book('b', 'Same year too', 1459)];
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={books}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText('across 1 year')).toBeTruthy();
  });
});

// The hub header reads "<n> bands | <step>yr" in two spans, so read the row.
const scaleText = () => screen.getByTestId('dial-scale').textContent ?? '';

describe('SpiralSearchView zoom', () => {
  beforeEach(() => {
    cleanup();
    mockEvents = [];
    searchCalls = 0;
    clearLibrarySearchSnapshot();
  });

  const SPREAD: Book[] = [
    ...[300, 305, 310, 315, 320, 325].map((year, i) => book(`old${i}`, `Old ${year}`, year)),
    ...[2000, 2005, 2010, 2015, 2020, 2025].map((year, i) => book(`new${i}`, `New ${year}`, year)),
  ];

  const renderSpread = () =>
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={SPREAD}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );

  it('cuts the timeline more coarsely when zoomed out with ctrl+wheel', () => {
    // A dense run, so zooming out can actually merge neighbouring bands.
    const dense: Book[] = Array.from({ length: 12 }, (_, i) =>
      book(`d${i}`, `Dense ${1900 + i}`, 1900 + i),
    );
    const { container } = render(
      <SpiralSearchView
        appService={{} as AppService}
        books={dense}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
    // A decade per tile by default, and the header says so.
    expect(scaleText()).toBe('2 bands | 10yr');
    // Three notches out: a score of years per tile, so the two decades merge.
    for (let i = 0; i < 3; i++) fireEvent.wheel(dial, { deltaY: 120, ctrlKey: true });
    expect(scaleText()).toBe('1 band | 20yr');
  });

  it('shows the step the zoom is using, in years', () => {
    renderSpread();
    // Two clusters six decades apart, a decade per tile: three tiles each.
    expect(scaleText()).toBe('6 bands | 10yr');
  });

  it('widens and narrows the range from the pair in the hub', () => {
    // The same ZOOM_STEPS the wheel walks, so a decade widens to twelve years and back.
    renderSpread();
    expect(scaleText()).toContain('| 10yr');
    fireEvent.click(screen.getByLabelText('More years per band'));
    expect(scaleText()).toContain('| 12yr');
    // The press is acknowledged on the number itself, not only by the ring re-cutting.
    expect(screen.getByTestId('dial-scale').className).toContain('scale-110');
    fireEvent.click(screen.getByLabelText('Fewer years per band'));
    expect(scaleText()).toContain('| 10yr');
  });

  it('gives those buttons the hint\u2019s colour and a size a quarter larger', () => {
    renderSpread();
    // Same colour as the hint beneath (text-base-content/85), sized 25% up on the
    // hint's 9px — the glyphs are the control, so they read a little stronger.
    for (const label of ['More years per band', 'Fewer years per band']) {
      const button = screen.getByLabelText(label);
      expect(button.className).toContain('text-base-content/85');
      expect(button.className).toContain('text-[11.25px]');
      expect(button.tagName).toBe('BUTTON');
    }
  });

  it('stops at both ends of the zoom instead of running off them', () => {
    renderSpread();
    const wider = screen.getByLabelText('More years per band');
    const narrower = screen.getByLabelText('Fewer years per band');

    for (let i = 0; i < 30; i++) fireEvent.click(narrower);
    expect(scaleText()).toContain('| 1yr');
    // no jest-dom matchers in this repo: read the property.
    expect((narrower as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('More years per band') as HTMLButtonElement).disabled).toBe(
      false,
    );

    for (let i = 0; i < 30; i++) fireEvent.click(wider);
    // The coarsest step is the collection in one band, and the header then quotes the
    // real reach of it rather than a step size.
    expect(scaleText()).toContain('1 band |');
    expect((screen.getByLabelText('More years per band') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Fewer years per band') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('zooms in to a band per year when scrolled up with ctrl held', () => {
    const { container } = renderSpread();
    const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
    // Nine notches in reaches the finest cut the list offers.
    for (let i = 0; i < 9; i++) fireEvent.wheel(dial, { deltaY: -120, ctrlKey: true });
    // Finest granularity: one band per distinct year, and the header says so.
    expect(scaleText()).toBe('12 bands | 1yr');
  });

  it('adopts a finished scan instead of searching the library again', async () => {
    mockEvents = [
      {
        type: 'result',
        book: BOOKS[0],
        result: {
          index: 1,
          label: 'Book I',
          subitems: [
            {
              locator: { section: 1, start: 0, end: 4 },
              excerpt: { pre: 'a ', match: 'Lact', post: ' b' },
            },
          ],
        },
      },
      { type: 'completed', searchedBooks: 1, skippedBooks: 0, erroredBooks: 0, matchCount: 1 },
    ];
    const first = render(
      <SpiralSearchView
        appService={{} as AppService}
        books={BOOKS}
        query='Lact'
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='text'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    expect(await screen.findByText('1 result')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searchCalls).toBe(1);
    first.unmount();

    // The other view mounting the same query must reuse that scan, not repeat it.
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={BOOKS}
        query='Lact'
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='text'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );
    expect(await screen.findByText('1 result')).toBeTruthy();
    expect(searchCalls).toBe(1);
  });
});

describe('SpiralSearchView whole-library zoom and phone layout', () => {
  beforeEach(() => {
    cleanup();
    mockEvents = [];
    searchCalls = 0;
    clearLibrarySearchSnapshot();
  });

  const SPAN: Book[] = [401, 700, 1459, 2029].map((year, i) => book(`s${i}`, `Span ${year}`, year));

  const renderWith = (books: Book[]) =>
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={books}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />,
    );

  it('zooms out until the whole library is a single range', () => {
    const { container } = renderWith(SPAN);
    const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
    expect(screen.queryByText('401\u20132029')).toBeNull();
    // Coarsest level: one band whose label is the library's own first and last year.
    for (let i = 0; i < 20; i++) fireEvent.wheel(dial, { deltaY: 120, ctrlKey: true });
    expect(screen.getByText('401\u20132029')).toBeTruthy();
    expect(scaleText()).toContain('1 band');
  });

  it('thickens the ring as you zoom out, so the tiles visibly grow', async () => {
    const { container } = renderWith(SPAN);
    expect(container.firstElementChild?.className).toContain('flex-row'); // desktop
    const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
    // The dial's own height, off the svg: the floor on plate thickness is
    // expressed as a fraction of it.
    const dialHeight = Number(container.querySelector('svg')?.getAttribute('height'));
    // A plate is the only path with two arcs: inner radius then outer radius.
    // (Icon glyphs in the hub also contain a single arc, so a plain
    // `querySelector('path')` would pick one of those up instead.)
    const radii = () => {
      for (const element of Array.from(container.querySelectorAll('path'))) {
        const found = [...(element.getAttribute('d') ?? '').matchAll(/A ([\d.]+) /g)].map((match) =>
          Number(match[1]),
        );
        if (found.length >= 2) return found;
      }
      return [];
    };

    // Fully in first, so the comparison spans the whole gesture.
    for (let i = 0; i < 12; i++) fireEvent.wheel(dial, { deltaY: -120, ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 420));
    const [innerThin, outerThin] = radii();
    const thinThickness = outerThin! - innerThin!;
    for (let i = 0; i < 30; i++) fireEvent.wheel(dial, { deltaY: 120, ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 420));
    const [innerFat, outerFat] = radii();
    const fatThickness = outerFat! - innerFat!;

    // The inner edge is anchored — the hub has to keep its clearance — and the
    // radius never inverts, which is what a mis-scaled frame used to do.
    expect(innerFat).toBeCloseTo(innerThin!, 1);
    expect(outerFat!).toBeGreaterThan(innerFat!);
    expect(innerThin).toBeGreaterThan(0);
    // Zoomed out, the tiles are visibly fatter, not merely re-cut.
    expect(fatThickness).toBeGreaterThan(thinThickness * 1.4);
    // And even at its thinnest a tile stays big enough to read its date.
    expect(thinThickness).toBeGreaterThan(dialHeight * 0.05);
  });

  it('never lets the browser animate a plate path, which would swing tiles about', () => {
    // `transition-all` makes the renderer interpolate `d`, so a fast scroll shows
    // the old shapes sliding and swinging inwards while the bands are re-cut.
    // Plates must transition colour only; the geometry is animated by the ring
    // scale instead.
    const { container } = renderWith(SPAN);
    const plates = Array.from(container.querySelectorAll('path')).filter(
      (element) =>
        !element.hasAttribute('data-gap-wedge') &&
        ((element.getAttribute('d') ?? '').match(/A [\d.]+ /g) ?? []).length >= 2,
    );
    expect(plates.length).toBeGreaterThan(0);
    for (const plate of plates) {
      expect(plate.getAttribute('class')).toContain('transition-colors');
      expect(plate.getAttribute('class')).not.toContain('transition-all');
    }
  });

  it('opens in the middle of the collection, with bands on both sides', () => {
    // Opening on the oldest band left the tiles strung along the top of the ring and
    // an empty half beneath them. The middle keeps the selection between neighbours.
    renderWith(SPAN);
    expect(screen.getByText(/work from 700\u2013709/)).toBeTruthy();
    expect(screen.getByText('400\u2013409')).toBeTruthy();
    expect(screen.getByText('2020\u20132029')).toBeTruthy();
  });

  it('holds the selected period while the scan inserts bands around it', () => {
    // The reported bug: results stream in, every arrival inserts a band into the
    // timeline, and an index-based selection slid onto a neighbouring century each
    // time — so the tiles appeared to reset and older results never seemed to appear
    // below the one the user was reading.
    const dialProps = (books: Book[]) => (
      <SpiralSearchView
        appService={{} as AppService}
        books={books}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onExit={() => {}}
      />
    );
    const mid = book('m', 'Mid', 1400);
    const view = render(dialProps([mid, book('n', 'New', 1990)]));
    // Stop on the 1400s.
    fireEvent.click(screen.getByText('1400\u20131409'));
    expect(screen.getByText(/work from 1400\u20131409/)).toBeTruthy();

    // An older result arrives: its band belongs below the selected one.
    view.rerender(dialProps([book('o', 'Older', 700), mid, book('n', 'New', 1990)]));
    expect(screen.getByText('700\u2013709')).toBeTruthy();
    // The selection has not moved with it.
    expect(screen.getByText(/work from 1400\u20131409/)).toBeTruthy();
  });

  it('opens a work straight from the dial when no search is running', () => {
    // With no query there are no passages to reveal, so a tap on a work should be
    // a way into it rather than a dead end.
    const opened: Book[] = [];
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={SPAN}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onOpenBook={(book) => opened.push(book)}
        onExit={() => {}}
      />,
    );
    // The card carries the title of the work it would open.
    const card = screen.getByTitle(/^Open /);
    const cardTitle = (card.getAttribute('title') ?? '').replace('Open ', '');
    fireEvent.click(card);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.title).toBe(cardTitle);
  });

  it('opens the selected work from its title in the passages panel', () => {
    // The panel names the work whose passages are showing; that name is the other
    // way in, whether or not a search produced those passages.
    const opened: Book[] = [];
    render(
      <SpiralSearchView
        appService={{} as AppService}
        books={SPAN}
        query=''
        config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
        target='books'
        onQueryChange={() => {}}
        onSelectResult={() => {}}
        onOpenBook={(book) => opened.push(book)}
        onExit={() => {}}
      />,
    );
    const title = screen.getByRole('button', { name: /^Open / });
    const label = title.getAttribute('aria-label') ?? '';
    fireEvent.click(title);
    expect(opened).toHaveLength(1);
    expect(label).toContain(opened[0]!.title);
  });

  const selectedLabel = (container: HTMLElement) => {
    const group = [...container.querySelectorAll('g')].find((node) =>
      node.textContent?.includes('Selected'),
    );
    return [...(group?.querySelectorAll('text') ?? [])].map((node) => node.textContent)[0] ?? '';
  };

  const trayOf = (container: HTMLElement) =>
    container.querySelector('[data-testid="works-tray"]') as HTMLElement;

  const phone = (body: () => void) => {
    setViewport(390, 844);
    try {
      body();
    } finally {
      setViewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    }
  };

  it('keeps the dial on the left, hangs the band\u2019s works off the ring, and stacks the rest', () => {
    phone(() => {
      const { container } = renderWith(SPAN);
      expect(container.firstElementChild?.className).toContain('flex-col');
      expect(screen.getByText('Drag up')).toBeTruthy();
      // The dial keeps the left of the top row on a phone too — its own centre is off
      // the left edge, which is what makes the ring read as a ring.
      const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
      expect(dial.className).not.toContain('mx-auto');
      // The band's works are chips riding outside the ring, each with its own cover,
      // rather than a column of screen spent on them.
      expect(container.querySelectorAll('.book-cover-container').length).toBeGreaterThan(0);
      // Works and passages share one tray, with a handle to size it.
      expect(trayOf(container)).toBeTruthy();
      expect(container.querySelector('[data-testid="tray-handle"]')).toBeTruthy();
      // Nothing scrolls sideways any more: a strip of cards under a thumb was the
      // thing this layout could not cope with.
      expect(container.querySelector('.overflow-x-auto')).toBeNull();
    });
  });

  it('holds the tray at a fixed height whatever the works are, and lets the handle set it', () => {
    phone(() => {
      const one = renderWith([book('a', 'One', 1500)] as Book[]);
      const oneHeight = Number.parseFloat(trayOf(one.container).style.height);
      one.unmount();

      const many = renderWith(
        Array.from({ length: 6 }, (_, i) => book(`m${i}`, `Many ${1500 + i}`, 1500 + i)) as Book[],
      );
      const manyHeight = Number.parseFloat(trayOf(many.container).style.height);
      // The number of matches must not move the tray — that is what made every tap on
      // a tile re-cut the whole screen and shove everything else around.
      expect(manyHeight).toBe(oneHeight);

      // Two cards' worth of works in sight; the rest scrolls inside the tray.
      const list = many.container.querySelector(
        '[data-testid="works-sheet"] .overflow-y-auto',
      ) as HTMLElement;
      expect(list.style.maxHeight).toBe('118px');
      // Capped, not fixed: a single match leaves no blank half-row behind it.
      expect(list.style.height).toBe('');

      // Dragging the handle up grows the tray by the drag, and the dial gives up the
      // room rather than anything below jumping.
      const handle = many.container.querySelector('[data-testid="tray-handle"]') as HTMLElement;
      fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 420, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientY: 420, pointerId: 1 });
      expect(Number.parseFloat(trayOf(many.container).style.height)).toBe(oneHeight + 80);
    });
  });

  it('walks the timeline on a touch drag, on a phone and on a wide touchscreen', () => {
    const drag = (container: HTMLElement, from: number, to: number) => {
      const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
      fireEvent.touchStart(dial, { touches: [{ clientY: from }] });
      fireEvent.touchMove(dial, { touches: [{ clientY: to }] });
      fireEvent.touchEnd(dial, { touches: [] });
    };

    phone(() => {
      const { container } = renderWith(SPAN);
      const before = selectedLabel(container);
      drag(container, 400, 330); // upward: towards newer years
      expect(selectedLabel(container)).not.toBe(before);
    });

    // A tablet in landscape: wide enough for the desktop layout, and still no wheel.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = renderWith(SPAN);
      expect(container.firstElementChild?.className).toContain('flex-row');
      const before = selectedLabel(container);
      drag(container, 400, 330);
      expect(selectedLabel(container)).not.toBe(before);
    } finally {
      window.matchMedia = original;
    }
  });

  it('hugs the hub with the tiles while keeping the years clear of it', () => {
    phone(() => {
      const { container } = renderWith(SPAN);
      const hub = container.querySelector('[data-testid="dial-hub"]') as HTMLElement;
      const hubRight = Number.parseFloat(hub.style.left) + Number.parseFloat(hub.style.width);
      const height = Number(container.querySelector('svg')?.getAttribute('height'));
      const cx = -0.06 * height;
      const plate = Array.from(container.querySelectorAll('path')).find(
        (element) =>
          !element.hasAttribute('data-gap-wedge') &&
          ((element.getAttribute('d') ?? '').match(/A [\d.]+ /g) ?? []).length >= 2,
      )!;
      const inner = Number((plate.getAttribute('d') ?? '').match(/A ([\d.]+) /)![1]);
      const tileClearance = cx + inner - hubRight;

      // Snug: a tile's inner edge sits a few pixels off the hub, not a ring-width away.
      // Pushing the whole ring out to stop years being clipped left a visible gap.
      expect(tileClearance).toBeGreaterThan(0);
      expect(tileClearance).toBeLessThan(20);

      // And the year still clears the hub, because the label rides the outer part of
      // the ring rather than its centre. The selected tile points straight right, so
      // its label's x is the label radius exactly.
      const group = [...container.querySelectorAll('g')].find((node) =>
        node.textContent?.includes('Selected'),
      )!;
      const labelX = Number(group.querySelector('text')?.getAttribute('x'));
      expect(labelX - hubRight).toBeGreaterThan(40);
    });
  });

  it('tucks the hub away on a sideways swipe, and brings it back with a tap', () => {
    phone(() => {
      const { container } = renderWith(SPAN);
      const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
      const radial = () => {
        const plate = Array.from(container.querySelectorAll('path')).find(
          (element) =>
            !element.hasAttribute('data-gap-wedge') &&
            ((element.getAttribute('d') ?? '').match(/A [\d.]+ /g) ?? []).length >= 2,
        )!;
        return [...(plate.getAttribute('d') ?? '').matchAll(/A ([\d.]+) /g)].map((m) =>
          Number(m[1]),
        );
      };
      const [innerBefore, outerBefore] = radial();

      // Leftward and mostly horizontal: the ring is what the user wants to look at.
      fireEvent.touchStart(dial, { touches: [{ clientX: 300, clientY: 400 }] });
      fireEvent.touchMove(dial, { touches: [{ clientX: 200, clientY: 404 }] });
      fireEvent.touchEnd(dial, { touches: [] });

      expect(screen.getByLabelText('Show search')).toBeTruthy();
      // The ring spreads: it reaches further in towards the edge and further out, so
      // the whole dial is larger without the tiles turning back into slabs.
      const [innerAfter, outerAfter] = radial();
      expect(innerAfter!).toBeLessThan(innerBefore!);
      expect(outerAfter! - innerAfter!).toBeGreaterThan(outerBefore! - innerBefore!);

      // And the blob is the way back.
      fireEvent.click(screen.getByLabelText('Show search'));
      expect(screen.queryByLabelText('Show search')).toBeNull();
      expect(container.querySelector('[data-testid="dial-scale"]')).toBeTruthy();
    });
  });

  it('collapses the hub from its rim as well as by swiping', () => {
    phone(() => {
      const { container } = renderWith(SPAN);
      // A swipe is not the only way in — and the button sits on the circle's lower left,
      // clear of the search field, which is the point of the control.
      const collapse = screen.getByLabelText('Hide search');
      const hubBox = container.querySelector('[data-testid="dial-hub"]') as HTMLElement;
      const hubR = Number.parseFloat(hubBox.style.width) / 2;
      expect(Number.parseFloat(collapse.style.top)).toBeGreaterThan(hubR);
      expect(Number.parseFloat(collapse.style.left)).toBeLessThan(hubR);

      fireEvent.click(collapse);
      expect(screen.getByLabelText('Show search')).toBeTruthy();
      expect(container.querySelector('[data-testid="dial-scale"]')).toBeNull();

      fireEvent.click(screen.getByLabelText('Show search'));
      expect(container.querySelector('[data-testid="dial-scale"]')).toBeTruthy();
    });
  });

  it('fits every year inside its tile, and clear of the hub', () => {
    phone(() => {
      // A decade-wide band whose dates are ten characters long: the case that was
      // having characters cut off at both ends.
      const { container } = renderWith(
        [1960, 1966, 1972, 1980, 1990, 2000].map((year, i) =>
          book(`y${i}`, `Year ${year}`, year),
        ) as Book[],
      );
      const height = Number(container.querySelector('svg')?.getAttribute('height'));
      const cx = -0.06 * height;
      const hub = container.querySelector('[data-testid="dial-hub"]') as HTMLElement;
      const hubR = Number.parseFloat(hub.style.width) / 2;
      const hubCx = Number.parseFloat(hub.style.left) + hubR;
      const cy = Number.parseFloat(hub.style.top) + hubR;

      const groups = [...container.querySelectorAll('g')].filter((node) =>
        node.querySelector('[data-date-font]'),
      );
      expect(groups.length).toBeGreaterThan(3);

      for (const group of groups) {
        const label = group.querySelector('[data-date-font]')!;
        const font = Number(label.getAttribute('data-date-font'));
        const text = label.textContent ?? '';
        const x = Number(label.getAttribute('x'));
        const y = Number(label.getAttribute('y'));
        // the same factor the component fits with (GLYPH_WIDTH)
        const width = text.length * font * 0.68;

        // Inside its own arc, so the range is not cut left or right on the tile...
        const radius = Math.hypot(x - cx, y - cy);
        const arc = (((24 - 1.4) * Math.PI) / 180) * radius;
        expect(width).toBeLessThanOrEqual(arc + 0.5);

        // ...and outside the hub. The nearest corner of the text box has to clear the
        // circle: checking the label's *centre* was what let a clipped year through.
        const dx = Math.max(Math.abs(x - hubCx) - width / 2, 0);
        const dy = Math.max(Math.abs(y - cy) - font * 0.6, 0);
        expect(Math.hypot(dx, dy)).toBeGreaterThan(hubR);
      }
    });
  });

  it('names the gesture the device actually has', () => {
    phone(() => {
      const onPhone = renderWith(SPAN);
      expect(screen.getByText('Pinch to zoom')).toBeTruthy();
      expect(screen.queryByText('Ctrl + scroll to zoom')).toBeNull();
      onPhone.unmount();
    });
    renderWith(SPAN);
    expect(screen.getByText('Ctrl + scroll to zoom')).toBeTruthy();
    expect(screen.queryByText('Pinch to zoom')).toBeNull();
  });

  it('re-cuts the timeline when two fingers pinch', () => {
    phone(() => {
      const { container } = renderWith(SPAN);
      const dial = container.querySelector('[aria-label="Year dial"]') as HTMLElement;
      const at = (clientX: number) => ({ clientX, clientY: 300 });
      expect(scaleText()).toContain('| 10yr');

      // Fingers apart is zoom in: fewer years a band, as scrolling up does.
      fireEvent.touchStart(dial, { touches: [at(100), at(200)] });
      fireEvent.touchMove(dial, { touches: [at(80), at(240)] });
      expect(scaleText()).toContain('| 9yr');

      // And back together is zoom out.
      fireEvent.touchMove(dial, { touches: [at(140), at(160)] });
      expect(scaleText()).toContain('| 10yr');

      // A pinch must not be mistaken for a drag: the two-finger move never walked
      // the timeline on its way through.
      fireEvent.touchEnd(dial, { touches: [] });
    });
  });

  it('keeps the − / + pair in the hub on a phone, and only there', () => {
    phone(() => {
      const { container } = renderWith(SPAN);
      expect(screen.getByLabelText('More years per band')).toBeTruthy();
      expect(screen.getByLabelText('Fewer years per band')).toBeTruthy();
      // The old floating pair at the dial's corner is gone, and so is its literal
      // "\u2212" text.
      expect(screen.queryByLabelText('Zoom in')).toBeNull();
      expect(screen.queryByLabelText('Zoom out')).toBeNull();
      expect(container.textContent).not.toContain('u2212');
      expect(scaleText()).toContain('|');
    });
  });
});

describe('gaps in the timeline', () => {
  beforeEach(() => cleanup());

  const dialProps = (books: Book[]) => (
    <SpiralSearchView
      appService={{} as AppService}
      books={books}
      query=''
      config={{ scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false }}
      target='books'
      onQueryChange={() => {}}
      onSelectResult={() => {}}
      onExit={() => {}}
    />
  );

  const wedgeNodes = (container: HTMLElement) => [
    ...container.querySelectorAll('[data-gap-wedge]'),
  ];
  const wedgeYears = (container: HTMLElement) =>
    wedgeNodes(container).map((node) => Number(node.getAttribute('data-gap-wedge')));

  /** The angular width of one wedge, in degrees, read off its own path. */
  const spanOf = (node: Element, container: HTMLElement) => {
    const height = Number(container.querySelector('svg')?.getAttribute('height'));
    const cx = -0.06 * height;
    const cy = height / 2;
    // Anchored: the path opens with the inner arc, so this takes the M point and the
    // point that arc lands on — both on one radius, so their angles differ by exactly
    // the wedge's span.
    const [x1, y1, x2, y2] = (node.getAttribute('d') ?? '')
      .match(/^M ([\d.-]+) ([\d.-]+) A [\d.]+ [\d.]+ [\d ]+ ([\d.-]+) ([\d.-]+)/)!
      .slice(1)
      .map(Number);
    const a1 = (Math.atan2(y1! - cy, x1! - cx) * 180) / Math.PI;
    const a2 = (Math.atan2(y2! - cy, x2! - cx) * 180) / Math.PI;
    const diff = Math.abs(a2 - a1);
    return Math.min(diff, 360 - diff);
  };
  const wedgeSpan = (container: HTMLElement, years: number) =>
    spanOf(
      wedgeNodes(container).find((node) => Number(node.getAttribute('data-gap-wedge')) === years)!,
      container,
    );

  const angleOf = (container: HTMLElement, label: string) => {
    const node = [...container.querySelectorAll('text')].find((n) => n.textContent === label)!;
    const height = Number(container.querySelector('svg')?.getAttribute('height'));
    const cx = -0.06 * height;
    return (
      (Math.atan2(
        Number(node.getAttribute('y')) - height / 2,
        Number(node.getAttribute('x')) - cx,
      ) *
        180) /
      Math.PI
    );
  };

  it('marks a hole only when it is wider than one tile', () => {
    // 1200 and 1220 leave a ten-year hole — the ordinary spacing between bands, so
    // nothing is drawn. 1200 and 1400 leave 190 years, which is worth showing.
    const close = render(dialProps([book('a', 'A', 1200), book('b', 'B', 1220)] as Book[]));
    expect(wedgeYears(close.container)).toEqual([]);
    close.unmount();

    const far = render(dialProps([book('a', 'A', 1200), book('b', 'B', 1400)] as Book[]));
    expect(wedgeYears(far.container)).toEqual([190]);
    expect(far.container.querySelector('[data-gap-wedge] title')?.textContent).toContain(
      '1210\u20131399',
    );
    // Full tile depth: it is the *width* of the gap that stays thin, not the slice.
    const radiiOf = (node: Element) =>
      [...(node.getAttribute('d') ?? '').matchAll(/A ([\d.]+) /g)].map((m) => Number(m[1]));
    const wedgePath = far.container.querySelector('[data-gap-wedge]')!;
    const platePath = [...far.container.querySelectorAll('path')].find(
      (element) =>
        !element.hasAttribute('data-gap-wedge') &&
        ((element.getAttribute('d') ?? '').match(/A [\d.]+ /g) ?? []).length >= 2,
    )!;
    expect(radiiOf(wedgePath)).toEqual(radiiOf(platePath));
  });

  it('keeps a wedge the same size as the zoom changes', () => {
    // The same four-century hole, seen at a decade per tile and much coarser. Its
    // size must not depend on the zoom: the hole is a quarter of the collection's
    // reach either way, and that is what the wedge is measured against.
    const books = [400, 1200, 1600].map((year, i) => book(`b${i}`, `Book ${year}`, year));
    const fine = render(dialProps(books as Book[]));
    const fineSpan = wedgeSpan(fine.container, 390);
    fine.unmount();

    const coarse = render(dialProps(books as Book[]));
    const dial = coarse.container.querySelector('[aria-label="Year dial"]') as HTMLElement;
    for (let i = 0; i < 12 && !scaleText().endsWith('50yr'); i++) {
      fireEvent.wheel(dial, { deltaY: 120, ctrlKey: true });
    }
    expect(scaleText()).toContain('50yr');
    // The grid moved, so the app now reads the hole as 350 years rather than 390: at
    // a five-decade zoom it genuinely cannot know which decade inside a band is
    // missing. That is a 10% shift in the hole, so the wedge may shift with it — what
    // must never happen again is the collapse to a hairline it used to do.
    const coarseSpan = wedgeSpan(coarse.container, 350);

    expect(coarseSpan).toBeGreaterThan(fineSpan * 0.85);
    expect(coarseSpan).toBeLessThan(fineSpan * 1.15);
    // And it is a slice you cannot miss, not the hairline it used to shrink to.
    expect(coarseSpan).toBeGreaterThan(18 * 0.3);
  });

  it('draws a small share of the collection as a hairline, a large one as a slice', () => {
    // One collection, one span (400\u20131229), two holes: 20 years and 790 years.
    const { container } = render(
      dialProps([400, 1200, 1230].map((y, i) => book(`b${i}`, `Book ${y}`, y)) as Book[]),
    );
    expect(wedgeYears(container).sort((a, b) => a - b)).toEqual([20, 790]);
    // 2% of the collection: a hairline, well under a tenth of a tile.
    expect(wedgeSpan(container, 20)).toBeLessThan(18 * 0.1);
    // 96% of it: capped, but still only a slice — never a tile of its own.
    expect(wedgeSpan(container, 790)).toBeGreaterThan(18 * 0.3);
    expect(wedgeSpan(container, 790)).toBeLessThanOrEqual(18 * 0.6 + 1);
  });

  it('parts the two tiles a wedge sits between', () => {
    const plain = render(
      dialProps([book('a', 'A', 1200), book('b', 'B', 1210), book('c', 'C', 1220)] as Book[]),
    );
    const plainGap = Math.abs(
      angleOf(plain.container, '1200\u20131209') - angleOf(plain.container, '1210\u20131219'),
    );
    plain.unmount();

    const holed = render(dialProps([book('a', 'A', 1200), book('b', 'B', 1400)] as Book[]));
    const holedGap = Math.abs(
      angleOf(holed.container, '1200\u20131209') - angleOf(holed.container, '1400\u20131409'),
    );

    // Neighbours with nothing missing sit one step apart; the pair around a wedge
    // sits a step plus the wedge plus its air. That extra must stay under one tile's
    // own arc, or the gap ends up reading as a tile of its own.
    expect(plainGap).toBeCloseTo(18, 1);
    const extra = holedGap - plainGap;
    expect(extra).toBeGreaterThan(18 * 0.05);
    expect(extra).toBeLessThan(18);
  });
});
