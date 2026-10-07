/**
 * Mirror this device's shelf to a home-library host, then exchange reading
 * progress (last-writer-wins on config.updatedAt).
 *
 * The desktop catalog is the source of truth for membership, titles, authors,
 * tags, and covers. Progress stays bidirectional so a page-turn on the phone
 * is not overwritten. Remote stubs (OPDS / Audiobookshelf / feeds with a URL)
 * are left alone.
 *
 * Runs in two passes on purpose: work out the whole plan first (so the UI can
 * say *how many* books are coming before any bytes move), then execute it while
 * reporting progress. A sync that cannot describe its own progress is a sync
 * nobody can trust with 193 books.
 */

import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { ingestFile } from '@/services/ingestService';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriDownload } from '@/utils/transfer';
import { getCoverFilename } from '@/utils/book';
import { applyHostLibraryMetadata } from '@/utils/bookTitle';
import { hostCoverNeedsPull, isLanHomeMirrorableBook } from './mirror';
import {
  lanHomeDownloadHeaders,
  lanHomeFileUrl,
  lanHomeGetConfig,
  lanHomeHello,
  lanHomeListBooks,
  lanHomePutConfig,
} from './client';
import { lanHomeBookCoverUrl, type LanHomeBookSummary } from './protocol';
import { useLibraryStore } from '@/store/libraryStore';

export type LanHomeSyncResult = {
  imported: number;
  skipped: number;
  progressPulled: number;
  progressPushed: number;
  titlesUpdated: number;
  coversUpdated: number;
  removed: number;
  errors: string[];
};

export type LanHomeSyncCounts = Omit<LanHomeSyncResult, 'errors'>;

/** The three things a person watching a sync wants to know, in order. */
export type LanHomeSyncStage = 'connect' | 'compare' | 'transfer' | 'done';

export type LanHomeSyncProgress = {
  stage: LanHomeSyncStage;
  /** Name the PC reported, once connected. */
  hostName?: string;
  /** Books the transfer pass will touch — known before any transfer starts. */
  total?: number;
  /** Books finished so far in the transfer pass. */
  current?: number;
  /** Title currently moving, for the line under the bar. */
  label?: string;
  counts?: LanHomeSyncCounts;
};

export type LanHomeSyncOptions = {
  host: string;
  port: number;
  token: string;
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
  onProgress?: (progress: LanHomeSyncProgress) => void;
};

const emptyResult = (): LanHomeSyncResult => ({
  imported: 0,
  skipped: 0,
  progressPulled: 0,
  progressPushed: 0,
  titlesUpdated: 0,
  coversUpdated: 0,
  removed: 0,
  errors: [],
});

const countsOf = (result: LanHomeSyncResult): LanHomeSyncCounts => ({
  imported: result.imported,
  skipped: result.skipped,
  progressPulled: result.progressPulled,
  progressPushed: result.progressPushed,
  titlesUpdated: result.titlesUpdated,
  coversUpdated: result.coversUpdated,
  removed: result.removed,
});

type PlanEntry =
  | { kind: 'import'; item: LanHomeBookSummary }
  | {
      kind: 'refresh';
      item: LanHomeBookSummary;
      book: Book;
      pullCover: boolean;
      mergeProgress: boolean;
    }
  | { kind: 'remove'; book: Book };

type SyncContext = Omit<LanHomeSyncOptions, 'onProgress'>;

