/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { BookIndexer } from '@/services/reedy/retrieval/BookIndexer';
import { LibraryIndexer } from '@/services/reedy/retrieval/LibraryIndexer';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import type { BookDoc, SectionItem } from '@/libs/document';
import type { Book } from '@/types/book';

const DIM = 4;

function fakeModel(): EmbeddingModel {
  return {
    id: 'fake-model',
    dim: DIM,
    batchSize: 4,
    async embed(texts) {
      return texts.map((t) => {
        const v = [0, 0, 0, 0];
        for (let i = 0; i < t.length; i++) v[i % 4]! += t.charCodeAt(i);
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
}

function section(id: string, html: string): SectionItem {
  return {
    id,
    cfi: '',
    size: html.length,
    linear: 'yes',
    async createDocument() {
      return new DOMParser().parseFromString(
        `<!DOCTYPE html><html><body>${html}</body></html>`,
        'text/html',
      );
    },
  };
}

function bookDoc(sections: SectionItem[]): BookDoc {
  return {
    metadata: { title: 'T', author: 'A', language: 'en' },
    rendition: {},
    dir: 'ltr',
    sections,
    splitTOCHref: () => [],
    async getCover() {
      return null;
    },
  } as unknown as BookDoc;
}

function record(partial: Partial<Book> & { hash: string; title: string }): Book {
  return {
    author: '',
    format: 'PDF',
    // The corpus is English-only; a record is English unless a test says otherwise.
    primaryLanguage: 'en',
    ...partial,
  } as unknown as Book;
}

describe('LibraryIndexer', () => {
  let svc: DatabaseService;
  let reedy: ReedyDb;
  let indexer: LibraryIndexer;

  beforeEach(async () => {
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    reedy = new ReedyDb(svc);
    indexer = new LibraryIndexer(reedy, new BookIndexer(reedy));
  });

  afterEach(async () => {
    await svc.close();
  });

  it('indexes one representative per work and records its identity', async () => {
    const books = [
      record({ hash: 'dup1', title: 'Example Expose', author: 'Example Author' }),
      record({ hash: 'dup2', title: 'Example Expose', author: 'Example Author' }),
      record({ hash: 'solo', title: 'Example Chronicle', author: 'Example Writer' }),
    ];
    const doc = bookDoc([
      section('s1', '<p>the quick brown fox jumps over the lazy dog today</p>'),
    ]);
    const loader = async () => doc;

    const report = await indexer.run(books, fakeModel(), loader);

    expect(report.considered).toBe(3);
    expect(report.works).toBe(2);
    expect(report.indexed).toBe(2);
    // Only the representative copy is in the store.
    expect(await reedy.getBookMeta('dup2')).toBeNull();
    const meta = await reedy.getBookMeta('dup1');
    expect(meta?.indexingStatus).toBe('indexed');
    expect(meta?.bookTitle).toBe('Example Expose');
    expect(meta?.authorName).toBe('Example Author');
  });

  it('excludes a non-English work from the corpus entirely', async () => {
    const books = [
      record({
        hash: 'de',
        title: 'Example German Work',
        author: 'Example German Author',
        primaryLanguage: 'de',
      }),
      record({ hash: 'en', title: 'Example Chronicle', author: 'Example Writer' }),
    ];
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);
    const report = await indexer.run(books, fakeModel(), async () => doc);

    expect(report.notEnglish).toBe(1);
    expect(report.works).toBe(1);
    expect(await reedy.getBookMeta('de')).toBeNull();
    expect((await reedy.getBookMeta('en'))?.indexingStatus).toBe('indexed');
  });

  it('indexes only the English column when a translation carries its source beside it', async () => {
    const books = [
      record({ hash: 'tr', title: 'Example Treatise - English Translation', format: 'MD' }),
    ];
    const doc = bookDoc([
      section(
        's1',
        '<div class="source-text" data-lang="la"><p>LATIN SOURCE COLUMN TEXT</p></div>' +
          '<p>English: Example translation sentence for the reader.</p>',
      ),
    ]);
    const report = await indexer.run(books, fakeModel(), async () => doc);
    expect(report.indexed).toBe(1);

    const rows = await svc.select<{ text: string }>(
      "SELECT text FROM reedy_book_chunks WHERE book_hash = 'tr'",
    );
    const all = rows.map((r) => r.text).join('\n');
    expect(all).toContain('Example translation sentence');
    expect(all).not.toContain('LATIN SOURCE COLUMN TEXT');
  });

  it('is resumable — a second run skips what is already indexed', async () => {
    const books = [record({ hash: 'a', title: 'Alpha', author: 'A' })];
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);

    const first = await indexer.run(books, fakeModel(), async () => doc);
    expect(first.indexed).toBe(1);

    const second = await indexer.run(books, fakeModel(), async () => doc);
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('re-indexes when the active embedding model changed', async () => {
    const books = [record({ hash: 'a', title: 'Alpha', author: 'A' })];
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);

    await indexer.run(books, fakeModel(), async () => doc);
    const other: EmbeddingModel = { ...fakeModel(), id: 'other-model' };
    const second = await indexer.run(books, other, async () => doc);
    expect(second.indexed).toBe(1);
  });

  it('records a scan with no extractable text as empty, not failed', async () => {
    const books = [record({ hash: 'scan', title: 'Image Only', author: 'A' })];
    const report = await indexer.run(books, fakeModel(), async () =>
      bookDoc([section('s1', '<p></p>')]),
    );
    expect(report.empty).toBe(1);
    expect(report.failed).toBe(0);
    expect((await reedy.getBookMeta('scan'))?.indexingStatus).toBe('empty_index');
  });

  it('carries on when one book fails to load', async () => {
    const books = [
      record({ hash: 'bad', title: 'Broken', author: 'A' }),
      record({ hash: 'good', title: 'Fine', author: 'B' }),
    ];
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);
    const report = await indexer.run(books, fakeModel(), async (book) => {
      if (book.hash === 'bad') throw new Error('file missing');
      return doc;
    });
    expect(report.failed).toBe(1);
    expect(report.indexed).toBe(1);
    expect((await reedy.getBookMeta('good'))?.indexingStatus).toBe('indexed');
  });

  it('stops at an abort signal and reports it without counting the book as failed', async () => {
    const books = [
      record({ hash: 'a', title: 'Alpha', author: 'A' }),
      record({ hash: 'b', title: 'Beta', author: 'B' }),
      record({ hash: 'c', title: 'Gamma', author: 'C' }),
    ];
    const controller = new AbortController();
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);
    const report = await indexer.run(books, fakeModel(), async () => doc, {
      signal: controller.signal,
      // Abort as the SECOND book starts, so the first is already indexed.
      onProgress: (p) => {
        if (p.phase === 'indexing' && p.bookIndex === 2) controller.abort();
      },
    });
    expect(report.aborted).toBe(true);
    expect(report.indexed).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('prunes an indexed book that has left the library', async () => {
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);
    const both = [
      record({ hash: 'keep', title: 'Kept Work', author: 'A' }),
      record({ hash: 'gone', title: 'Removed Work', author: 'B' }),
    ];
    const first = await indexer.run(both, fakeModel(), async () => doc);
    expect(first.indexed).toBe(2);
    expect(first.pruned).toBe(0);

    // The second run sees only one of them — the other was deleted.
    const second = await indexer.run([both[0]!], fakeModel(), async () => doc);
    expect(second.pruned).toBe(1);
    expect(await reedy.getBookMeta('gone')).toBeNull();
    expect((await reedy.getBookMeta('keep'))?.indexingStatus).toBe('indexed');
  });

  it('never prunes on an empty book list', async () => {
    const doc = bookDoc([section('s1', '<p>alpha bravo charlie delta echo foxtrot golf</p>')]);
    await indexer.run(
      [record({ hash: 'keep', title: 'Kept Work', author: 'A' })],
      fakeModel(),
      async () => doc,
    );

    // An unloaded/partial shelf must not read as "everything was deleted".
    const report = await indexer.run([], fakeModel(), async () => doc);
    expect(report.pruned).toBe(0);
    expect((await reedy.getBookMeta('keep'))?.indexingStatus).toBe('indexed');
  });
});
