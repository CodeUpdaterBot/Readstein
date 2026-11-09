import { describe, it, expect } from 'vitest';

import { makeMarkdownBook } from '@/utils/md';
import { sourceLanguageLabelOfCode } from '@/utils/sourceLanguage';
import type { BookDoc } from '@/libs/document';

/**
 * A translation file sets each page's original beside its English, and the reader
 * offers a switch to set that original aside. Two things have to be true for that
 * switch to be worth having: the source column must actually be marked in the
 * parsed document (so the stylesheet has something to hide), and the switch must
 * name the language it hides — 'Show Latin' on a German work is a wrong label, not
 * merely a vague one. These pin both.
 */

// makeMarkdownBook returns a foliate book whose sections carry a load()/createDocument()
// the BookDoc type does not declare.
type MdBook = BookDoc & {
  sections: Array<BookDoc['sections'][number] & { createDocument: () => Promise<Document> }>;
};

const make = async (content: string): Promise<MdBook> =>
  (await makeMarkdownBook(
    new File([content], 'work.md', { type: 'text/markdown' }),
  )) as unknown as MdBook;

const columns = (source: string, target = 'English') =>
  `# A work\n\n**${source}:**\n\n> source words\n\n**${target}:**\n\nThe translation.\n`;

describe('the source column and the language the reader is offered', () => {
  it('marks a Latin column and names it la', async () => {
    const book = await make(columns('Latin'));
    const doc = await book.sections[0]!.createDocument();

    expect(doc.querySelector('.source-text')?.getAttribute('data-lang')).toBe('la');
    expect(doc.querySelector('.source-text')?.textContent).toContain('source words');
    // The target heading is marked so it hides with the source; the translation is not.
    expect(doc.querySelector('.translation-label')?.textContent?.trim()).toBe('English:');
    expect(book.metadata.sourceLanguage).toBe('la');
  });

  it('marks a German column and names it de', async () => {
    const book = await make(columns('German', 'Englisch'));
    const doc = await book.sections[0]!.createDocument();

    expect(doc.querySelector('.source-text')?.getAttribute('data-lang')).toBe('de');
    expect(doc.querySelector('.source-text')?.textContent).toContain('source words');
    expect(book.metadata.sourceLanguage).toBe('de');
  });

  it('marks a Greek column and names it el', async () => {
    const book = await make(columns('Greek'));
    const doc = await book.sections[0]!.createDocument();

    expect(doc.querySelector('.source-text')?.getAttribute('data-lang')).toBe('el');
    expect(book.metadata.sourceLanguage).toBe('el');
  });

  it('keeps the translation outside the marked source column', async () => {
    const book = await make(columns('German'));
    const doc = await book.sections[0]!.createDocument();

    const source = doc.querySelector('.source-text');
    expect(source?.textContent).not.toContain('The translation.');
    expect(doc.body.textContent).toContain('The translation.');
  });

  it('leaves a column alone when its language is not one we know', async () => {
    // Guessing here would hide a column the reader was never told about, so an
    // unknown heading must not mark anything or name a language.
    const book = await make(columns('Old Prussian'));
    const doc = await book.sections[0]!.createDocument();

    expect(doc.querySelector('.source-text')).toBeNull();
    expect(book.metadata.sourceLanguage).toBeUndefined();
  });

  it('names no language for a work that has no source column at all', async () => {
    const book = await make('# A work\n\nJust the translation, in one language.\n');

    expect(book.metadata.sourceLanguage).toBeUndefined();
  });

  it('marks the translator confidence notes so they hide with the source', async () => {
    const book = await make(
      `# A work\n\n**Latin:**\n\n> source words\n\n**English:**\n\nThe translation.\n\n*confidence: high | the page is legible throughout.*\n`,
    );
    const doc = await book.sections[0]!.createDocument();

    expect(doc.querySelector('.editorial-note')?.textContent).toContain('confidence: high');
    // A note that belongs to the manuscript itself is not working apparatus and stays.
    const withManuscriptNote = await make(
      `# A work\n\n**Latin:**\n\n> source words\n\n**English:**\n\nThe translation [in red].\n`,
    );
    const other = await withManuscriptNote.sections[0]!.createDocument();
    expect(other.querySelector('.editorial-note')).toBeNull();
  });
});

describe('the language a code is named by', () => {
  it('names the languages the canon works are written in', () => {
    expect(sourceLanguageLabelOfCode('la')).toBe('Latin');
    expect(sourceLanguageLabelOfCode('de')).toBe('German');
    expect(sourceLanguageLabelOfCode('el')).toBe('Greek');
  });

  it('names nothing for a code outside the table', () => {
    expect(sourceLanguageLabelOfCode('')).toBeNull();
    expect(sourceLanguageLabelOfCode('prg')).toBeNull();
  });
});
