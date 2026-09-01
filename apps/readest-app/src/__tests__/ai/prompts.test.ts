import { describe, expect, test } from 'vitest';
import { buildReedySystemPrompt, buildSystemPrompt } from '@/services/ai/prompts';
import type { ScoredChunk } from '@/services/ai/types';

const chunk: ScoredChunk = {
  id: 'c1',
  bookHash: 'bk1',
  sectionIndex: 0,
  chapterTitle: 'Introduction',
  pageNumber: 12,
  text: 'The thesis of this work is mind control.',
  searchMethod: 'hybrid',
  score: 0.9,
};

describe('buildSystemPrompt', () => {
  test('whole-book mode uses retrieved passages from the full index', () => {
    const prompt = buildSystemPrompt('The Controllers', 'Martin Cannon', [chunk], 2, false);

    expect(prompt).toContain('The Controllers');
    expect(prompt).toContain('Martin Cannon');
    expect(prompt).toContain('The thesis of this work is mind control.');
    expect(prompt).toContain('index covers the full book');
    expect(prompt).not.toContain('ONLY discuss content from pages');
    expect(prompt).not.toContain('We are only on page');
    expect(prompt).not.toContain('page_limit=');
  });

  test('spoiler mode forbids content past the current page', () => {
    const prompt = buildSystemPrompt('The Controllers', 'Martin Cannon', [chunk], 2, true);

    expect(prompt).toContain('ONLY discuss content from pages 1 to 2');
    expect(prompt).toContain('page_limit="2"');
    expect(prompt).toContain("We're only on page 2");
  });

  test('whole-book mode with no chunks does not pretend the user is only on the open page', () => {
    const prompt = buildSystemPrompt('The Controllers', '', [], 2, false);

    expect(prompt).toContain('No matching passages were retrieved');
    expect(prompt).not.toContain('No indexed content available for pages you have read yet');
  });
});

describe('buildReedySystemPrompt', () => {
  test('whole-book mode tells the model to search the entire index', () => {
    const prompt = buildReedySystemPrompt('The Controllers', 'Martin Cannon', false, 2);

    expect(prompt).toContain('lookupPassage');
    expect(prompt).toContain('entire indexed book');
    expect(prompt).toContain('not_indexed');
    expect(prompt).not.toContain('limited to pages the user has read');
  });

  test('spoiler mode says lookupPassage is capped to pages already read', () => {
    const prompt = buildReedySystemPrompt('The Controllers', '', true, 4);

    expect(prompt).toContain('through page 4');
    expect(prompt).toContain('limited to pages the user has read');
  });
});
