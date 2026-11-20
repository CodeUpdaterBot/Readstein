import type { Book, BookFormat } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ReedyDb } from '../db/ReedyDb';
import type { BookIndexer } from './BookIndexer';
import type { EmbeddingModel } from '../models/EmbeddingModel';
import { resolveLibraryCorpus, type CorpusCandidate, type CorpusDecision } from './libraryDedup';
import { resolveEmbeddingDim } from './BookIndexer';

/**
 * Load one library book's document. Injected rather than imported so the
 * indexer can be exercised without the native file layer — the app passes the
 * same `DocumentLoader` the library search session uses.
 */
export type BookDocLoader = (book: Book) => Promise<BookDoc>;

export interface LibraryIndexProgress {
  phase: 'resolving' | 'indexing' | 'done';
  /** 1-based position of the book currently being indexed. */
  bookIndex: number;
  totalBooks: number;
  bookTitle: string;
  /** Per-book embedding progress while a single book is being indexed. */
  chunkProgress?: { current: number; total: number };
  indexed: number;
  skipped: number;
  empty: number;
  failed: number;
  /**
   * Why the most recent book failed. Surfaced so a run that fails every book
   * (a provider that is down, an unreadable file) is diagnosable from the UI
   * instead of being an unexplained tally.
   */
  lastError?: string;
  /**
   * One-off message about the corpus as a whole (e.g. a stale index discarded
   * because the embedding model changed), shown alongside the progress.
   */
  notice?: string;
}

/** Classes excluded from a translation's chunk text so the corpus stays English. */
export const LIBRARY_CORPUS_SKIP_CLASSES = ['source-text', 'editorial-note'];

export interface LibraryIndexReport {
  /** Live library records handed in. */
  considered: number;
  /** Distinct English works after deduplication — what actually enters the corpus. */
  works: number;
  indexed: number;
  /** Already indexed with the active model (or known-empty) — nothing to do. */
  skipped: number;
  /** Newly found to have no extractable text (a scan). */
  empty: number;
  failed: number;
  /** Records excluded because the work has no English representation at all. */
  notEnglish: number;
  /** Indexed works removed because they are no longer in the library. */
  pruned: number;
  /**
   * Set when a stale index was discarded because the embedding model changed
   * (its vectors are unusable at the new dimension) — human-readable, for the UI.
   */
  resetReason: string | null;
  /** Per-record outcome, so a UI can show what was merged or dropped. */
  decisions: CorpusDecision[];
  aborted: boolean;
}

export interface LibraryIndexOptions {
  onProgress?: (progress: LibraryIndexProgress) => void;
  /**
   * Called after a book's turn ends (indexed, skipped or failed) so the caller
   * can release whatever the loader opened for it — a book document holds a
   * file handle, and a sweep of the whole shelf must not keep them all open.
   */
  onBookDone?: (book: Book) => void;
  signal?: AbortSignal;
}

/**
 * Builds the library-wide AI corpus: one representative per work, indexed into
 * the shared Reedy store with its identity (title/author/group) on the meta row
 * so a library-scope search can cite the source.
 *
 * It is intentionally a *driver* — it owns dedup, ordering, skip/resume and
 * progress, and delegates every actual indexing job to the existing
 * {@link BookIndexer}. Because book status lives on `reedy_book_meta`, the run
 * is idempotent: re-running indexes only what is new or stale, so closing the
 * app mid-sweep and starting again simply continues.
 */
export class LibraryIndexer {
  constructor(
    private readonly reedy: ReedyDb,
    private readonly indexer: BookIndexer,
  ) {}

  /** Turn library records into dedup candidates, reading the declared translation links. */
  static toCandidates(books: Book[]): CorpusCandidate[] {
    return books.map((b) => ({
      hash: b.hash,
      title: b.title,
      author: b.author,
      format: b.format as BookFormat,
      language: b.primaryLanguage ?? null,
      translationOf: b.metadata?.translationOf ?? null,
      translations: b.metadata?.translations ?? null,
    }));
  }

