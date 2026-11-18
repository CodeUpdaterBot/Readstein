import { describe, it, expect } from 'vitest';
import type { ZipWriter } from '@zip.js/zip.js';
import { addBackupEntriesToZip, type BackupOptions } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService, FileItem } from '@/types/system';

/**
 * A backup must be a full copy of the library, not a shelf of covers.
 *
 * A book held in place — a Home Library folder, or a file that was never copied
 * into the app's storage — has no book file under `Books/<hash>/`. The tree walk
 * therefore found its cover.png and its config.json and left the book itself
 * behind, so restoring the zip on another machine produced cards that could not
 * be opened. These tests pin the file into the zip, under the book's hash, which
 * is where restore looks for it.
 */

const IN_PLACE_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa1111';
const COPIED_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb2222';
const GONE_HASH = 'cccccccccccccccccccccccccccc3333';

const IN_PLACE_FILE = 'C:\\Books\\Held In Place.epub';
const COPIED_FILE = 'C:\\Books\\Already Copied.pdf';
const GONE_FILE = 'C:\\Books\\Deleted Since.epub';

function makeBook(overrides: Partial<Book>): Book {
  return {
    hash: IN_PLACE_HASH,
    format: 'EPUB',
    title: 'Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

/**
 * `readDirectory` lists files inside the app's Books/ tree; `exists`/`readFile`
 * answer for absolute paths outside it, which is how a held-in-place book is
 * reached. Reads are recorded so a test can assert which file was actually taken.
 */
function makeAppService(books: Book[], files: FileItem[], present: string[]) {
  const reads: { path: string; base: string }[] = [];
  const svc = {
    loadLibraryBooks: async () => books,
    loadSettings: async () => ({}) as never,
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => files,
    exists: async (path: string) => present.includes(path),
    readFile: async (path: string, base: string) => {
      reads.push({ path, base });
      return new ArrayBuffer(8);
    },
  } as unknown as AppService;
  return { svc, reads };
}

function makeCapturingWriter() {
  const names: string[] = [];
  const writer = {
    add: async (name: string) => {
      names.push(name);
    },
  } as unknown as ZipWriter<unknown>;
  return { writer, names };
}

const APP_TREE_FILES: FileItem[] = [
  { path: `${IN_PLACE_HASH}/cover.png`, size: 200 },
  { path: `${IN_PLACE_HASH}/config.json`, size: 50 },
  { path: `${COPIED_HASH}/Already Copied.pdf`, size: 900 },
  { path: `${COPIED_HASH}/cover.png`, size: 200 },
  { path: `${GONE_HASH}/cover.png`, size: 200 },
];

describe('addBackupEntriesToZip - the books themselves are included', () => {
  it('adds a held-in-place book under its hash dir, where restore looks for it', async () => {
    const books = [
      makeBook({ hash: IN_PLACE_HASH, title: 'Held In Place', filePath: IN_PLACE_FILE }),
    ];
    const { svc, reads } = makeAppService(books, APP_TREE_FILES, [IN_PLACE_FILE]);
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, svc, { includeBookFiles: true });

    // The book file is in the zip, inside the hash dir restore matches on...
    expect(names).toContain(`${IN_PLACE_HASH}/Held In Place.epub`);
    // ...alongside its cover and config, which the tree walk already provided.
    expect(names).toContain(`${IN_PLACE_HASH}/cover.png`);
    expect(names).toContain(`${IN_PLACE_HASH}/config.json`);
    // and it was read from the absolute path, not the Books/ tree.
    expect(reads.some((r) => r.path === IN_PLACE_FILE && r.base === 'None')).toBe(true);
  });

  it('does not duplicate a book whose file is already inside the app tree', async () => {
    const books = [
      makeBook({ hash: COPIED_HASH, title: 'Already Copied', filePath: COPIED_FILE }),
    ];
    const { svc, reads } = makeAppService(books, APP_TREE_FILES, [COPIED_FILE]);
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, svc, { includeBookFiles: true });

    expect(names).toContain(`${COPIED_HASH}/Already Copied.pdf`);
    // the copy in the tree is the one exported; the external path is never read
    expect(reads.some((r) => r.path === COPIED_FILE)).toBe(false);
  });

  it('skips a book whose file has since gone, without failing the backup', async () => {
    const books = [makeBook({ hash: GONE_HASH, title: 'Deleted Since', filePath: GONE_FILE })];
    const { svc } = makeAppService(books, APP_TREE_FILES, []); // nothing present on disk
    const { writer, names } = makeCapturingWriter();

    await expect(
      addBackupEntriesToZip(writer, svc, { includeBookFiles: true }),
    ).resolves.toBeUndefined();

    expect(names).not.toContain(`${GONE_HASH}/Deleted Since.epub`);
    expect(names).toContain(`${GONE_HASH}/cover.png`); // its cover still travels
  });

  it('omits book files when the caller opts out, for a metadata-only backup', async () => {
    const books = [
      makeBook({ hash: IN_PLACE_HASH, title: 'Held In Place', filePath: IN_PLACE_FILE }),
    ];
    const { svc, reads } = makeAppService(books, APP_TREE_FILES, [IN_PLACE_FILE]);
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, svc, { includeBookFiles: false });

    expect(names).not.toContain(`${IN_PLACE_HASH}/Held In Place.epub`);
    expect(names).toContain(`${IN_PLACE_HASH}/cover.png`);
    expect(reads.some((r) => r.base === 'None')).toBe(false);
  });

  it('includes the books by default when no option is given', async () => {
    const books = [
      makeBook({ hash: IN_PLACE_HASH, title: 'Held In Place', filePath: IN_PLACE_FILE }),
    ];
    const { svc } = makeAppService(books, APP_TREE_FILES, [IN_PLACE_FILE]);
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, svc, {} as BackupOptions);

    expect(names).toContain(`${IN_PLACE_HASH}/Held In Place.epub`);
  });

  it('never exports a soft-deleted book, whose cover may still linger on disk', async () => {
    const books = [
      makeBook({
        hash: IN_PLACE_HASH,
        title: 'Deleted',
        filePath: IN_PLACE_FILE,
        deletedAt: 500,
      }),
    ];
    const { svc } = makeAppService(books, APP_TREE_FILES, [IN_PLACE_FILE]);
    const { writer, names } = makeCapturingWriter();

    await addBackupEntriesToZip(writer, svc, { includeBookFiles: true });

    expect(names.some((n) => n.startsWith(`${IN_PLACE_HASH}/`))).toBe(false);
  });
});
