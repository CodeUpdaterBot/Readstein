import { describe, it, expect } from 'vitest';
import { createLibraryLayer } from '@/services/reedy/context/layers/LibraryLayer';
import { createLookupLibraryPassageTool } from '@/services/reedy/tools/builtins/lookupLibraryPassage';
import { applyEventToMessages, type ReedyMessage } from '@/services/reedy/store/reedyStore';
import type { BookRetriever, RetrievedChunk } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import type { ToolContext } from '@/services/reedy/tools/types';

const model: EmbeddingModel = {
  id: 'm',
  dim: 4,
  embed: async () => [[0, 0, 0, 0]],
};

const ctx = {
  bookHash: 'library',
  sessionId: 'library',
  assistantMessageId: 'a',
  signal: new AbortController().signal,
  requestPermission: async () => true,
} as ToolContext;

describe('LibraryLayer', () => {
  it('names the shelf and instructs the agent to attribute', () => {
    const layer = createLibraryLayer(() => ({
      workCount: 268,
      sampleTitles: ['Example Treatise', 'Example Folio'],
    }));
    const text = layer.render()!;
    expect(text).toContain('268');
    expect(text).toContain('Example Treatise');
    expect(text).toMatch(/name the work/i);
  });

  it('renders nothing before a corpus exists', () => {
    const layer = createLibraryLayer(() => ({ workCount: 0, sampleTitles: [], empty: true }));
    expect(layer.render()).toBeNull();
    expect(layer.shrink(1)).toBeNull();
  });

  it('shrinks to the count without the sample list, then drops', () => {
    const layer = createLibraryLayer(() => ({ workCount: 268, sampleTitles: ['Alpha', 'Beta'] }));
    const terse = layer.shrink(1)!;
    expect(terse).toContain('268');
    expect(terse).not.toContain('- Alpha');
    expect(layer.shrink(2)).toBeNull();
  });
});

describe('lookupLibraryPassage', () => {
  it('searches the library scope and names each source work', async () => {
    const calls: Array<{ bookHash?: string; query: string }> = [];
    const passage: RetrievedChunk = {
      id: 'c1',
      bookHash: 'bk',
      bookTitle: 'Example Treatise',
      authorName: 'Example Compiler',
      cfi: '/6/4!/4/2',
      endCfi: '/6/4!/4/4',
      sectionIndex: 0,
      chapterTitle: 'Ch1',
      text: 'a passage about the treatise',
      positionIndex: 0,
      score: 0.5,
    };
    const retriever = {
      async search(args: { bookHash?: string; query: string }) {
        calls.push(args);
        return { status: 'ok' as const, passages: [passage] };
      },
    } as unknown as BookRetriever;

    const tool = createLookupLibraryPassageTool({ retriever, activeEmbeddingModel: model });
    const res = await tool.run({ query: 'dagger of faith', topK: 3 }, ctx);

    // Library scope: no bookHash must be passed through to the retriever.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.bookHash).toBeUndefined();
    expect(calls[0]!.query).toBe('dagger of faith');
    // Every passage names its source so the answer can cite the work.
    expect(res.passages[0]!.bookTitle).toBe('Example Treatise');
    expect(res.passages[0]!.author).toBe('Example Compiler');
    expect(res.passages[0]!.bookHash).toBe('bk');
  });
});

describe('citation book identity', () => {
  it('carries the source work onto the assistant citation part', () => {
    const messages = [
      { id: 'msg', role: 'assistant', parts: [], createdAt: 0 },
    ] as unknown as ReedyMessage[];
    const out = applyEventToMessages(messages, 'msg', {
      type: 'citation',
      cfi: '/6/4!/4/2',
      sectionIndex: 0,
      snippet: 'x',
      bookHash: 'bk',
      bookTitle: 'Example Folio',
    });
    const part = out[0]!.role === 'assistant' ? out[0]!.parts[0]! : null;
    expect(part).toMatchObject({ type: 'citation', bookHash: 'bk', bookTitle: 'Example Folio' });
  });
});