const mergeReadingProgress = async (
  opts: SyncContext,
  book: Book,
  item: LanHomeBookSummary,
  result: LanHomeSyncResult,
): Promise<void> => {
  if (!item.hasConfig) return;
  try {
    const remoteCfg = await lanHomeGetConfig(opts.host, opts.port, opts.token, item.hash);
    if (!remoteCfg) return;
    const localCfg = await opts.appService.loadBookConfig(book, opts.settings);
    const remoteAt = remoteCfg.updatedAt ?? 0;
    const localAt = localCfg.updatedAt ?? 0;
    if (remoteAt > localAt) {
      await opts.appService.saveBookConfig(book, { ...localCfg, ...remoteCfg }, opts.settings);
      result.progressPulled += 1;
    } else if (localAt > remoteAt && localAt > 0) {
      await lanHomePutConfig(opts.host, opts.port, opts.token, item.hash, localCfg);
      result.progressPushed += 1;
    }
  } catch (e) {
    result.errors.push(
      `Progress ${item.title || item.hash}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

const cacheCoverPath = async (appService: AppService, hash: string): Promise<string> => {
  await appService.createDir(`lan-home/${hash}`, 'Cache', true);
  return appService.resolveFilePath(`lan-home/${hash}/cover.png`, 'Cache');
};

const pullHostCover = async (
  opts: Pick<SyncContext, 'host' | 'port' | 'token' | 'appService'>,
  book: Book,
  item: LanHomeBookSummary,
): Promise<boolean> => {
  const dst = await cacheCoverPath(opts.appService, item.hash);
  await tauriDownload(
    lanHomeBookCoverUrl(opts.host, opts.port, item.hash),
    dst,
    undefined,
    lanHomeDownloadHeaders(opts.token),
  );
  await opts.appService.updateCoverImage(book, undefined, dst);
  try {
    await opts.appService.deleteFile(dst, 'None');
  } catch {
    /* cache GC */
  }

  const coverHash = await opts.appService.computeCoverHash(book);
  book.coverHash = coverHash;
  book.coverUpdatedAt = item.coverUpdatedAt || item.coverMtime || Date.now();
  book.coverDownloadedAt = Date.now();
  book.coverImageUrl = await opts.appService.generateCoverImageUrl(book);
  return true;
};

const importHostBook = async (
  opts: SyncContext,
  library: Book[],
  item: LanHomeBookSummary,
  result: LanHomeSyncResult,
): Promise<Book | null> => {
  const safe = (item.filename || `${item.title || item.hash}.epub`)
    .replaceAll(/[/\\:*?"<>|]/g, '_')
    .slice(0, 200);
  await opts.appService.createDir(`lan-home/${item.hash}`, 'Cache', true);
  const dst = await opts.appService.resolveFilePath(`lan-home/${item.hash}/${safe}`, 'Cache');
  await tauriDownload(
    lanHomeFileUrl(opts.host, opts.port, item.hash),
    dst,
    undefined,
    lanHomeDownloadHeaders(opts.token),
  );
  const imported = await ingestFile(
    { file: dst, books: library, sourceFileName: safe },
    {
      appService: opts.appService,
      settings: opts.settings,
      isLoggedIn: opts.isLoggedIn,
    },
  );
  try {
    await opts.appService.deleteFile(dst, 'None');
  } catch {
    /* cache GC */
  }
  if (!imported) {
    result.errors.push(`Could not import ${item.title || item.hash}`);
    return null;
  }
  result.imported += 1;
  if (item.hasConfig) {
    const remoteCfg = await lanHomeGetConfig(opts.host, opts.port, opts.token, item.hash);
    if (remoteCfg) {
      await opts.appService.saveBookConfig(imported, remoteCfg, opts.settings);
      result.progressPulled += 1;
    }
  }
  return imported;
};

const removeBook = async (opts: SyncContext, book: Book): Promise<void> => {
  await opts.appService.deleteBook(book, 'local');
  book.deletedAt = Date.now();
  book.downloadedAt = null;
};

/**
 * Decide the whole job before doing any of it: which books are new, which need
 * refreshing (metadata, covers, progress) and which are gone from the PC. The
 * transfer pass then runs this list so the progress bar has a real denominator.
 */
const buildPlan = async (
  opts: SyncContext,
  library: Book[],
  remote: LanHomeBookSummary[],
): Promise<{ plan: PlanEntry[]; byHash: Map<string, Book> }> => {
  const byHash = new Map(library.filter((b) => !b.deletedAt).map((b) => [b.hash, b]));
  const hostHashes = new Set(remote.map((item) => item.hash).filter(Boolean));
  const plan: PlanEntry[] = [];

  for (const item of remote) {
    if (!item.hash) continue;
    // The host lists the book but has no file for it; nothing to copy.
    if (item.hasFile === false) continue;

    const book = byHash.get(item.hash);
    if (!book) {
      plan.push({ kind: 'import', item });
      continue;
    }

    let pullCover = false;
    try {
      const localCoverExists = await opts.appService.exists(getCoverFilename(book), 'Books');
      pullCover = hostCoverNeedsPull(item, book, localCoverExists);
    } catch {
      /* a cover we cannot inspect is not worth failing the plan over */
    }
    plan.push({
      kind: 'refresh',
      item,
      book,
      pullCover,
      mergeProgress: !!item.hasConfig,
    });
  }

  const trusted = remote.length > 0;
  if (trusted) {
    for (const book of library) {
      if (book.deletedAt) continue;
      if (!isLanHomeMirrorableBook(book)) continue;
      if (hostHashes.has(book.hash)) continue;
      plan.push({ kind: 'remove', book });
    }
  }
  return { plan, byHash };
};

export const syncFromLanHome = async (opts: LanHomeSyncOptions): Promise<LanHomeSyncResult> => {
  const { onProgress, ...ctx } = opts;
  const result = emptyResult();
  if (!isTauriAppPlatform()) {
    result.errors.push('Home library sync needs the desktop or mobile app.');
    return result;
  }

  onProgress?.({ stage: 'connect' });
  const hello = await lanHomeHello(ctx.host, ctx.port, ctx.token);

  onProgress?.({ stage: 'compare', hostName: hello.name });
  const remote = await lanHomeListBooks(ctx.host, ctx.port, ctx.token);
  const { library: storeLibrary, libraryLoaded, setLibrary } = useLibraryStore.getState();
  const library = libraryLoaded ? [...storeLibrary] : await ctx.appService.loadLibraryBooks();
  const { plan, byHash } = await buildPlan(ctx, library, remote.books);

  onProgress?.({
    stage: 'transfer',
    hostName: hello.name,
    total: plan.length,
    current: 0,
    counts: countsOf(result),
  });

  for (let i = 0; i < plan.length; i += 1) {
    const entry = plan[i]!;
    const label =
      entry.kind === 'remove'
        ? entry.book.title || ''
        : entry.kind === 'import'
          ? entry.item.title || entry.item.filename || ''
          : entry.item.title || entry.book.title || '';
    onProgress?.({
      stage: 'transfer',
      hostName: hello.name,
      total: plan.length,
      current: i,
      label,
      counts: countsOf(result),
    });

    try {
      if (entry.kind === 'import') {
        const imported = await importHostBook(ctx, library, entry.item, result);
        if (imported) {
          byHash.set(imported.hash, imported);
          if (applyHostLibraryMetadata(imported, entry.item)) result.titlesUpdated += 1;
          if (entry.item.hasCover && (await pullHostCover(ctx, imported, entry.item))) {
            result.coversUpdated += 1;
          }
        }
      } else if (entry.kind === 'refresh') {
        const { book, item } = entry;
        if (entry.mergeProgress) await mergeReadingProgress(ctx, book, item, result);
        if (applyHostLibraryMetadata(book, item)) result.titlesUpdated += 1;
        if (entry.pullCover && (await pullHostCover(ctx, book, item))) {
          result.coversUpdated += 1;
        }
        result.skipped += 1;
      } else {
        await removeBook(ctx, entry.book);
        result.removed += 1;
      }
    } catch (e) {
      const who = entry.kind === 'remove' ? entry.book.title : entry.item?.title;
      result.errors.push(`${who || 'book'}: ${e instanceof Error ? e.message : String(e)}`);
    }

    onProgress?.({
      stage: 'transfer',
      hostName: hello.name,
      total: plan.length,
      current: i + 1,
      label,
      counts: countsOf(result),
    });
  }

  // An unreadable or empty host catalog must never look like "the PC has no books",
  // or a sync would wipe this device's shelf.
  if (remote.complete === false || remote.books.length === 0) {
    if (library.some((b) => !b.deletedAt && isLanHomeMirrorableBook(b))) {
      result.errors.push('The PC listing was empty or unreadable; no books were removed.');
    }
  }

  await ctx.appService.saveLibraryBooks(library);
  setLibrary(library);
  onProgress?.({
    stage: 'done',
    hostName: hello.name,
    total: plan.length,
    current: plan.length,
    counts: countsOf(result),
  });
  return result;
};

export const bookCountHint = (library: Book[]): number =>
  library.filter((b) => !b.deletedAt).length;
