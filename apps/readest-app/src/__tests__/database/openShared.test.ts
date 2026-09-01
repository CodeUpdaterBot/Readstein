import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { openSharedDatabase, resetOpenSharedForTests } from '@/services/database/openShared';

describe('openSharedDatabase', () => {
  afterEach(() => {
    resetOpenSharedForTests();
  });

  it('concurrent first opens share one connection and migrate once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-shared-'));
    const path = join(dir, 'reedy.db');
    const key = `test:${path}`;
    try {
      const [a, b] = await Promise.all([
        openSharedDatabase(
          key,
          () => NodeDatabaseService.open(path, { experimental: ['index_method'] }),
          'reedy',
        ),
        openSharedDatabase(
          key,
          () => NodeDatabaseService.open(path, { experimental: ['index_method'] }),
          'reedy',
        ),
      ]);

      await a.execute(
        `INSERT INTO reedy_book_meta
           (book_hash, indexing_status, chunk_count, embedding_model, embedding_dim)
         VALUES (?, ?, ?, ?, ?)`,
        ['bk1', 'indexed', 1, 'm', 4],
      );
      const rows = await b.select<{ book_hash: string }>(
        'SELECT book_hash FROM reedy_book_meta WHERE book_hash = ?',
        ['bk1'],
      );
      expect(rows).toHaveLength(1);

      await a.close();
      const stillThere = await b.select<{ book_hash: string }>(
        'SELECT book_hash FROM reedy_book_meta WHERE book_hash = ?',
        ['bk1'],
      );
      expect(stillThere).toHaveLength(1);
      await b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
