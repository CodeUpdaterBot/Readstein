import type { BookDoc } from '@/libs/document';
import { ReedyDb } from '../db/ReedyDb';
import type { ChunkRow, EmbeddingRow } from '../db/types';
import type { EmbeddingModel } from '../models/EmbeddingModel';
import { chunkPlainText, chunkSection, type ChunkOptions } from './CfiChunker';

const DEFAULT_BATCH_SIZE = 16;

export interface IndexBookOptions {
  /** Override CfiChunker tuning. Falls back to chunker defaults. */
  chunkOptions?: Partial<ChunkOptions>;
  /** Optional callback for progress reporting. Phases: 'chunking' | 'writing' | 'embedding'. */
  onProgress?: (event: {
    phase: 'chunking' | 'writing' | 'embedding';
    current: number;
    total: number;
  }) => void;
  /** Optional chapter-title resolver; defaults to `Section ${i + 1}`. */
  getChapterTitle?: (sectionIndex: number) => string | null;
  /** AbortSignal honoured by the embedding model. */
  signal?: AbortSignal;
  /**
   * Take a section's plain text when its format can give it without a document
   * (see {@link BookIndexer.plainSectionText}). Set by the library corpus: a
   * whole shelf of large PDFs cannot afford pdf.js's per-page TextLayer. The
   * reader's per-book path leaves this off, so its output is unchanged.
   */
  textOnly?: boolean;
  /**
   * Display identity persisted on the book's meta row so library-scope
   * searches can name the source work in a citation. Optional for the
   * reader's per-book path (nothing library-wide reads it there), required in
   * practice for the library indexer.
   */
  bookMeta?: { title?: string | null; author?: string | null; group?: string | null };
}

/**
 * Orchestrates one book's indexing pipeline:
 *   1. mutex per book so concurrent calls serialize
 *   2. chunk every section via CfiChunker
 *   3. lazy-create the embeddings table at the active model's dim
 *   4. embed in model-sized batches and insert
 *   5. land a terminal status (indexed | empty_index | failed) on reedy_book_meta
 *
 * The caller decides when to call this (settings panel "Index this book"
 * button, library-import hook, etc). Failures throw — the caller surfaces
 * the error to the user — but the meta row is updated to 'failed' first so
 * subsequent BookRetriever calls return a useful status.
 */
