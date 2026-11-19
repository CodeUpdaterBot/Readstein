import { describe, it, expect } from 'vitest';
import { createBackupZip, restoreFromBackupZip } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService, FileItem } from '@/types/system';

/**
 * The end-to-end round trip the export tests do not cover: make a backup zip,
 * then restore it on a machine that has none of the files, and check that the
 * restored book actually opens there.
 *
 * That is the whole point of the feature — "click import on another instance
 * and have it fully clone everything" — and it is the path where an ordering
 * bug hid: repointing a record at the extracted file BEFORE merging the backup's
 * metadata let the merge carry the source machine's filePath back over the top,
 * leaving the restored book pointing at a path that does not exist.
 */

const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const SOURCE_PATH = 'C:\\OtherMachine\\Books\\Held In Place.epub';
const BOOK_BYTES = new TextEncoder().encode('the actual bytes of the book');

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: HASH,
    format: 'EPUB',
    title: 'Held In Place',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    filePath: SOURCE_PATH,
    ...overrides,
  };
}

/**
 * A tiny AppService over two in-memory stores:
 *   tree  — paths relative to Books/, which readDirectory lists and which
 *           resolveFilePath turns into an absolute path
 *   disk  — absolute paths outside Books/, i.e. books held in place
 *
 * This mirrors the real asymmetry the feature exists for: a held-in-place book
 * has a disk entry and NO tree entry.
 */
function makeMachine(opts: {
  books: Book[];
  tree?: Record<string, Uint8Array>;
  disk?: Record<string, Uint8Array>;
}) {
  const tree = new Map(Object.entries(opts.tree ?? {}));
  const disk = new Map(Object.entries(opts.disk ?? {}));
  const library: Book[] = opts.books.map((b) => ({ ...b }));
  const settings: Record<string, unknown> = { themeMode: 1 };
  let imported = 0;

  const ROOT = '/home/user/Readest/Books';
  // Tree keys are relative (as the real readDirectory returns), but a resolved
  // path is absolute, so the absolute form has to map back onto the tree — the
  // real app resolves 'None' against the filesystem, where both are the same file.
  const toTreeKey = (p: string): string | null => {
    const norm = p.replace(/\\/g, '/');
    if (norm.startsWith(`${ROOT}/`)) return norm.slice(ROOT.length + 1);
    return norm;
  };

  const svc = {
    loadLibraryBooks: async () => library.map((b) => ({ ...b })),
    saveLibraryBooks: async (books: Book[]) => {
      library.length = 0;
      library.push(...books);
    },
    loadSettings: async () => ({ ...settings }) as never,
    saveSettings: async (s: Record<string, unknown>) => {
      Object.assign(settings, s);
    },
    // every tree path resolves under a machine-local root
    resolveFilePath: async (p: string) => `${ROOT}/${p.replace(/\\/g, '/')}`,
    readDirectory: async (_dir: string, _base: string): Promise<FileItem[]> =>
      [...tree.entries()].map(([path, data]) => ({
        path,
        size: data.byteLength,
      })) as unknown as FileItem[],
    exists: async (p: string, base?: string) => {
      if (base === 'Books') return tree.has(p.replace(/\\/g, '/'));
      const key = toTreeKey(p);
      return (key !== null && tree.has(key)) || disk.has(p);
    },
    readFile: async (p: string, base: string) => {
      // .slice() on the view, not .buffer: a Uint8Array handed back by zip.js is
      // a window onto a larger buffer, and returning the buffer would append
      // whatever else shares it.
      const exact = (d: Uint8Array) => d.slice().buffer as ArrayBuffer;
      if (base === 'Books') {
        const data = tree.get(p.replace(/\\/g, '/'));
        if (!data) throw new Error(`no such file: ${p} (base ${base})`);
        return exact(data);
      }
      const key = toTreeKey(p);
      const data = (key !== null ? tree.get(key) : undefined) ?? disk.get(p);
      if (!data) throw new Error(`no such file: ${p} (base ${base})`);
      return exact(data);
    },
    writeFile: async (p: string, base: string, content: ArrayBuffer | string) => {
      const key = base === 'Books' ? p.replace(/\\/g, '/') : p;
      const bytes =
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : new Uint8Array(content as ArrayBuffer);
      (base === 'Books' ? tree : disk).set(key, bytes);
    },
    createDir: async (p: string, base: string) => {
      if (base === 'Books') tree.set(`${p.replace(/\\/g, '/')}/.keep`, new Uint8Array(0));
    },
    importBook: async () => {
      imported++;
      return null;
    },
  } as unknown as AppService;

  return {
    svc,
    tree,
    disk,
    library,
    get imported() {
      return imported;
    },
  };
}

