/**
 * Mirror this device's shelf to a home-library host, then exchange reading
 * progress (last-writer-wins on config.updatedAt).
 *
 * The desktop catalog is the source of truth for membership, titles, authors,
 * tags, and covers. Progress stays bidirectional so a page-turn on the phone
 * is not overwritten. Remote stubs (OPDS / Audiobookshelf / feeds with a URL)
 * are left alone.
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

const mergeReadingProgress = async (
  opts: {
    host: string;
    port: number;
    token: string;
    appService: AppService;
    settings: SystemSettings;
  },
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
  opts: {
    host: string;
    port: number;
    token: string;
    appService: AppService;
  },
  book: Book,
  item: LanHomeBookSummary,
): Promise<boolean> => {
  const localCoverExists = await opts.appService.exists(getCoverFilename(book), 'Books');
  if (!hostCoverNeedsPull(item, book, localCoverExists)) return false;

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
  opts: {
    host: string;
    port: number;
    token: string;
    appService: AppService;
    settings: SystemSettings;
    isLoggedIn: boolean;
  },
  library: Book[],
  item: LanHomeBookSummary,
  result: LanHomeSyncResult,
): Promise<Book | null> => {
  if (item.hasFile === false) return null;
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

const removeBooksMissingOnHost = async (
  opts: { appService: AppService },
  library: Book[],
  hostHashes: Set<string>,
  result: LanHomeSyncResult,
): Promise<void> => {
  for (const book of library) {
    if (book.deletedAt) continue;
    if (!isLanHomeMirrorableBook(book)) continue;
    if (hostHashes.has(book.hash)) continue;
    try {
      await opts.appService.deleteBook(book, 'local');
    } catch (e) {
      result.errors.push(
        `Remove ${book.title || book.hash}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    book.deletedAt = Date.now();
    book.downloadedAt = null;
    result.removed += 1;
  }
};

export const syncFromLanHome = async (opts: {
  host: string;
  port: number;
  token: string;
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
}): Promise<LanHomeSyncResult> => {
  const result = emptyResult();
  if (!isTauriAppPlatform()) {
    result.errors.push('Home library sync needs the desktop or mobile app.');
    return result;
  }

  const remote = await lanHomeListBooks(opts.host, opts.port, opts.token);
  const { library: storeLibrary, libraryLoaded, setLibrary } = useLibraryStore.getState();
  const library = libraryLoaded ? [...storeLibrary] : await opts.appService.loadLibraryBooks();
  const byHash = new Map(library.filter((b) => !b.deletedAt).map((b) => [b.hash, b]));
  const hostHashes = new Set(remote.books.map((item) => item.hash).filter(Boolean));

  for (const item of remote.books) {
    if (!item.hash) continue;
    let book = byHash.get(item.hash);
    if (!book) {
      try {
        const imported = await importHostBook(opts, library, item, result);
        if (!imported) continue;
        byHash.set(imported.hash, imported);
        book = imported;
      } catch (e) {
        result.errors.push(
          `${item.title || item.hash}: ${e instanceof Error ? e.message : String(e)}`,
        );
        continue;
      }
    } else {
      result.skipped += 1;
      await mergeReadingProgress(opts, book, item, result);
    }

    if (applyHostLibraryMetadata(book, item)) {
      result.titlesUpdated += 1;
    }
    try {
      if (await pullHostCover(opts, book, item)) {
        result.coversUpdated += 1;
      }
    } catch (e) {
      result.errors.push(
        `Cover ${item.title || item.hash}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const catalogTrusted =
    remote.complete === true || (remote.complete !== false && remote.books.length > 0);
  if (catalogTrusted) {
    await removeBooksMissingOnHost(opts, library, hostHashes, result);
  } else if (library.some((b) => !b.deletedAt && isLanHomeMirrorableBook(b))) {
    result.errors.push('Host catalog was empty or unreadable; local books were not removed.');
  }
  await opts.appService.saveLibraryBooks(library);
  setLibrary(library);
  return result;
};

export const bookCountHint = (library: Book[]): number =>
  library.filter((b) => !b.deletedAt).length;
