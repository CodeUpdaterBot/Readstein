import type { DatabaseService } from '@/types/database';
import type {
  BookMeta,
  ChunkRow,
  EmbeddingRow,
  IndexingStatus,
  MemoryRow,
  MemoryScope,
  MemorySearchArgs,
  MemoryWriteArgs,
  ScoredChunk,
  ScoredMemoryRow,
} from './types';

/**
 * Typed wrapper around a Turso DatabaseService opened against reedy.db.
 *
 * MVP scope: single embedding model locked per database lifetime, single
 * global `reedy_book_chunk_embeddings` table created lazily by the first
 * `ensureEmbeddingsTable(dim)` call. Multi-model routing lives only in
 * Appendix A of the plan.
 *
 * Multi-row writes go through DatabaseService.batch() per plan §M1.2. Because
 * batch() takes raw SQL strings (no parameter binding), text values are
 * inline-quoted via {@link sqlQuote}; this is safe for SQLite which only
 * honours `''` as an escape sequence inside single-quoted strings.
 */
/** Rows per chunk-insert transaction — see {@link ReedyDb.insertChunks}. */
const INSERT_BATCH_SIZE = 200;

/** Messages per conversation-write transaction. */
const CONVERSATION_BATCH_SIZE = 100;

/** A stored conversation, as the history list needs it. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: number;
  /** The DB layer hands back rows with an index signature. */
  [key: string]: unknown;
}

/**
 * Words too common to route on. A query word that appears in half the shelf
 * tells us nothing about which books to search, and matching it diluted the
 * routing score badly enough that the same few large books won every question.
 * Only used to pick which words to route on — never to filter the text itself.
 */
const ROUTING_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'know',
  'what',
  'who',
  'how',
  'why',
  'are',
  'was',
  'were',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'this',
  'that',
  'these',
  'those',
  'them',
  'they',
  'their',
  'there',
  'then',
  'than',
  'with',
  'from',
  'into',
  'about',
  'any',
  'all',
  'some',
  'most',
  'more',
  'much',
  'many',
  'tell',
  'say',
  'said',
  'says',
  'now',
  'not',
  'but',
  'get',
  'got',
  'has',
  'have',
  'had',
  'its',
  'our',
  'out',
  'was',
  'were',
  'been',
  'being',
  'truth',
  'truths',
  'big',
  'biggest',
  'largest',
  'really',
  'actually',
  'entire',
  'whole',
  'corpus',
  'library',
  'books',
  'book',
  'trained',
  'reveal',
  'think',
  'give',
  'make',
  'made',
  'take',
  'took',
]);

export class ReedyDb {
  /**
   * Serializes every DB-mutating call that goes through `batch()` because the
   * underlying Turso connection only allows one BEGIN/COMMIT at a time. This
   * lets BookIndexer run embedding requests in parallel across books while
   * the writes themselves still go through one at a time.
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  /** In-flight centroid backfill, so it runs at most once at a time. */
  private centroidBackfill: Promise<void> | null = null;