describe('backup -> restore round trip clones the books', () => {
  it('restores a held-in-place book so it resolves on the new machine', async () => {
    // --- the machine being backed up: the book lives outside the app's tree,
    //     so only its cover and config are inside Books/<hash>/.
    const src = makeMachine({
      books: [makeBook()],
      tree: { [`${HASH}/cover.png`]: new Uint8Array([1, 2, 3]) },
      disk: { [SOURCE_PATH]: BOOK_BYTES },
    });

    const zip = await createBackupZip(src.svc, { includeBookFiles: true });

    // --- the new machine: nothing at all, no files, no library.
    const dst = makeMachine({ books: [] });
    const result = await restoreFromBackupZip(dst.svc, new Blob([zip]));

    expect(result.booksAdded).toBe(1);

    // The record survived the trip...
    expect(dst.library).toHaveLength(1);
    const restored = dst.library[0]!;
    expect(restored.hash).toBe(HASH);

    // ...pointed at a path that RESOLVES here, not at the source machine's path.
    expect(restored.filePath).not.toBe(SOURCE_PATH);
    expect(restored.filePath).toContain(`Books/${HASH}/`);

    // ...and the file it points at is really there, with the right bytes.
    expect(await dst.svc.exists(restored.filePath!, 'None')).toBe(true);
    const roundTripped = new Uint8Array(
      (await dst.svc.readFile(restored.filePath!, 'None', 'binary')) as ArrayBuffer,
    );
    // Assert the length first: when this fails the message carries both numbers, which
    // distinguishes a few stray bytes from a wholly different payload.
    expect(roundTripped.length).toBe(BOOK_BYTES.length);
    // Byte-identical, compared as plain arrays: vitest's `toEqual` is strict about the
    // prototype, so a Buffer and a Uint8Array holding the same bytes are reported as
    // unequal with "no visual difference" — which is a lie about the data.
    expect(Array.from(roundTripped)).toEqual(Array.from(BOOK_BYTES));

    // its cover came too
    expect(dst.tree.has(`${HASH}/cover.png`)).toBe(true);
  });

  it('still repoints when the backup record is NEWER than the local one', async () => {
    // The ordering bug: a local record exists with a stale/absent path, and the
    // backup's updatedAt is higher, so mergeBookMetadata adopts the whole backup
    // record — including the source machine's filePath. The repoint must win.
    const src = makeMachine({
      books: [makeBook({ updatedAt: 9000 })],
      tree: { [`${HASH}/cover.png`]: new Uint8Array([1]) },
      disk: { [SOURCE_PATH]: BOOK_BYTES },
    });
    const zip = await createBackupZip(src.svc, { includeBookFiles: true });

    const dst = makeMachine({
      books: [makeBook({ updatedAt: 10, filePath: '/home/user/Readest/Books/gone.epub' })],
    });
    const result = await restoreFromBackupZip(dst.svc, new Blob([zip]));

    expect(result.booksUpdated).toBe(1);
    const restored = dst.library[0]!;
    expect(restored.filePath).not.toBe(SOURCE_PATH); // the merge must not win
    expect(restored.filePath).toContain(`Books/${HASH}/`);
    expect(await dst.svc.exists(restored.filePath!, 'None')).toBe(true);
  });

  it('carries a whole library, not just one book', async () => {
    const H2 = 'ffffffffffffffffffffffffffffffff';
    const P2 = 'C:\\OtherMachine\\Books\\Second.pdf';
    const src = makeMachine({
      books: [
        makeBook(),
        makeBook({ hash: H2, title: 'Second', format: 'PDF', filePath: P2 }),
      ],
      tree: { [`${HASH}/cover.png`]: new Uint8Array([1]) },
      disk: { [SOURCE_PATH]: BOOK_BYTES, [P2]: new TextEncoder().encode('second book') },
    });
    const zip = await createBackupZip(src.svc, { includeBookFiles: true });

    const dst = makeMachine({ books: [] });
    const result = await restoreFromBackupZip(dst.svc, new Blob([zip]));

    expect(result.booksAdded).toBe(2);
    for (const b of dst.library) {
      expect(await dst.svc.exists(b.filePath!, 'None')).toBe(true);
    }
  });

  it('omits the books when the caller asked for a metadata-only backup', async () => {
    const src = makeMachine({
      books: [makeBook()],
      tree: { [`${HASH}/cover.png`]: new Uint8Array([1]) },
      disk: { [SOURCE_PATH]: BOOK_BYTES },
    });
    const zip = await createBackupZip(src.svc, { includeBookFiles: false });

    const dst = makeMachine({ books: [] });
    await restoreFromBackupZip(dst.svc, new Blob([zip]));

    // The record arrives; its source path does not resolve, and no file was
    // carried to fall back on — which is exactly what the switch promises.
    expect(dst.library).toHaveLength(1);
    expect(dst.library[0]!.filePath).toBe(SOURCE_PATH);
    expect(await dst.svc.exists(SOURCE_PATH, 'None')).toBe(false);
  });
});
