import type { ReedyDb } from '../db/ReedyDb';
import type { ScoredChunk } from '../db/types';
import type { EmbeddingModel } from '../models/EmbeddingModel';

/**
 * Status the retriever reports back so the lookupPassage tool can phrase the
 * model's response, and so the UI can offer an appropriate next action
 * (e.g. "Index this book", "Re-index with new model"). `budget_exceeded` is
 * intentionally NOT part of this union — that status is surfaced by the
 * lookupPassage tool layer when it refuses to call the retriever again.
 */
export type RetrieverStatus = 'ok' | 'not_indexed' | 'empty_index' | 'stale_index' | 'degraded';

export interface RetrievedChunk {
  id: string;
  bookHash: string;
  /** The chunk's start CFI — the navigable anchor handed to the UI. */
  cfi: string;
  /** End CFI, useful for highlighting or future tool operations. */
  endCfi: string;
  /** EPUB section index (0-based), used by the Sources dropdown's fallback label. */
  sectionIndex: number;
  chapterTitle: string | null;
  text: string;
  positionIndex: number;
  /** Fused RRF score; informational only. */
  score: number;
  /** Source work title (library scope only; null on the per-book path). */
  bookTitle?: string | null;
  /** Source work author (library scope only; null on the per-book path). */
  authorName?: string | null;
}

export interface RetrieverResult {
  passages: RetrievedChunk[];
  status: RetrieverStatus;
  /** Human-readable reason for non-`ok` statuses; surfaced to the user via the model. */
  reason?: string;
}

export interface RetrieveArgs {
  /**
   * Restrict retrieval to one book. **Omit for a library-wide search** across
   * every indexed work — each returned passage then names its source book via
   * `bookTitle` / `bookHash`.
   */
  bookHash?: string;
  query: string;
  k: number;
  spoilerBoundPosition?: number;
  activeEmbeddingModel: EmbeddingModel;
  /** Query embedding wall-clock budget. @default 5000 */
  embeddingTimeoutMs?: number;
  /**
   * Library scope only: how many candidate books the cheap lexical router may
   * forward to exact search. Bounds a library-wide query's work. @default 8
   */
  routeBooks?: number;
  /**
   * Library scope only: extra books to include in the rerank even when they
   * did not surface lexically (semantic-only recall comes from the centroid
   * path in a later phase; today this is a no-op hook). @default 0
   */
  semanticBooks?: string[];
}

const DEFAULT_EMBEDDING_TIMEOUT_MS = 5000;

/**
 * Library scope: how many lexically-routed candidate books may be forwarded to
 * exact per-book search per query. Keeps a library-wide question bounded
 * regardless of how many works are indexed.
 */
const DEFAULT_ROUTE_BOOKS = 8;

/**
 * Per plan §M1.5 — wraps ReedyDb.hybridSearch with status detection and
 * graceful degradation. The retriever:
 *
 *   1. checks reedy_book_meta → returns `not_indexed` / `empty_index` /
 *      `stale_index` without touching the chunks/embeddings tables;
 *   2. embeds the user's query with a wall-clock budget; on timeout it
 *      reports `degraded` and falls through to FTS-only fusion;
 *   3. calls hybridSearch (vector cosine + Tantivy FTS + RRF) filtered by
 *      bookHash and spoilerBoundPosition;
 *   4. shapes ScoredChunk → RetrievedChunk for the tool layer.
 */
export class BookRetriever {
  constructor(private readonly reedy: ReedyDb) {}

  async search(args: RetrieveArgs): Promise<RetrieverResult> {
    if (args.bookHash === undefined) {
      return this.searchLibrary(args);
    }
    const meta = await this.reedy.getBookMeta(args.bookHash);
    if (!meta) {
      return { passages: [], status: 'not_indexed' };
    }
    // Check indexing_status FIRST so 'indexing' / 'failed' rows (which start
    // life with chunk_count=0) report not_indexed instead of empty_index.
    if (meta.indexingStatus === 'empty_index') {
      return { passages: [], status: 'empty_index' };
    }
    if (meta.indexingStatus !== 'indexed') {
      // 'indexing' / 'failed' fall here — no usable corpus yet.
      return { passages: [], status: 'not_indexed' };
    }
    if (meta.chunkCount === 0) {
      // Indexed but zero chunks — same shape as empty_index.
      return { passages: [], status: 'empty_index' };
    }
    if (meta.embeddingModel !== args.activeEmbeddingModel.id) {
      return {
        passages: [],
        status: 'stale_index',
        reason: `${args.activeEmbeddingModel.id} is selected but this book was indexed with ${meta.embeddingModel}; re-index required`,
      };
    }

    const timeoutMs = args.embeddingTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
    const { embedding, degraded, reason } = await embedQueryWithTimeout(
      args.activeEmbeddingModel,
      args.query,
      timeoutMs,
    );

    const scored = await this.reedy.hybridSearch({
      bookHash: args.bookHash,
      queryText: args.query,
      // When the embedding times out we fall back to FTS-only by passing a
      // zero vector — vector_distance_cos will produce uniform distances and
      // contribute nothing useful to the RRF; FTS still ranks meaningfully.
      queryEmbedding: embedding ?? new Array(args.activeEmbeddingModel.dim).fill(0),
      k: args.k,
      spoilerBoundPosition: args.spoilerBoundPosition,
    });

    const passages = scored.map(toPassage);

    if (degraded) {
      return { passages, status: 'degraded', reason };
    }
    return { passages, status: 'ok' };
  }

