import { describe, it, expect } from 'vitest';
import {
  CHARS_PER_TOKEN_FLOOR,
  EMBEDDING_BATCH_SIZE,
  MAX_INPUTS_PER_REQUEST,
  MAX_TOKENS_PER_REQUEST,
  estimateTokens,
  planEmbeddingRequests,
} from '@/services/reedy/models/embeddingBatching';

describe('estimateTokens', () => {
  it('never returns zero, even for an empty input', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('abcd')).toBe(Math.ceil(4 / CHARS_PER_TOKEN_FLOOR));
  });
});

describe('planEmbeddingRequests', () => {
  it('returns nothing for no inputs', () => {
    expect(planEmbeddingRequests([])).toEqual([]);
  });

  it('keeps a small batch as one request', () => {
    const groups = planEmbeddingRequests(['one', 'two', 'three']);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(['one', 'two', 'three']);
  });

  it('splits at the provider input cap', () => {
    const texts = new Array(MAX_INPUTS_PER_REQUEST + 1).fill('a');
    const groups = planEmbeddingRequests(texts);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(MAX_INPUTS_PER_REQUEST);
    expect(groups[1]).toHaveLength(1);
  });

  it('splits on the aggregate token budget before the input cap', () => {
    // Each input estimates to 1000 tokens, so the budget allows 250 per request.
    const perRequest = Math.floor(MAX_TOKENS_PER_REQUEST / 1000);
    const texts = new Array(perRequest + 50).fill('x'.repeat(CHARS_PER_TOKEN_FLOOR * 1000));
    const groups = planEmbeddingRequests(texts);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(perRequest);
    expect(groups[1]).toHaveLength(50);
  });

  it('emits an over-budget input alone rather than dropping it', () => {
    const huge = 'y'.repeat(CHARS_PER_TOKEN_FLOOR * (MAX_TOKENS_PER_REQUEST + 1000));
    const groups = planEmbeddingRequests([huge, 'small']);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([huge]);
    expect(groups[1]).toEqual(['small']);
  });

  it('preserves input order across groups', () => {
    const texts = Array.from({ length: 1200 }, (_, i) => `chunk-${i}-`.padEnd(200, 'z'));
    const groups = planEmbeddingRequests(texts);
    expect(groups.flat()).toEqual(texts);
  });

  it('is sized so a planned slice stays inside both caps', () => {
    // The real chunker emits ~500-550 char chunks; assert one indexer slice
    // cannot produce an illegal request at that size.
    const chunk = 'w'.repeat(550);
    const groups = planEmbeddingRequests(new Array(EMBEDDING_BATCH_SIZE).fill(chunk));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.length).toBeLessThanOrEqual(MAX_INPUTS_PER_REQUEST);
    const tokens = groups[0]!.reduce((sum, t) => sum + estimateTokens(t), 0);
    expect(tokens).toBeLessThanOrEqual(MAX_TOKENS_PER_REQUEST);
  });
});
