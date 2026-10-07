import type { Book } from '@/types/book';
import { getBaseFilename } from '@/utils/path';

const titleAsString = (title: unknown): string => {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    const map = title as Record<string, unknown>;
    for (const key of ['default', 'en', '']) {
      const v = map[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    for (const v of Object.values(map)) {
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  return '';
};

/**
 * Home Library / Drive downloads used to land in Cache as
 * `lan-<timestamp>-<original>` / `gdrive-<timestamp>-<original>`. ingestFile
 * then treated that cache name as the book title whenever PDF metadata was
 * empty or junk. Strip the prefix so titles match the real filename.
 */
export const TEMP_IMPORT_PREFIX_RE = /^(?:lan|gdrive)-\d+-/i;

export const stripTempImportPrefix = (name: string): string =>
  name.replace(TEMP_IMPORT_PREFIX_RE, '').trim();

export const filenameStem = (pathOrName: string): string => {
  if (!pathOrName) return '';
  return stripTempImportPrefix(getBaseFilename(pathOrName));
};

const JUNK_METADATA_TITLE_RE: RegExp[] = [
  /^microsoft word\b/i,
  /^powerpoint presentation$/i,
  /^untitled\b/i,
  /^document$/i,
  /^convert (jpg|jpeg|png|gif|image)s? to pdf/i,
  /^\d{4}[-/]\d{2}[-/]\d{2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/,
];

export const isUnreliableTitle = (title: string): boolean => {
  const t = title.trim();
  if (!t) return true;
  if (TEMP_IMPORT_PREFIX_RE.test(t)) return true;
  return JUNK_METADATA_TITLE_RE.some((re) => re.test(t));
};

/**
 * PDF Title/Author fields are often the scanner, Word, or a last name.
 * Prefer a real filename when it is clearly more informative.
 */
export const preferFilenameOverMetadata = (
  metadataTitle: string,
  fileStem: string,
  format?: string,
): boolean => {
  if (!fileStem.trim()) return false;
  if (isUnreliableTitle(metadataTitle)) return true;
  if (format && format !== 'PDF') return false;
  const meta = metadataTitle.trim();
  const file = fileStem.trim();
  if (file.toLowerCase().includes(meta.toLowerCase()) && file.length > meta.length + 6) {
    return true;
  }
  const metaWords = meta.split(/\s+/).filter(Boolean);
  const fileWords = file.split(/[\s._-]+/).filter((w) => w.length > 1);
  return metaWords.length === 1 && fileWords.length >= 3;
};

export const resolveImportTitle = (opts: {
  metadataTitle?: string;
  sourceFileName?: string;
  filePath?: string;
  format?: string;
}): string => {
  const stem = filenameStem(opts.sourceFileName || opts.filePath || '');
  const meta = stripTempImportPrefix(titleAsString(opts.metadataTitle)).trim();
  if (preferFilenameOverMetadata(meta, stem, opts.format)) return stem || meta;
  return meta || stem;
};

/** Mutates `book` when the stored title is a cache prefix or junk PDF metadata. */
export const repairStoredBookTitle = (book: Book): boolean => {
  if (book.deletedAt) return false;
  const fromFile = book.filePath ? filenameStem(book.filePath) : '';
  const next = resolveImportTitle({
    metadataTitle: book.title,
    sourceFileName: fromFile || book.title,
    filePath: book.filePath,
    format: book.format,
  });
  if (!next) return false;
  const metaNow = titleAsString(book.metadata?.title).trim();
  if (next === book.title.trim() && next === (metaNow || next)) return false;

  book.title = next;
  book.sourceTitle = next;
  if (book.metadata) book.metadata.title = next;
  book.updatedAt = Date.now();
  return true;
};

export const repairLibraryTitles = (books: Book[]): { books: Book[]; repaired: number } => {
  let repaired = 0;
  for (const book of books) {
    if (repairStoredBookTitle(book)) repaired += 1;
  }
  return { books, repaired };
};

/**
 * Overlay a Home Library host listing onto a local book. The host already
 * repaired titles in library.json; phones (and older APKs after upgrade)
 * still stored `lan-<timestamp>-…` or junk PDF Title fields. Sync uses this
 * so existing hashes get renamed without re-downloading the file.
 */
export const applyHostCatalogTitle = (
  book: Book,
  item: { title?: string; filename?: string; format?: string },
): boolean => {
  if (book.deletedAt) return false;
  const next = resolveImportTitle({
    metadataTitle: item.title || book.title,
    sourceFileName: item.filename || item.title,
    filePath: book.filePath,
    format: item.format || book.format,
  });
  if (!next) return false;
  const local = (book.title || '').trim();
  const metaNow = titleAsString(book.metadata?.title).trim();
  if (next === local && next === (metaNow || next)) return false;

  book.title = next;
  book.sourceTitle = next;
  if (book.metadata) book.metadata.title = next;
  book.updatedAt = Date.now();
  return true;
};

export const applyHostCatalogTitles = (
  books: Book[],
  catalog: Array<{ hash: string; title?: string; filename?: string; format?: string }>,
): number => {
  const byHash = new Map(catalog.filter((item) => item.hash).map((item) => [item.hash, item]));
  let updated = 0;
  for (const book of books) {
    const item = byHash.get(book.hash);
    if (item && applyHostCatalogTitle(book, item)) updated += 1;
  }
  return updated;
};

export type HostLibraryMetadata = {
  title?: string;
  author?: string;
  tags?: string[];
  /** Whole metadata object from the host row, mirrored so features that depend on it work. */
  metadata?: Record<string, unknown>;
  groupId?: string | null;
  groupName?: string | null;
};

/**
 * Home Library mirror: the desktop `library.json` row is the source of truth.
 * Unlike `applyHostCatalogTitle`, this does not re-run filename-vs-metadata
 * heuristics — a title the user edited on the PC must land on the phone even
 * when the filename is longer or “better.”
 */
export const applyHostLibraryMetadata = (book: Book, item: HostLibraryMetadata): boolean => {
  if (book.deletedAt) return false;
  let changed = false;

  const hostTitle = stripTempImportPrefix((item.title || '').trim());
  if (hostTitle && hostTitle !== (book.title || '').trim()) {
    book.title = hostTitle;
    book.sourceTitle = hostTitle;
    if (book.metadata) book.metadata.title = hostTitle;
    changed = true;
  }

  const hostAuthor = (item.author || '').trim();
  if (hostAuthor && hostAuthor !== (book.author || '').trim()) {
    book.author = hostAuthor;
    if (book.metadata) book.metadata.author = hostAuthor;
    changed = true;
  }

  if (item.tags) {
    const next = [...item.tags];
    const prev = book.tags || [];
    if (next.length !== prev.length || next.some((tag, i) => tag !== prev[i])) {
      book.tags = next;
      changed = true;
    }
  }

  // Mirror the rest of the metadata object wholesale. This is the difference between a
  // device that can merely list books and one that can do everything the desktop can: the
  // timeline dial needs `published` / `publishedDates`, the English-only filter needs
  // `language`, and series / publisher / subject travel the same way. Naming fields one by
  // one is how the publication years went missing — a synced phone had none, so the dial
  // showed "0 bands" and no tiles while the desktop looked perfect.
  // Compared by value first so a re-sync of an unchanged book does not look like an edit.
  const hostMetadata = item.metadata as Partial<NonNullable<Book['metadata']>> | undefined;
  if (hostMetadata) {
    // Create the object if the local record lacks one, rather than skipping: a book
    // without metadata is exactly the book that would silently never get its years.
    if (!book.metadata) book.metadata = {} as NonNullable<Book['metadata']>;
    const local = book.metadata as Record<string, unknown>;
    for (const [key, value] of Object.entries(hostMetadata)) {
      if (value === undefined || value === null) continue;
      let differs: boolean;
      try {
        differs = JSON.stringify(local[key]) !== JSON.stringify(value);
      } catch {
        differs = true;
      }
      if (differs) {
        local[key] = value;
        changed = true;
      }
    }
  }

  if (item.groupId != null && book.groupId !== item.groupId) {
    book.groupId = item.groupId;
    book.groupName = item.groupName ?? book.groupName;
    changed = true;
  } else if (item.groupName != null && book.groupName !== item.groupName) {
    book.groupName = item.groupName;
    changed = true;
  }

  if (changed) {
    const now = Date.now();
    book.updatedAt = now;
    book.metadataUpdatedAt = now;
  }
  return changed;
};
