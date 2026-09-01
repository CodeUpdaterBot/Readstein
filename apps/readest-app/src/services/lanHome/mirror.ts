import type { Book } from '@/types/book';
import type { LanHomeBookSummary } from './protocol';

/** Local file-backed books that should follow the desktop shelf. */
export const isLanHomeMirrorableBook = (book: Book): boolean => {
  if (book.url) return false;
  if (book.absMediaType) return false;
  return true;
};

/**
 * Re-download the host cover when this device has none, or when the host
 * cover content (or, without a hash, its mtime) is newer.
 */
export const hostCoverNeedsPull = (
  item: Pick<LanHomeBookSummary, 'hasCover' | 'coverHash' | 'coverMtime' | 'coverUpdatedAt'>,
  book: Pick<Book, 'coverHash' | 'coverUpdatedAt'>,
  localCoverExists: boolean,
): boolean => {
  if (!item.hasCover) return false;
  if (!localCoverExists) return true;
  if (item.coverHash) {
    return item.coverHash !== (book.coverHash || '');
  }
  const hostAt = item.coverUpdatedAt || item.coverMtime || 0;
  return hostAt > 0 && hostAt > (book.coverUpdatedAt ?? 0);
};
