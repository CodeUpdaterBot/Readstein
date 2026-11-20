import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { BookRetriever, RetrieverStatus } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';

/**
 * Library-wide sibling of `lookupPassage`.
 *
 * `lookupPassage` searches the ONE book the user has open; this searches the
 * user's whole indexed corpus — every English work on the shelf — and every
 * passage it returns carries the work it came from, so the answer can cite a
 * book rather than a position in an unnamed text.
 */

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(10).default(6),
});

export interface LookupLibraryPassageDeps {
  /** A `BookRetriever`; the tool calls it with no bookHash → library scope. */
  retriever: BookRetriever;
  activeEmbeddingModel: EmbeddingModel;
  /** Books the lexical router may forward to exact search. */
  routeBooks?: number;
}

export interface LookupLibraryPassageResult {
  passages: Array<{
    bookHash: string;
    bookTitle: string | null;
    author: string | null;
    cfi: string;
    endCfi: string;
    chapter: string | null;
    text: string;
    score: number;
  }>;
  status: RetrieverStatus;
  reason?: string;
}

export function createLookupLibraryPassageTool(
  deps: LookupLibraryPassageDeps,
): ReedyTool<z.input<typeof inputSchema>, LookupLibraryPassageResult> {
  return {
    name: 'lookupLibraryPassage',
    description:
      "Search the user's ENTIRE personal library — every indexed book, not just one — for passages relevant to a question. Returns passages that each name the source work (title, author) plus a CFI anchor. Use this whenever the user asks about a subject, person, event or claim and you need to find what their own books say about it. Ground your answer in the passages you retrieve and name the work you drew each point from; if nothing relevant is found, say the library does not cover it rather than guessing.",
    permission: 'read',
    parallelSafe: true,
    inputSchema,
    async run(args) {
      const parsed = inputSchema.parse(args);
      const res = await deps.retriever.search({
        // No bookHash → library scope.
        query: parsed.query,
        k: parsed.topK,
        activeEmbeddingModel: deps.activeEmbeddingModel,
        routeBooks: deps.routeBooks,
      });
      return {
        passages: res.passages.map((p) => ({
          bookHash: p.bookHash,
          bookTitle: p.bookTitle ?? null,
          author: p.authorName ?? null,
          cfi: p.cfi,
          endCfi: p.endCfi,
          chapter: p.chapterTitle,
          text: p.text,
          score: p.score,
        })),
        status: res.status,
        reason: res.reason,
      };
    },
  };
}