export class BookIndexer {
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly reedy: ReedyDb) {}

  async indexBook(
    bookDoc: BookDoc,
    bookHash: string,
    model: EmbeddingModel,
    options: IndexBookOptions = {},
  ): Promise<void> {
    // Chain on whatever's already in flight for this book so concurrent
    // callers serialize. We register the chained promise synchronously
    // (before any await) so a second concurrent caller sees the chain even
    // if no prior run had been registered when we entered.
    const prior = this.inflight.get(bookHash);
    const promise = (prior ? prior.catch(() => undefined) : Promise.resolve()).then(() =>
      this.runIndex(bookDoc, bookHash, model, options),
    );
    this.inflight.set(bookHash, promise);
    try {
      await promise;
    } finally {
      // Only clear if this is still the tail of the chain — a subsequent
      // caller may have appended after us and we shouldn't drop that.
      if (this.inflight.get(bookHash) === promise) {
        this.inflight.delete(bookHash);
      }
      // Fold the ingest burst out of the WAL; reedy.db never closes.
      void this.reedy.checkpoint().catch(() => {});
    }
  }

  private async runIndex(
    bookDoc: BookDoc,
    bookHash: string,
    model: EmbeddingModel,
    options: IndexBookOptions,
  ): Promise<void> {
    await this.reedy.upsertBookMeta({
      bookHash,
      indexingStatus: 'indexing',
      chunkCount: 0,
      embeddingModel: model.id,
      embeddingDim: 0,
      indexedAt: null,
      error: null,
      bookTitle: options.bookMeta?.title ?? null,
      authorName: options.bookMeta?.author ?? null,
      libraryGroup: options.bookMeta?.group ?? null,
    });
    // Re-indexing must replace, not duplicate — drop any prior chunks +
    // embeddings for this book before writing the new ones. The meta row
    // upserted above is preserved (clearBookChunks only touches the chunk
    // and embedding tables).
    await this.reedy.clearBookChunks(bookHash);

    try {
      // Hosted providers don't know vector width until the first round-trip.
      // Probe before ensureEmbeddingsTable so we never throw from `model.dim`.
      const dim = await resolveEmbeddingDim(model, options.signal);
      await this.reedy.upsertBookMeta({
        bookHash,
        indexingStatus: 'indexing',
        chunkCount: 0,
        embeddingModel: model.id,
        embeddingDim: dim,
        indexedAt: null,
        error: null,
        bookTitle: options.bookMeta?.title ?? null,
        authorName: options.bookMeta?.author ?? null,
        libraryGroup: options.bookMeta?.group ?? null,
      });

      const chunks = await this.collectChunks(bookDoc, bookHash, options);

      if (chunks.length === 0) {
        await this.reedy.setIndexingStatus(bookHash, 'empty_index', {
          chunkCount: 0,
          indexedAt: Date.now(),
          error: null,
        });
        return;
      }

      await this.reedy.ensureEmbeddingsTable(dim);
      await this.reedy.insertChunks(chunks, {
        // Bounded transactions, so a long write reports progress instead of
        // holding the lock silently (see ReedyDb.insertChunks).
        onProgress: (done, total) =>
          options.onProgress?.({ phase: 'writing', current: done, total }),
      });

      await this.embedAndStore(chunks, model, dim, options);

      await this.reedy.setIndexingStatus(bookHash, 'indexed', {
        chunkCount: chunks.length,
        indexedAt: Date.now(),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.reedy.setIndexingStatus(bookHash, 'failed', { error: message });
      throw err;
    }
  }

  private async collectChunks(
    bookDoc: BookDoc,
    bookHash: string,
    options: IndexBookOptions,
  ): Promise<ChunkRow[]> {
    const all: ChunkRow[] = [];
    const sections = bookDoc.sections;
    // TEMPORARY DIAGNOSTIC: where does a book's time actually go?
    let docMs = 0;
    let chunkMs = 0;
    let plainSections = 0;
    for (let i = 0; i < sections.length; i++) {
      options.onProgress?.({ phase: 'chunking', current: i, total: sections.length });
      const section = sections[i]!;
      const title = options.getChapterTitle?.(i) ?? `Section ${i + 1}`;
      const tChunk = performance.now();
      let sectionChunks: ChunkRow[] | null = null;

      // Cheapest first: a section whose format can hand over plain text costs
      // no document at all. Falls through to the DOM path for anything else.
      if (options.textOnly) {
        const plain = await this.plainSectionText(section);
        if (plain != null) {
          plainSections++;
          sectionChunks = chunkPlainText(plain, i, title, bookHash, options.chunkOptions);
        }
      }

      if (sectionChunks == null) {
        let doc: Document;
        const tDoc = performance.now();
        try {
          doc = await section.createDocument();
        } catch (err) {
          console.warn('[Reedy] section createDocument failed', { sectionIndex: i, err });
          chunkMs += performance.now() - tChunk;
          continue;
        }
        docMs += performance.now() - tDoc;
        sectionChunks = chunkSection(doc, i, title, bookHash, options.chunkOptions);
      }
      chunkMs += performance.now() - tChunk;
      if (i < 12 || i % 50 === 0) {
        console.info(
          `[reedy-timing] ${bookHash} sec ${i}/${sections.length} chunks=${all.length} ` +
            `plain=${plainSections} docMs=${Math.round(docMs)} chunkMs=${Math.round(chunkMs)}`,
        );
      }
      // Rewrite the position index to be monotonic across the whole book —
      // CfiChunker numbers within a section, the indexer needs a global order.
      for (const c of sectionChunks) {
        all.push({ ...c, positionIndex: all.length, id: `${bookHash}-${all.length}` });
      }
    }
    options.onProgress?.({ phase: 'chunking', current: sections.length, total: sections.length });
    console.info(
      `[reedy-timing] collectChunks ${bookHash} sections=${sections.length} chunks=${all.length} ` +
        `plain=${plainSections} chars=${all.reduce((n, c) => n + c.text.length, 0)} docMs=${Math.round(docMs)} chunkMs=${Math.round(chunkMs)}`,
    );
    return all;
  }

  /**
   * A section's plain text, when its format can produce it without a document.
   * PDFs can — `loadPlainText` reads pdf.js's raw text content — and that is the
   * difference between minutes and hours on a large scanned book, because the
   * DOM route runs pdf.js's TextLayer (font metrics + a rAF-driven render) once
   * per page.
   *
   * Markup is deliberately refused: the DOM path is where class-based
   * exclusions actually get applied, so the English-only corpus (which must
   * drop a `source-text` column) has to go through it.
   *
   * Note the name: `loadText` is taken, and means the section's *markup* to the
   * nav/TOC pipeline. This must never be reachable through that name.
   */
  private async plainSectionText(section: unknown): Promise<string | null> {
    const loadPlainText = (section as { loadPlainText?: () => Promise<string | null> })
      .loadPlainText;
    if (typeof loadPlainText !== 'function') return null;
    try {
      const text = await loadPlainText.call(section);
      if (typeof text !== 'string' || text.trim().length === 0) return null;
      if (text.includes('<')) return null;
      return text;
    } catch {
      return null;
    }
  }

  private async embedAndStore(
    chunks: ChunkRow[],
    model: EmbeddingModel,
    dim: number,
    options: IndexBookOptions,
  ): Promise<void> {
    const batchSize = Math.max(1, model.batchSize ?? DEFAULT_BATCH_SIZE);
    const total = chunks.length;
    let done = 0;
    for (let i = 0; i < total; i += batchSize) {
      if (options.signal?.aborted) {
        throw new Error('indexing aborted');
      }
      const batch = chunks.slice(i, i + batchSize);
      const vectors = await model.embed(
        batch.map((c) => c.text),
        { signal: options.signal },
      );
      if (vectors.length !== batch.length) {
        throw new Error(
          `embedding model returned ${vectors.length} vectors for ${batch.length} inputs`,
        );
      }
      const rows: EmbeddingRow[] = batch.map((c, j) => {
        const v = vectors[j]!;
        if (v.length !== dim) {
          throw new Error(
            `embedding for chunk ${c.id} has length ${v.length}, expected dim ${dim}`,
          );
        }
        return { chunkId: c.id, bookHash: c.bookHash, embedding: v };
      });
      await this.reedy.insertEmbeddings(rows);
      done += batch.length;
      options.onProgress?.({ phase: 'embedding', current: done, total });
    }
  }
}

/**
 * Hosted embedding adapters throw from `dim` until the first `embed()` call.
 * Read it when known; otherwise probe with a tiny sample so indexing can
 * create `vector32(<dim>)` before the real batches start.
 *
 * Exported because a caller about to index a whole collection must know the
 * dimension up front — to reset a stale table rather than fail every item.
 */
export async function resolveEmbeddingDim(
  model: EmbeddingModel,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const dim = model.dim;
    if (Number.isInteger(dim) && dim > 0) return dim;
  } catch {
    // getter throws until the first successful embed()
  }
  const sample = await model.embed(['.'], { signal });
  const dim = sample[0]?.length ?? 0;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error('embedding model did not return a usable vector dimension');
  }
  return dim;
}
