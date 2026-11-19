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
import { ChunkedFileReader } from '@/services/backupService';

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
});
