import { describe, expect, it, vi, beforeEach } from 'vitest';

const hello = vi.fn();
const listBooks = vi.fn();
const getConfig = vi.fn();
const putConfig = vi.fn();
const ingestFile = vi.fn();
const applyHostLibraryMetadata = vi.fn();

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/transfer', () => ({ tauriDownload: vi.fn() }));
vi.mock('@/utils/book', () => ({ getCoverFilename: (b: { hash: string }) => `${b.hash}.png` }));
vi.mock('@/utils/bookTitle', () => ({
  applyHostLibraryMetadata: (...args: unknown[]) => applyHostLibraryMetadata(...args),
}));
vi.mock('@/services/ingestService', () => ({
  ingestFile: (...args: unknown[]) => ingestFile(...args),
}));
vi.mock('@/services/lanHome/client', () => ({
  lanHomeHello: (...args: unknown[]) => hello(...args),
  lanHomeListBooks: (...args: unknown[]) => listBooks(...args),
  lanHomeGetConfig: (...args: unknown[]) => getConfig(...args),
  lanHomePutConfig: (...args: unknown[]) => putConfig(...args),
  lanHomeDownloadHeaders: () => ({}),
  lanHomeFileUrl: (h: string, p: number, hash: string) => `http://${h}:${p}/v1/books/${hash}/file`,
}));

const setLibrary = vi.fn();
let library: unknown[] = [];
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({ library, libraryLoaded: true, setLibrary }),
  },
}));

import { syncFromLanHome, type LanHomeSyncProgress } from '@/services/lanHome/sync';

type AnyBook = Record<string, unknown>;

const book = (hash: string, title: string): AnyBook => ({
  hash,
  title,
  author: 'A',
  format: 'EPUB',
  coverHash: '',
});

const hostItem = (hash: string, title: string, extra: Record<string, unknown> = {}) => ({
  hash,
  title,
  author: 'A',
  format: 'EPUB',
  filename: `${title}.epub`,
  hasFile: true,
  hasCover: false,
  hasConfig: false,
  ...extra,
});

const saveLibraryBooks = vi.fn(async (_books?: unknown) => undefined);

const appService = {
  loadLibraryBooks: vi.fn(async () => library),
  saveLibraryBooks,
  exists: vi.fn(async () => false),
  createDir: vi.fn(async () => undefined),
  resolveFilePath: vi.fn(async (p: string) => `C:/cache/${p}`),
  deleteFile: vi.fn(async () => undefined),
  deleteBook: vi.fn(async () => undefined),
  updateCoverImage: vi.fn(async () => undefined),
  computeCoverHash: vi.fn(async () => 'cover-hash'),
  generateCoverImageUrl: vi.fn(async () => 'url'),
  loadBookConfig: vi.fn(async () => ({ updatedAt: 0 })),
  saveBookConfig: vi.fn(async () => undefined),
} as never;

const runSync = async () => {
  const events: LanHomeSyncProgress[] = [];
  const result = await syncFromLanHome({
    host: '192.168.1.107',
    port: 17432,
    token: 'ABCD2345',
    appService,
    settings: {} as never,
    isLoggedIn: false,
    onProgress: (p) => events.push(p),
  });
  return { events, result };
};

beforeEach(() => {
  vi.clearAllMocks();
  hello.mockResolvedValue({ protocol: 1, name: 'DESKTOP-PC', bookCount: 2 });
  listBooks.mockResolvedValue({
    complete: true,
    books: [hostItem('h1', 'Brand New'), hostItem('h2', 'Already Here')],
  });
  // bookService.importBook pushes into the array it is handed, so mirror that here.
  ingestFile.mockImplementation(async (opts: { books?: AnyBook[] }) => {
    const imported = book('h1', 'Brand New');
    opts.books?.push(imported);
    return imported;
  });
  applyHostLibraryMetadata.mockReturnValue(true);
  getConfig.mockResolvedValue(null);
  library = [book('h2', 'Already Here'), book('h3', 'Deleted On PC')];
});

describe('home library sync progress', () => {
  it('reports connect, compare, transfer then done, in that order', async () => {
    const { events } = await runSync();
    const stages = events.map((e) => e.stage);
    expect(stages[0]).toBe('connect');
    expect(stages[1]).toBe('compare');
    expect(stages.at(-1)).toBe('done');
    expect(stages.filter((s) => s === 'transfer').length).toBeGreaterThan(0);
    expect(stages.indexOf('compare')).toBeLessThan(stages.indexOf('transfer'));
  });

  it('knows how many books are coming before any of them move', async () => {
    const { events } = await runSync();
    const transfers = events.filter((e) => e.stage === 'transfer');
    // One import + one refresh + one removal.
    expect(transfers.every((t) => t.total === 3)).toBe(true);
    // The first transfer event is emitted before the work starts.
    expect(transfers[0]!.current).toBe(0);
  });

  it('advances the counter to the total and names the current book', async () => {
    const { events } = await runSync();
    const transfers = events.filter((e) => e.stage === 'transfer');
    expect(transfers.at(-1)!.current).toBe(3);
    expect(transfers.some((t) => (t.label ?? '').length > 0)).toBe(true);
  });

  it('summarises what actually happened', async () => {
    const { result, events } = await runSync();
    expect(result.imported).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.errors).toEqual([]);
    const done = events.at(-1)!;
    expect(done.counts).toMatchObject({ imported: 1, removed: 1 });
  });

  it('keeps the host name so the dialog can name the PC', async () => {
    const { events } = await runSync();
    expect(events.find((e) => e.stage === 'compare')!.hostName).toBe('DESKTOP-PC');
  });

  it('never treats an empty host listing as "delete everything"', async () => {
    listBooks.mockResolvedValue({ complete: false, books: [] });
    const { result } = await runSync();
    expect(result.removed).toBe(0);
    expect(result.errors.join(' ')).toMatch(/no books were removed/i);
  });

  it('saves the shelf as books arrive, so an interrupted sync keeps them', async () => {
    // The bytes are on disk as soon as an import returns. Holding the library write until
    // the end of the loop is what made a cancelled run download a hundred books and show
    // none of them, so the write has to happen during the run.
    let savesWhenFirstBookLanded = -1;
    await syncFromLanHome({
      host: '192.168.1.107',
      port: 17432,
      token: 'TEST2345',
      appService,
      settings: {} as never,
      isLoggedIn: false,
      onProgress: (p) => {
        if (p.stage === 'transfer' && p.current === 1 && savesWhenFirstBookLanded < 0) {
          savesWhenFirstBookLanded = saveLibraryBooks.mock.calls.length;
        }
      },
    });
    expect(savesWhenFirstBookLanded).toBeGreaterThan(0);
  });

  it('persists the imported book itself, not just the pre-existing shelf', async () => {
    await runSync();
    const lastSaved = saveLibraryBooks.mock.calls.at(-1)?.[0] as unknown as AnyBook[];
    expect(Array.isArray(lastSaved)).toBe(true);
    expect(lastSaved.some((b) => b['hash'] === 'h1')).toBe(true);
  });
});
