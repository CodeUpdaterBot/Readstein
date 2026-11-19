/**
 * The streaming reader, tested against the real zip.js writer.
 *
 * This test exists because of a specific failure. Books in the backup were switched to
 * being streamed through a reader instead of read whole, the whole backup suite stayed
 * green, and the next real backup came out with ZERO book files in it: the reader was a
 * plain object, zip.js refused it, and each book threw and was skipped by the per-file
 * catch. The suite could not see it because the streaming path needs a native file layer
 * that does not exist under vitest, so it always fell back to the old path in tests.
 *
 * So this test reaches the streaming path directly, with no native layer involved: a fake
 * file, the real writer, the real reader, and the bytes read back out of the archive.
 */
import { describe, it, expect } from 'vitest';
import { ZipWriter, ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { ChunkedFileReader, writeEntryToBooks } from '@/services/backupService';

/** A file that yields byte ranges, standing in for something on disk. */
function fakeFile(bytes: Uint8Array) {
  const reads: { start: number; end: number }[] = [];
  return {
    reads,
    file: {
      size: bytes.length,
      readData: async (start: number, end: number) => {
        reads.push({ start, end });
        return bytes.slice(start, end).buffer as ArrayBuffer;
      },
      close: async () => {},
    },
  };
}

describe('backup streaming reader', () => {
  it('streams a file larger than one chunk into the zip, byte for byte', async () => {
    // Deliberately more than one BACKUP_READ_CHUNK (1 MB), so the reader is asked for
    // several slices and the seams between them are exercised.
    const bytes = new Uint8Array(3 * 1024 * 1024 + 1373);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
    const { file, reads } = fakeFile(bytes);

    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add('book.pdf', new ChunkedFileReader(file), { level: 0 });
    const archive = await writer.close();

    expect(reads.length).toBeGreaterThan(1);
    expect(Math.max(...reads.map((r) => r.end - r.start))).toBeLessThanOrEqual(1024 * 1024);

    const zip = new ZipReader(new Uint8ArrayReader(archive));
    const entries = await zip.getEntries();
    expect(entries.map((e) => e.filename)).toEqual(['book.pdf']);
    const readBack = (await (
      entries[0] as unknown as {
        getData: (w: Uint8ArrayWriter) => Promise<Uint8Array>;
      }
    ).getData(new Uint8ArrayWriter())) as Uint8Array;
    expect(readBack.length).toBe(bytes.length);
    expect(Array.from(readBack.subarray(0, 64))).toEqual(Array.from(bytes.subarray(0, 64)));
    expect(Array.from(readBack)).toEqual(Array.from(bytes));
    await zip.close();
  });

  it('refuses a lookalike object, which is the trap this class exists to avoid', async () => {
    // Pins the reason ChunkedFileReader extends zip.js's Reader rather than merely
    // matching its shape: the writer does not accept a plain object, and a silently
    // skipped entry is how that surfaces.
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const lookalike = {
      size: bytes.length,
      readUint8Array: async (index: number, length: number) =>
        bytes.slice(index, index + length),
    };

    const writer = new ZipWriter(new Uint8ArrayWriter());
    let threw = false;
    try {
      await writer.add('book.pdf', lookalike as never, { level: 0 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    await writer.close();
  });

  /**
   * The restore side. Entries used to be read whole and written whole, so restoring on a
   * phone meant holding the fattest book in the library in memory. The sink is injected so
   * this path — which in production needs the native file layer — can be exercised here.
   */
  async function oneEntryZip(bytes: Uint8Array) {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add('hash/big.pdf', new Uint8ArrayReader(bytes), { level: 0 });
    const archive = await writer.close();
    const zip = new ZipReader(new Uint8ArrayReader(archive));
    const [entry] = await zip.getEntries();
    return { entry, zip };
  }

  it('streams an entry out through the sink in bounded chunks, never whole', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 99);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 253;
    const { entry, zip } = await oneEntryZip(bytes);

    const chunks: Uint8Array[] = [];
    const wholeWrites: Uint8Array[] = [];
    const appService = {
      writeFile: async (_p: string, _b: string, content: ArrayBuffer) => {
        wholeWrites.push(new Uint8Array(content));
      },
    };

    await writeEntryToBooks(
      appService as never,
      entry as never,
      async () => ({
        write: async (chunk: Uint8Array) => {
          chunks.push(new Uint8Array(chunk));
        },
        close: async () => {},
      }),
    );

    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    expect(joined.length).toBe(bytes.length);
    expect(Array.from(joined)).toEqual(Array.from(bytes));
    // The point of the exercise: more than one chunk, and no chunk the size of the file.
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(bytes.length);
    // ...and it did not quietly take the whole-file route instead.
    expect(wholeWrites.length).toBe(0);
    await zip.close();
  });

  it('falls back to a single whole write when no sink can be opened', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const { entry, zip } = await oneEntryZip(bytes);

    const wholeWrites: Uint8Array[] = [];
    const appService = {
      writeFile: async (_p: string, _b: string, content: ArrayBuffer) => {
        wholeWrites.push(new Uint8Array(content));
      },
    };

    await writeEntryToBooks(appService as never, entry as never, async () => null);

    expect(wholeWrites.length).toBe(1);
    expect(Array.from(wholeWrites[0]!)).toEqual(Array.from(bytes));
    await zip.close();
  });
});