  constructor(private readonly db: DatabaseService) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    // Swallow the value on the queue so a failure in one write doesn't
    // poison every subsequent write, while still letting the caller see it.
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Fold the WAL into reedy.db after ingest bursts. Turso is WAL-only with no
   * auto-checkpoint, and this connection is long-lived (never closed), so
   * without explicit checkpoints every written byte stays in reedy.db-wal.
   * Enqueued so it lands after any in-flight writes.
   */
  checkpoint(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {});
    });
  }

  // ---------------------------------------------------------------------------
  // book meta
  // ---------------------------------------------------------------------------

  async upsertBookMeta(meta: BookMeta): Promise<void> {
    await this.enqueue(() =>
      this.db.execute(
        `INSERT INTO reedy_book_meta
         (book_hash, indexing_status, chunk_count, embedding_model, embedding_dim, indexed_at, error, book_title, author_name, library_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_hash) DO UPDATE SET
         indexing_status = excluded.indexing_status,
         chunk_count     = excluded.chunk_count,
         embedding_model = excluded.embedding_model,
         embedding_dim   = excluded.embedding_dim,
         indexed_at      = excluded.indexed_at,
         error           = excluded.error,
         book_title      = COALESCE(excluded.book_title, reedy_book_meta.book_title),
         author_name     = COALESCE(excluded.author_name, reedy_book_meta.author_name),
         library_group   = COALESCE(excluded.library_group, reedy_book_meta.library_group)`,
        [
          meta.bookHash,
          meta.indexingStatus,
          meta.chunkCount,
          meta.embeddingModel,
          meta.embeddingDim,
          meta.indexedAt,
          meta.error,
          meta.bookTitle ?? null,
          meta.authorName ?? null,
          meta.libraryGroup ?? null,
        ],
      ),
    );
  }

  async getBookMeta(bookHash: string): Promise<BookMeta | null> {
    const rows = await this.db.select<{
      book_hash: string;
      indexing_status: string;
      chunk_count: number;
      embedding_model: string;
      embedding_dim: number;
      indexed_at: number | null;
      error: string | null;
      book_title: string | null;
      author_name: string | null;
      library_group: string | null;
    }>('SELECT * FROM reedy_book_meta WHERE book_hash = ?', [bookHash]);
    const row = rows[0];
    if (!row) return null;
    return {
      bookHash: row.book_hash,
      indexingStatus: row.indexing_status as IndexingStatus,
      chunkCount: row.chunk_count,
      embeddingModel: row.embedding_model,
      embeddingDim: row.embedding_dim,
      indexedAt: row.indexed_at,
      error: row.error,
      bookTitle: row.book_title ?? null,
      authorName: row.author_name ?? null,
      libraryGroup: row.library_group ?? null,
    };
  }

  /**
   * Every indexed book's meta row, for the library-scope indexer/status view.
   * Ordered by hash so callers get a stable iteration order.
   */
  async listBookMeta(): Promise<BookMeta[]> {
    const rows = await this.db.select<{
      book_hash: string;
      indexing_status: string;
      chunk_count: number;
      embedding_model: string;
      embedding_dim: number;
      indexed_at: number | null;
      error: string | null;
      book_title: string | null;
      author_name: string | null;
      library_group: string | null;
    }>('SELECT * FROM reedy_book_meta ORDER BY book_hash');
    return rows.map((row) => ({
      bookHash: row.book_hash,
      indexingStatus: row.indexing_status as IndexingStatus,
      chunkCount: row.chunk_count,
      embeddingModel: row.embedding_model,
      embeddingDim: row.embedding_dim,
      indexedAt: row.indexed_at,
      error: row.error,
      bookTitle: row.book_title ?? null,
      authorName: row.author_name ?? null,
      libraryGroup: row.library_group ?? null,
    }));
  }

  async setIndexingStatus(
    bookHash: string,
    status: IndexingStatus,
    partial?: Partial<Pick<BookMeta, 'chunkCount' | 'indexedAt' | 'error'>>,
  ): Promise<void> {
    const sets: string[] = ['indexing_status = ?'];
    const params: unknown[] = [status];
    if (partial?.chunkCount !== undefined) {
      sets.push('chunk_count = ?');
      params.push(partial.chunkCount);
    }
    if (partial?.indexedAt !== undefined) {
      sets.push('indexed_at = ?');
      params.push(partial.indexedAt);
    }
    if ('error' in (partial ?? {})) {
      sets.push('error = ?');
      params.push(partial!.error ?? null);
    }
    params.push(bookHash);
    await this.enqueue(() =>
      this.db.execute(`UPDATE reedy_book_meta SET ${sets.join(', ')} WHERE book_hash = ?`, params),
    );
  }

  // ---------------------------------------------------------------------------
  // embeddings table lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Width of the existing embeddings table, or null when none exists yet.
   *
   * The table is a one-model-per-database lock, so callers that are about to
   * index must compare this against the active model's dim: a mismatch means
   * every stored vector is unusable and the index has to be rebuilt, not written
   * into. Read from `sqlite_master` because the width is part of the DDL
   * (`vector32(<dim>)`) — there is no PRAGMA for it.
   */
  async embeddingsDim(): Promise<number | null> {
    const rows = await this.db.select<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
    );
    const m = rows[0]?.sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
    return m ? Number.parseInt(m[1]!, 10) : null;
  }

  /**
   * Idempotently create the embeddings table with `vector32(<dim>)`. If the
   * table exists with a different dim, throws — the MVP locks one embedding
   * model per database, so a dim mismatch signals a misuse (e.g. the active
   * model changed but `wipeAllData` wasn't called).
   */
  async ensureEmbeddingsTable(dim: number): Promise<void> {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`ensureEmbeddingsTable: dim must be a positive integer, got ${dim}`);
    }
    // Enqueue the whole check-then-create so concurrent indexers don't race
    // between the SELECT and the CREATE.
    await this.enqueue(async () => {
      const existing = await this.db.select<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      if (existing.length === 0) {
        // Inline `dim` is a validated positive integer above — safe to interpolate.
        await this.db.batch([
          `CREATE TABLE reedy_book_chunk_embeddings (
             chunk_id TEXT PRIMARY KEY REFERENCES reedy_book_chunks(id) ON DELETE CASCADE,
             book_hash TEXT NOT NULL,
             embedding vector32(${dim})
           )`,
          'CREATE INDEX idx_embeddings_book ON reedy_book_chunk_embeddings(book_hash)',
        ]);
        return;
      }
      const m = existing[0]!.sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
      const existingDim = m ? parseInt(m[1]!, 10) : NaN;
      if (existingDim !== dim) {
        throw new Error(
          `ensureEmbeddingsTable: dim mismatch — existing table is vector32(${existingDim}), requested vector32(${dim}). ` +
            `Switching embedding models requires wipeAllData() first.`,
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // bulk writes
  // ---------------------------------------------------------------------------

  /**
   * Rows per insert transaction.
   *
   * Writing a whole book's chunks in ONE batch does not scale: measured on this
   * machine, 200 rows with the ngram FTS index take ~3.1s, but a single batch of
   * 2,033 rows (a 441-page PDF) did not complete in six minutes and held the
   * write lock — with a 38 MB WAL — the entire time. Cost is super-linear in
   * batch size, so writes are bounded and reported.
   */
  async insertChunks(
    chunks: ChunkRow[],
    options?: { onProgress?: (done: number, total: number) => void },
  ): Promise<void> {
    if (chunks.length === 0) return;
    for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
      const slice = chunks.slice(i, i + INSERT_BATCH_SIZE);
      const stmts = slice.map(
        (c) =>
          `INSERT INTO reedy_book_chunks
             (id, book_hash, section_index, chapter_title, start_cfi, end_cfi, position_index, text, token_count)
           VALUES (${sqlQuote(c.id)}, ${sqlQuote(c.bookHash)}, ${c.sectionIndex}, ${sqlQuoteNullable(c.chapterTitle)}, ${sqlQuote(c.startCfi)}, ${sqlQuote(c.endCfi)}, ${c.positionIndex}, ${sqlQuote(c.text)}, ${c.tokenCount})`,
      );
      await this.enqueue(() => this.db.batch(stmts));
      options?.onProgress?.(Math.min(i + INSERT_BATCH_SIZE, chunks.length), chunks.length);
    }
  }

  /**
   * Insert embedding rows. Asserts every row's vector matches the existing
   * table's dim (queried once from sqlite_master) before issuing SQL.
   */
  async insertEmbeddings(rows: EmbeddingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const dimRows = await this.db.select<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
    );
    const sql = dimRows[0]?.sql;
    const m = sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
    if (!m) {
      throw new Error(
        'insertEmbeddings: reedy_book_chunk_embeddings does not exist — call ensureEmbeddingsTable(dim) first.',
      );
    }
    const dim = parseInt(m[1]!, 10);
    for (const r of rows) {
      if (r.embedding.length !== dim) {
        throw new Error(
          `insertEmbeddings: embedding for chunk ${r.chunkId} has length ${r.embedding.length}, expected dim ${dim}`,
        );
      }
    }
    const stmts = rows.map(
      (r) =>
        `INSERT INTO reedy_book_chunk_embeddings (chunk_id, book_hash, embedding)
         VALUES (${sqlQuote(r.chunkId)}, ${sqlQuote(r.bookHash)}, vector32(${sqlQuote(serializeVector(r.embedding))}))`,
    );
    await this.enqueue(() => this.db.batch(stmts));
  }

  // ---------------------------------------------------------------------------
  // data lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clear a single book's chunks and embeddings but leave the meta row alone.
   * Used by BookIndexer when re-indexing — the meta row has just been set to
   * 'indexing' and must be preserved.
   */
  async clearBookChunks(bookHash: string): Promise<void> {
    await this.enqueue(async () => {
      // Embeddings reference chunks via ON DELETE CASCADE, but the embeddings
      // table may not exist yet on first index — guard with sqlite_master.
      const has = await this.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      if (has.length > 0) {
        await this.db.execute('DELETE FROM reedy_book_chunk_embeddings WHERE book_hash = ?', [
          bookHash,
        ]);
      }
      await this.db.execute('DELETE FROM reedy_book_chunks WHERE book_hash = ?', [bookHash]);
    });
  }

  async dropBookData(bookHash: string): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute('DELETE FROM reedy_book_chunk_embeddings WHERE book_hash = ?', [
        bookHash,
      ]);
      await this.db.execute('DELETE FROM reedy_book_chunks WHERE book_hash = ?', [bookHash]);
      await this.db.execute('DELETE FROM reedy_book_meta WHERE book_hash = ?', [bookHash]);
    });
  }

  /**
   * Drop every indexed book whose hash is NOT in `liveHashes`, and return how
   * many were removed.
   *
   * A book leaves the corpus without anyone asking: deleting it from the
   * library, or replacing its file (the hash is content-addressed, so an edited
   * translation is a *new* hash and the old one is orphaned). A library-scope
   * search reads every chunk in the table, so an orphan would still be retrieved
   * and cited for a work the user no longer has — a citation that cannot be
   * opened. Pruning on each build keeps the corpus equal to the library.
   *
   * Refuses to act on an empty list: an unloaded or partial shelf must never be
   * mistaken for "the user deleted everything".
   */
  async pruneBooksNotIn(liveHashes: string[]): Promise<number> {
    if (liveHashes.length === 0) return 0;
    const keep = new Set(liveHashes);
    const metas = await this.listBookMeta();
    const stale = metas.map((m) => m.bookHash).filter((hash) => !keep.has(hash));
    for (const hash of stale) await this.dropBookData(hash);
    return stale.length;
  }

  /**
   * Wipe every Reedy-managed row across the database. Used when the user
   * switches embedding models — the lazy embeddings table keeps its
   * existing vector32(<old-dim>) shape until something writes to it again,
   * but the next ensureEmbeddingsTable(<new-dim>) call will succeed
   * because we DROP the table here as well.
   */
  async wipeAllData(): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute('DELETE FROM reedy_book_meta');
      // Drop embeddings tables so a future ensure*EmbeddingsTable(newDim)
      // is free to recreate them with a different vector32 width.
      await this.db.execute('DROP TABLE IF EXISTS reedy_book_chunk_embeddings');
      await this.db.execute('DROP TABLE IF EXISTS reedy_memory_embeddings');
      await this.db.execute('DELETE FROM reedy_book_chunks');
      await this.db.execute('DELETE FROM reedy_memory');
    });
  }

  // ---------------------------------------------------------------------------
  // memory (Phase 3.1)
  // ---------------------------------------------------------------------------

  /**
   * Lazy-create reedy_memory_embeddings the same way the chunk embeddings
   * table is created — vector32(<dim>) lives on a sibling row keyed on
   * memory_id, with ON DELETE CASCADE so deleting a memory row also drops
   * its vector. Same dim-mismatch contract as ensureEmbeddingsTable.
   */
  async ensureMemoryEmbeddingsTable(dim: number): Promise<void> {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`ensureMemoryEmbeddingsTable: dim must be a positive integer, got ${dim}`);
    }
    await this.enqueue(async () => {
      const existing = await this.db.select<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_memory_embeddings'",
      );
      if (existing.length === 0) {
        await this.db.batch([
          `CREATE TABLE reedy_memory_embeddings (
             memory_id TEXT PRIMARY KEY REFERENCES reedy_memory(id) ON DELETE CASCADE,
             embedding vector32(${dim})
           )`,
        ]);
        return;
      }
      const m = existing[0]!.sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
      const existingDim = m ? parseInt(m[1]!, 10) : NaN;
      if (existingDim !== dim) {
        throw new Error(
          `ensureMemoryEmbeddingsTable: dim mismatch — existing table is vector32(${existingDim}), requested vector32(${dim}). ` +
            `Switching embedding models requires wipeAllData() first.`,
        );
      }
    });
  }

  /**
   * Upsert one memory row by (scope, scope_key, key). Re-writing the same
   * key replaces the prior summary and bumps updated_at. When
   * `args.embedding` is provided, the matching reedy_memory_embeddings row
   * is also upserted — caller must have called ensureMemoryEmbeddingsTable
   * with the same dim already.
   */
  async upsertMemory(args: MemoryWriteArgs): Promise<MemoryRow> {
    const id = await this.upsertMemoryRow(args);
    if (args.embedding != null) {
      if (args.embedding.length === 0) {
        throw new Error('upsertMemory: empty embedding array');
      }
      await this.upsertMemoryEmbedding(id, args.embedding);
    }
    const row = await this.getMemoryById(id);
    if (!row) throw new Error(`upsertMemory: row vanished after write (id=${id})`);
    return row;
  }

  private async upsertMemoryRow(args: MemoryWriteArgs): Promise<string> {
    const now = Date.now();
    return this.enqueue(async () => {
      const existing = await this.db.select<{ id: string }>(
        'SELECT id FROM reedy_memory WHERE scope = ? AND scope_key = ? AND key = ?',
        [args.scope, args.scopeKey, args.key],
      );
      if (existing[0]) {
        const id = existing[0].id;
        await this.db.execute(
          `UPDATE reedy_memory SET summary = ?, source_message_id = ?, updated_at = ?
             WHERE id = ?`,
          [args.summary, args.sourceMessageId ?? null, now, id],
        );
        return id;
      }
      const id = randomMemoryId();
      await this.db.execute(
        `INSERT INTO reedy_memory (id, scope, scope_key, key, summary, source_message_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, args.scope, args.scopeKey, args.key, args.summary, args.sourceMessageId ?? null, now],
      );
      return id;
    });
  }

  private async upsertMemoryEmbedding(memoryId: string, embedding: number[]): Promise<void> {
    await this.enqueue(() =>
      this.db.batch([
        `INSERT INTO reedy_memory_embeddings (memory_id, embedding)
           VALUES (${sqlQuote(memoryId)}, vector32(${sqlQuote(serializeVector(embedding))}))
         ON CONFLICT(memory_id) DO UPDATE SET embedding = excluded.embedding`,
      ]),
    );
  }

  async getMemory(scope: MemoryScope, scopeKey: string, key: string): Promise<MemoryRow | null> {
    const rows = await this.db.select<MemoryRowSql>(
      'SELECT * FROM reedy_memory WHERE scope = ? AND scope_key = ? AND key = ?',
      [scope, scopeKey, key],
    );
    return rows[0] ? toMemoryRow(rows[0]) : null;
  }

  async deleteMemory(scope: MemoryScope, scopeKey: string, key: string): Promise<boolean> {
    return this.enqueue(async () => {
      const matched = await this.db.select<{ id: string }>(
        'SELECT id FROM reedy_memory WHERE scope = ? AND scope_key = ? AND key = ?',
        [scope, scopeKey, key],
      );
      if (matched.length === 0) return false;
      const id = matched[0]!.id;
      // We can't rely on PRAGMA foreign_keys = ON in callers' connections,
      // so explicitly drop the embedding row first when the table exists.
      const hasEmbTable = await this.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_memory_embeddings'",
      );
      if (hasEmbTable.length > 0) {
        await this.db.execute('DELETE FROM reedy_memory_embeddings WHERE memory_id = ?', [id]);
      }
      await this.db.execute('DELETE FROM reedy_memory WHERE id = ?', [id]);
      return true;
    });
  }

  async listMemories(scope: MemoryScope, scopeKey: string, limit: number): Promise<MemoryRow[]> {
    if (limit <= 0) return [];
    const rows = await this.db.select<MemoryRowSql>(
      `SELECT * FROM reedy_memory
        WHERE scope = ? AND scope_key = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
      [scope, scopeKey, limit],
    );
    return rows.map(toMemoryRow);
  }

  /**
   * Hybrid memory search — vector cosine + recency. When the caller
   * provides a queryEmbedding, score = vectorDistance + recencyWeight *
   * normalizedAge; otherwise rows are returned by recency only. Both
   * components are positive distance-like terms so a lower score wins.
   */
  async searchMemories(args: MemorySearchArgs): Promise<ScoredMemoryRow[]> {
    const limit = Math.max(0, args.limit);
    if (limit === 0) return [];
    const recencyWeight = args.recencyWeight ?? 0.1;
    const now = Date.now();

    if (args.queryEmbedding && args.queryEmbedding.length > 0) {
      // Pull a slightly wider pool than `limit` so the JS-side fusion has
      // candidates to work with even if the top-K-by-distance and
      // top-K-by-recency disagree.
      const fetchK = Math.max(limit, limit * 3);
      const rows = await this.db.select<MemoryRowSql & { vector_distance: number }>(
        `SELECT m.*, vector_distance_cos(e.embedding, vector32(?)) AS vector_distance
           FROM reedy_memory m
           JOIN reedy_memory_embeddings e ON e.memory_id = m.id
          WHERE m.scope = ? AND m.scope_key = ?
          ORDER BY vector_distance ASC
          LIMIT ?`,
        [serializeVector(args.queryEmbedding), args.scope, args.scopeKey, fetchK],
      );
      const maxAge = Math.max(1, ...rows.map((r) => Math.max(0, now - r.updated_at)));
      const scored = rows.map((r) => {
        const distance = Number.isFinite(r.vector_distance) ? r.vector_distance : 1;
        const ageNorm = (now - r.updated_at) / maxAge; // 0 = newest, 1 = oldest in pool
        return {
          ...toMemoryRow(r),
          score: distance + recencyWeight * ageNorm,
          vectorDistance: distance,
        } as ScoredMemoryRow;
      });
      return scored.sort((a, b) => a.score - b.score).slice(0, limit);
    }

    const rows = await this.db.select<MemoryRowSql>(
      `SELECT * FROM reedy_memory
        WHERE scope = ? AND scope_key = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
      [args.scope, args.scopeKey, limit],
    );
    return rows.map(
      (r): ScoredMemoryRow => ({
        ...toMemoryRow(r),
        // Recency-only score: 0 for the newest, growing with age.
        score: Math.max(0, (now - r.updated_at) / 1000),
        vectorDistance: null,
      }),
    );
  }

  private async getMemoryById(id: string): Promise<MemoryRow | null> {
    const rows = await this.db.select<MemoryRowSql>('SELECT * FROM reedy_memory WHERE id = ?', [
      id,
    ]);
    return rows[0] ? toMemoryRow(rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // hybrid search (brute-force cosine + Tantivy FTS + RRF)
  // ---------------------------------------------------------------------------

  async hybridSearch(args: {
    /**
     * Restrict the search to one book. Omit for a **library-wide** search
     * across every indexed work — the returned rows then carry the source
     * work's title/author so the caller can cite which book a passage is from.
     */
    bookHash?: string;
    queryText: string;
    queryEmbedding: number[];
    k: number;
    spoilerBoundPosition?: number;
  }): Promise<ScoredChunk[]> {
    const { bookHash, queryText: _queryText, queryEmbedding, k, spoilerBoundPosition } = args;
    if (k <= 0) return [];

    // A spoiler bound is a position inside ONE book's reading order, so it is
    // meaningless library-wide: only honoured on the book scope.
    const applySpoiler = bookHash !== undefined && spoilerBoundPosition !== undefined;
    const spoilerClause = applySpoiler ? ' AND c.position_index <= ?' : '';
    const spoilerParam: unknown[] = applySpoiler ? [spoilerBoundPosition] : [];

    // Book scope adds an equality predicate; library scope leaves it out so the
    // whole table (every indexed work) is searched.
    const bookClause = bookHash !== undefined ? ' AND %TBL%.book_hash = ?' : '';
    const bookParam: unknown[] = bookHash !== undefined ? [bookHash] : [];

    // Over-fetch from each path so a chunk surfaced by one path still has a
    // chance to gain RRF mass from the other. Standard hybrid-search pattern.
    const fetchK = Math.max(k, k * RRF_FETCH_MULTIPLIER);

    // Vector path — brute-force cosine. Turso has no native vector index
    // module so this is O(n) per search; sub-ms at MVP per-book sizes (see
    // bench/vector-retrieval.bench.ts). Library scope scales that to every
    // indexed chunk, which is why callers route first (see LibraryRetriever).
    const vectorRows = await this.db.select<ScoredChunkRowSql>(
      `SELECT c.id, c.book_hash, c.section_index, c.chapter_title,
              c.start_cfi, c.end_cfi, c.position_index, c.text, c.token_count,
              m.book_title, m.author_name,
              vector_distance_cos(e.embedding, vector32(?)) AS metric
         FROM reedy_book_chunk_embeddings e
         JOIN reedy_book_chunks c ON c.id = e.chunk_id
         LEFT JOIN reedy_book_meta m ON m.book_hash = c.book_hash
        WHERE 1 = 1${bookClause.replace('%TBL%', 'e')}${spoilerClause}
        ORDER BY metric ASC
        LIMIT ?`,
      [serializeVector(queryEmbedding), ...bookParam, ...spoilerParam, fetchK],
    );

    // Lexical ranking is deliberately absent here: the chunk FTS index is
    // retired (see dropChunkFtsIndex), and re-deriving a lexical score with a
    // LIKE scan on every query would cost more than it contributes. Routing
    // picks the candidate books; the vector half ranks the chunks inside them.
    return reciprocalRankFusion(vectorRows, [], k);
  }

  // ---------------------------------------------------------------------------
  // library conversations
  // ---------------------------------------------------------------------------

  async createConversation(id: string, title: string | null): Promise<void> {
    const now = Date.now();
    await this.enqueue(() =>
      this.db.execute(
        `INSERT INTO reedy_conversations (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        [id, title, now, now],
      ),
    );
  }

  async listConversations(limit = 100): Promise<ConversationSummary[]> {
    try {
      return await this.db.select<ConversationSummary>(
        `SELECT id, title, updated_at AS updatedAt
           FROM reedy_conversations
          ORDER BY updated_at DESC
          LIMIT ?`,
        [limit],
      );
    } catch {
      return [];
    }
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.enqueue(() =>
      this.db.execute('UPDATE reedy_conversations SET title = ? WHERE id = ?', [title, id]),
    );
  }

  async deleteConversation(id: string): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute('DELETE FROM reedy_conversation_messages WHERE conversation_id = ?', [
        id,
      ]);
      await this.db.execute('DELETE FROM reedy_conversations WHERE id = ?', [id]);
    });
  }

  /**
   * Replace a conversation's messages wholesale. Threads are tens of messages,
   * not thousands, so replacing is simpler and safer than diffing — and it is
   * written in bounded batches for the same reason chunk inserts are.
   */
  async saveConversationMessages(id: string, messages: unknown[]): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute('DELETE FROM reedy_conversation_messages WHERE conversation_id = ?', [
        id,
      ]);
      const stmts = messages.map(
        (m, i) =>
          `INSERT INTO reedy_conversation_messages (conversation_id, ordinal, role, payload)
           VALUES (${sqlQuote(id)}, ${i}, ${sqlQuote((m as { role?: string }).role ?? 'assistant')}, ${sqlQuote(JSON.stringify(m))})`,
      );
      for (let i = 0; i < stmts.length; i += CONVERSATION_BATCH_SIZE) {
        await this.db.batch(stmts.slice(i, i + CONVERSATION_BATCH_SIZE));
      }
      await this.db.execute('UPDATE reedy_conversations SET updated_at = ? WHERE id = ?', [
        Date.now(),
        id,
      ]);
    });
  }

  async loadConversationMessages(id: string): Promise<unknown[]> {
    try {
      const rows = await this.db.select<{ payload: string }>(
        `SELECT payload FROM reedy_conversation_messages
          WHERE conversation_id = ?
          ORDER BY ordinal ASC`,
        [id],
      );
      return rows.map((r) => JSON.parse(r.payload) as unknown);
    } catch {
      return [];
    }
  }

  /**
   * Retire the chunk-text FTS index.
   *
   * It is no longer built or used. Measured on this machine it cost ~3.1s per
   * 200-row insert and grew with the index (33.7s per batch by 2,400 rows) —
   * quadratic over a shelf, and it bloated reedy.db to 3.6GB for ~260 works
   * (the ngram variant is ~10x the text on disk). Rebuilding it over the whole
   * corpus is a multi-minute single transaction. That is why the whole app went
   * unresponsive: the rebuild held the serial DB queue that every read and
   * write goes through.
   *
   * The app's own library-search benchmark reached the same conclusion for the
   * same reason: at per-book granularity an FTS index "cannot beat LIKE while
   * costing 2.3x disk and 7x build time" (see migrations/library-search).
   * Lexical routing now uses LIKE, and ranking is semantic.
   *
   * Idempotent, and instant once the index is gone — safe to call on open.
   */
  async dropChunkFtsIndex(): Promise<void> {
    await this.enqueue(() => this.db.execute('DROP INDEX IF EXISTS idx_chunks_fts'));
  }

  /**
   * Cheap candidate generation for the library scope: the distinct books that
   * have at least one chunk matching the query lexically, ranked by their best
   * FTS score. Used by LibraryRetriever to route a library-wide question to a
   * handful of likely books before running exact vector search inside them,
   * which is what keeps a library-wide query bounded.
   */
  /**
   * One vector per book — the mean of its chunk embeddings.
   *
   * This is the shortlist, nothing more: a library-wide question is routed to
   * the handful of works that are semantically near it by comparing against
   * ~260 vectors instead of every chunk in the corpus. The deep search and the
   * citations are unchanged — chunks are still retrieved and cited inside the
   * selected works, which is what keeps an answer attributable.
   *
   * Mirrors ensureEmbeddingsTable's contract: created lazily at the active
   * model's dim, and rebuilt if the stored width belongs to a different model
   * (vectors at two widths cannot be compared).
   */
  async ensureCentroidTable(dim: number): Promise<void> {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`ensureCentroidTable: dim must be a positive integer, got ${dim}`);
    }
    await this.enqueue(async () => {
      const rows = await this.db.select<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reedy_book_centroids'",
      );
      const existing = rows[0]?.sql;
      if (existing) {
        const m = existing.match(/vector32\s*\(\s*(\d+)\s*\)/i);
        if (m && Number(m[1]) === dim) return;
        await this.db.execute('DROP TABLE IF EXISTS reedy_book_centroids');
      }
      await this.db.execute(
        `CREATE TABLE reedy_book_centroids (book_hash TEXT PRIMARY KEY, embedding vector32(${dim}))`,
      );
    });
  }

  async upsertBookCentroid(bookHash: string, embedding: number[]): Promise<void> {
    if (embedding.length === 0) return;
    await this.enqueue(() =>
      this.db.execute(
        `INSERT INTO reedy_book_centroids (book_hash, embedding) VALUES (?, vector32(?))
         ON CONFLICT (book_hash) DO UPDATE SET embedding = excluded.embedding`,
        [bookHash, serializeVector(embedding)],
      ),
    );
  }

  /** The books whose centroid is nearest the query — the routing shortlist. */
  async nearestBooks(queryEmbedding: number[], limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    try {
      const rows = await this.db.select<{ book_hash: string }>(
        `SELECT book_hash FROM reedy_book_centroids
          ORDER BY vector_distance_cos(embedding, vector32(?)) ASC
          LIMIT ?`,
        [serializeVector(queryEmbedding), limit],
      );
      return rows.map((r) => r.book_hash);
    } catch {
      return [];
    }
  }

  /**
   * Give every already-indexed book a centroid, computed from the chunk
   * vectors already stored — no re-embedding, so no API cost for a corpus
   * indexed before centroids existed. Reads one book at a time so peak memory
   * stays at a single work's vectors rather than the shelf's.
   */
  async backfillBookCentroids(): Promise<number> {
    let written = 0;
    try {
      const books = await this.db.select<{ book_hash: string }>(
        `SELECT DISTINCT e.book_hash AS book_hash
           FROM reedy_book_chunk_embeddings e
          WHERE e.book_hash NOT IN (SELECT book_hash FROM reedy_book_centroids)`,
      );
      for (const { book_hash: hash } of books) {
        const rows = await this.db.select<{ embedding: unknown }>(
          'SELECT embedding FROM reedy_book_chunk_embeddings WHERE book_hash = ?',
          [hash],
        );
        const mean = meanOfEncodedVectors(rows.map((r) => r.embedding));
        if (!mean) continue;
        await this.upsertBookCentroid(hash, mean);
        written++;
      }
    } catch {
      // A missing table or a foreign-key surprise: routing falls back to the
      // lexical path, which is correct if slower. Never fatal.
    }
    return written;
  }

  /** Runs the backfill at most once per instance; the retriever calls it lazily. */
  async ensureCentroids(): Promise<void> {
    if (this.centroidBackfill) return this.centroidBackfill;
    const run = this.backfillBookCentroids()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (this.centroidBackfill === run) this.centroidBackfill = null;
      });
    this.centroidBackfill = run;
    return run;
  }

  /**
   * Candidate books for a library-wide question, by lexical match on the
   * query's significant words.
   *
   * This used to go through the Tantivy FTS index (`fts_match`). That index is
   * retired (see dropChunkFtsIndex), and this is the app's own precedent for
   * library search: LIKE at per-book granularity, which benchmarked faster than
   * the FTS index and costs no disk. One pass over the chunk table, ranked by
   * how many of a book's chunks hit.
   */
  async ftsCandidateBooks(queryText: string, limit: number): Promise<string[]> {
    if (limit <= 0 || queryText.trim().length === 0) return [];
    // Common words carry no signal but match almost every book, and because
    // candidate books were once ranked by RAW hit count that meant the biggest
    // books won every vaguely worded question ("...the biggest truths..."). Drop
    // them, and rank by how many of the remaining words each chunk matches
    // rather than by how many chunks match at all.
    const words = [
      ...new Set(
        (queryText.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
          (w) => !ROUTING_STOPWORDS.has(w),
        ),
      ),
    ].slice(0, 4);
    if (words.length === 0) return [];
    const matches = words.map(() => '(text LIKE ?)').join(' + ');
    const anyWord = words.map(() => 'text LIKE ?').join(' OR ');
    try {
      const rows = await this.db.select<{ book_hash: string }>(
        `SELECT book_hash, SUM(${matches}) AS metric
           FROM reedy_book_chunks
          WHERE ${anyWord}
          GROUP BY book_hash
          ORDER BY metric DESC
          LIMIT ?`,
        [...words.map((w) => `%${w}%`), ...words.map((w) => `%${w}%`), limit],
      );
      return rows.map((r) => r.book_hash);
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * A stored `vector32` column reads back as a Buffer of raw float32 bytes;
 * decode that to the original numbers. Null for anything unexpected, so callers
 * degrade rather than throw.
 */
function decodeEncodedVector(value: unknown): number[] | null {
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    return Array.from(new Float32Array(copy as ArrayBuffer));
  }
  if (Array.isArray(value)) return (value as number[]).map(Number);
  return null;
}

/** Mean of stored vectors, or null when nothing decoded. */
function meanOfEncodedVectors(values: unknown[]): number[] | null {
  let sum: number[] | null = null;
  let count = 0;
  for (const value of values) {
    const v = decodeEncodedVector(value);
    if (!v || (sum && v.length !== sum.length)) continue;
    if (!sum) sum = new Array(v.length).fill(0);
    for (let i = 0; i < v.length; i++) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
    count++;
  }
  if (!sum || count === 0) return null;
  return sum.map((n) => n / count);
}

interface ScoredChunkRowSql {
  id: string;
  book_hash: string;
  section_index: number;
  chapter_title: string | null;
  start_cfi: string;
  end_cfi: string;
  position_index: number;
  text: string;
  token_count: number;
  metric: number;
  book_title?: string | null;
  author_name?: string | null;
  [key: string]: unknown;
}

function rowToChunk(row: ScoredChunkRowSql): Omit<ScoredChunk, 'score' | 'vectorRank' | 'ftsRank'> {
  return {
    id: row.id,
    bookHash: row.book_hash,
    sectionIndex: row.section_index,
    chapterTitle: row.chapter_title,
    startCfi: row.start_cfi,
    endCfi: row.end_cfi,
    positionIndex: row.position_index,
    text: row.text,
    tokenCount: row.token_count,
    bookTitle: row.book_title ?? null,
    authorName: row.author_name ?? null,
  };
}

// RRF constant per the Cormack/Clarke/Buettcher paper; dampens single-path
// dominance so a chunk surfaced by both lists outranks a chunk near the top
// of only one list.
const RRF_K = 60;
// Per-path over-fetch multiplier so a chunk that won on FTS but tied on
// vector (or vice-versa) still gets a vector rank contributing to its
// RRF score. Standard 3-5× hybrid-search rule of thumb.
const RRF_FETCH_MULTIPLIER = 3;

function reciprocalRankFusion(
  vectorRows: ScoredChunkRowSql[],
  ftsRows: ScoredChunkRowSql[],
  topK: number,
): ScoredChunk[] {
  const merged = new Map<string, ScoredChunk>();
  for (let i = 0; i < vectorRows.length; i++) {
    const row = vectorRows[i]!;
    const rank = i + 1;
    merged.set(row.id, {
      ...rowToChunk(row),
      score: 1 / (RRF_K + rank),
      vectorRank: rank,
      ftsRank: null,
    });
  }
  for (let i = 0; i < ftsRows.length; i++) {
    const row = ftsRows[i]!;
    const rank = i + 1;
    const existing = merged.get(row.id);
    if (existing) {
      existing.score += 1 / (RRF_K + rank);
      existing.ftsRank = rank;
    } else {
      merged.set(row.id, {
        ...rowToChunk(row),
        score: 1 / (RRF_K + rank),
        vectorRank: null,
        ftsRank: rank,
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

function serializeVector(v: number[]): string {
  return JSON.stringify(v);
}

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlQuoteNullable(s: string | null): string {
  return s === null ? 'NULL' : sqlQuote(s);
}

// ---------------------------------------------------------------------------
// memory helpers
// ---------------------------------------------------------------------------

interface MemoryRowSql {
  id: string;
  scope: string;
  scope_key: string;
  key: string;
  summary: string;
  source_message_id: string | null;
  updated_at: number;
  [key: string]: unknown;
}

function toMemoryRow(row: MemoryRowSql): MemoryRow {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    scopeKey: row.scope_key,
    key: row.key,
    summary: row.summary,
    sourceMessageId: row.source_message_id,
    updatedAt: row.updated_at,
  };
}

function randomMemoryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `mem-${crypto.randomUUID()}`;
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