  /**
   * Library-wide retrieval (scope: 'library'). Two stages, because a brute-force
   * cosine over every indexed chunk does not scale past a few books:
   *
   *   1. **Route** — a cheap lexical pass (`ftsCandidateBooks`) picks the handful
   *      of books most likely to hold the answer.
   *   2. **Exact search** — the ordinary, bounded per-book hybrid search runs
   *      inside each routed book; results merge by RRF score.
   *
   * If routing finds nothing (e.g. a purely *semantic* question sharing no words
   * with the text) we fall back to one direct library-wide search so recall is
   * not lost — a phase-2 centroid router replaces that fallback.
   */
  private async searchLibrary(args: RetrieveArgs): Promise<RetrieverResult> {
    const metas = await this.reedy.listBookMeta();
    if (metas.length === 0) {
      return { passages: [], status: 'not_indexed' };
    }
    const indexed = metas.filter((m) => m.indexingStatus === 'indexed' && m.chunkCount > 0);
    if (indexed.length === 0) {
      return { passages: [], status: 'empty_index' };
    }

    const timeoutMs = args.embeddingTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
    const { embedding, degraded, reason } = await embedQueryWithTimeout(
      args.activeEmbeddingModel,
      args.query,
      timeoutMs,
    );
    const queryEmbedding = embedding ?? new Array(args.activeEmbeddingModel.dim).fill(0);

    const routeBooks = args.routeBooks ?? DEFAULT_ROUTE_BOOKS;
    // Route semantically first: the book vector is the shortlist, so a question
    // is matched by meaning against ~one vector per work rather than by scanning
    // every chunk. A corpus indexed before centroids existed gets them here,
    // once, computed from the vectors already stored — no re-embedding.
    let nearby = await this.reedy.nearestBooks(queryEmbedding, routeBooks);
    if (nearby.length === 0 && !degraded) {
      await this.reedy.ensureCentroids();
      nearby = await this.reedy.nearestBooks(queryEmbedding, routeBooks);
    }
    // Lexical routing still earns a slot: an exact term the vectors blur past
    // (a name, a code word) should not be lost to a semantic near-miss.
    const routed = await this.reedy.ftsCandidateBooks(args.query, routeBooks);
    const books = [...new Set([...nearby, ...routed, ...(args.semanticBooks ?? [])])].slice(
      0,
      routeBooks * 2,
    );

    let scored: ScoredChunk[];
    if (books.length > 0) {
      const perBook = await Promise.all(
        books.map((bookHash) =>
          this.reedy.hybridSearch({ bookHash, queryText: args.query, queryEmbedding, k: args.k }),
        ),
      );
      scored = perBook
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, args.k);
    } else {
      // No candidate book matched. Deliberately NOT falling back to a
      // library-wide vector scan: that is a brute-force cosine over every chunk
      // in the corpus — minutes at 200k chunks, and it is what made a vague
      // question look like a hang. An empty result is honest, cheap and
      // immediate; the caller already reports the degradation.
      scored = [];
    }

    const passages = scored.map(toPassage);
    if (degraded) {
      return { passages, status: 'degraded', reason };
    }
    return { passages, status: 'ok' };
  }
}

function toPassage(s: ScoredChunk): RetrievedChunk {
  return {
    id: s.id,
    bookHash: s.bookHash,
    cfi: s.startCfi,
    endCfi: s.endCfi,
    sectionIndex: s.sectionIndex,
    chapterTitle: s.chapterTitle,
    text: s.text,
    positionIndex: s.positionIndex,
    score: s.score,
    bookTitle: s.bookTitle ?? null,
    authorName: s.authorName ?? null,
  };
}

async function embedQueryWithTimeout(
  model: EmbeddingModel,
  query: string,
  timeoutMs: number,
): Promise<{ embedding: number[] | null; degraded: boolean; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await model.embed([query], { signal: controller.signal });
    const v = result[0];
    if (!v || v.length !== model.dim) {
      return {
        embedding: null,
        degraded: true,
        reason: `embedding_dim_mismatch: model returned ${v?.length ?? 'no'} values, expected ${model.dim}`,
      };
    }
    return { embedding: v, degraded: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      embedding: null,
      degraded: true,
      reason: controller.signal.aborted
        ? `embedding_timeout after ${timeoutMs}ms`
        : `embedding_failed: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