  async run(
    books: Book[],
    model: EmbeddingModel,
    loadBookDoc: BookDocLoader,
    options: LibraryIndexOptions = {},
  ): Promise<LibraryIndexReport> {
    const { kept, decisions } = resolveLibraryCorpus(LibraryIndexer.toCandidates(books));
    const byHash = new Map(books.map((b) => [b.hash, b]));

    const report: LibraryIndexReport = {
      considered: books.length,
      works: kept.length,
      indexed: 0,
      skipped: 0,
      empty: 0,
      failed: 0,
      notEnglish: decisions.filter((d) => d.reason === 'not-english').length,
      pruned: 0,
      resetReason: null,
      decisions,
      aborted: false,
    };
    let lastError: string | undefined;
    let consecutiveSameError = 0;

    // Keep the corpus equal to the library before indexing into it: a work
    // deleted — or replaced, which changes its content-addressed hash — since
    // the last run must not stay retrievable and citable. The prune ignores an
    // empty list, so a partial shelf can never read as "everything was deleted".
    report.pruned = await this.reedy.pruneBooksNotIn(books.map((b) => b.hash));

    // One embedding model per database. If the stored vectors came from a
    // different model they cannot be compared with the active one, so EVERY book
    // would fail at `ensureEmbeddingsTable` without embedding a single chunk —
    // unrecoverable by retrying. Discard the stale index and rebuild it. The
    // probe also fails once, here, with a real message when the provider is
    // unreachable, instead of turning that into one failure per book.
    const dim = await resolveEmbeddingDim(model, options.signal);
    const existingDim = await this.reedy.embeddingsDim();
    if (existingDim != null && existingDim !== dim) {
      await this.reedy.wipeAllData();
      report.resetReason = `The previous index was built with ${existingDim}-dimensional vectors by a different embedding model, so it could not be reused. It has been cleared and is being rebuilt at ${dim} dimensions.`;
    }
    const notice = report.resetReason ?? undefined;

    const tally = (): Pick<LibraryIndexProgress, 'indexed' | 'skipped' | 'empty' | 'failed'> => ({
      indexed: report.indexed,
      skipped: report.skipped,
      empty: report.empty,
      failed: report.failed,
    });

    options.onProgress?.({
      phase: 'resolving',
      bookIndex: 0,
      totalBooks: kept.length,
      bookTitle: '',
      notice,
      ...tally(),
    });

    let i = 0;
    for (const candidate of kept) {
      if (options.signal?.aborted) {
        report.aborted = true;
        break;
      }
      const book = byHash.get(candidate.hash);
      i++;
      if (!book) continue;

      // Resume: a book already indexed with the active model is done. A book
      // already known to have no text (a scan) will never gain any, so it is
      // skipped too rather than re-opened on every sweep.
      const existing = await this.reedy.getBookMeta(book.hash);
      if (
        (existing?.indexingStatus === 'indexed' &&
          existing.embeddingModel === model.id &&
          existing.chunkCount > 0) ||
        existing?.indexingStatus === 'empty_index'
      ) {
        report.skipped++;
        continue;
      }

      const emit = (chunkProgress?: { current: number; total: number }): void =>
        options.onProgress?.({
          phase: 'indexing',
          bookIndex: i,
          totalBooks: kept.length,
          bookTitle: book.title,
          chunkProgress,
          lastError,
          notice,
          ...tally(),
        });

      emit();
      try {
        const doc = await loadBookDoc(book);
        await this.indexer.indexBook(doc, book.hash, model, {
          bookMeta: {
            title: book.title,
            author: book.author ?? null,
            group: book.groupName ?? null,
          },
          // English-only corpus: a Markdown translation contributes its English
          // column, not the Latin/German source it sits beside.
          chunkOptions: { skipClasses: LIBRARY_CORPUS_SKIP_CLASSES },
          onProgress: (e) => emit({ current: e.current, total: e.total }),
          signal: options.signal,
        });
        const after = await this.reedy.getBookMeta(book.hash);
        if (after?.indexingStatus === 'empty_index') report.empty++;
        else if (after?.indexingStatus === 'indexed') report.indexed++;
        else report.failed++;
      } catch (err) {
        // An abort is not a failure: stop cleanly and leave the book resumable
        // (its status row is whatever BookIndexer last wrote, so a later sweep
        // picks it up again). Any other error is one bad file — carry on so a
        // single unreadable book cannot stop the whole sweep.
        if (options.signal?.aborted) {
          report.aborted = true;
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        report.failed++;
        if (message === lastError) consecutiveSameError++;
        else {
          lastError = message;
          consecutiveSameError = 1;
        }
        // Three identical failures with nothing indexed is not a run of bad
        // books — it is one cause (provider unreachable, rejected credentials,
        // stale vectors). Stop and report it rather than repeating it over the
        // whole shelf.
        if (report.indexed === 0 && consecutiveSameError >= 3) {
          emit();
          break;
        }
        emit();
      }
      options.onBookDone?.(book);
    }

    options.onProgress?.({
      phase: 'done',
      bookIndex: i,
      totalBooks: kept.length,
      bookTitle: '',
      lastError,
      notice,
      ...tally(),
    });

    return report;
  }
}
