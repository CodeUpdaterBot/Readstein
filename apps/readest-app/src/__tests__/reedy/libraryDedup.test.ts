import { describe, it, expect } from 'vitest';
import {
  isEnglishCandidate,
  normalizeWorkText,
  resolveLibraryCorpus,
  type CorpusCandidate,
} from '@/services/reedy/retrieval/libraryDedup';

/** The corpus is English-only; default every candidate to English unless it says otherwise. */
function withEnglish(candidates: CorpusCandidate[]): CorpusCandidate[] {
  return candidates.map((x) => ({ language: 'en', ...x }));
}

describe('normalizeWorkText', () => {
  it('strips the z-library site suffix, extension and punctuation', () => {
    expect(normalizeWorkText('Example Expose (z-library.sk, 1lib.sk, z-lib.sk).pdf')).toBe(
      'example expose',
    );
  });

  it('treats punctuation and case variants as the same key', () => {
    expect(normalizeWorkText('Sample Title: a composite work')).toBe(
      normalizeWorkText('sample title a composite work'),
    );
  });
});

describe('isEnglishCandidate', () => {
  it('accepts regions of English and rejects every other language', () => {
    expect(isEnglishCandidate({ hash: 'a', title: 't', language: 'en' })).toBe(true);
    expect(isEnglishCandidate({ hash: 'a', title: 't', language: 'EN' })).toBe(true);
    expect(isEnglishCandidate({ hash: 'a', title: 't', language: 'la' })).toBe(false);
    expect(isEnglishCandidate({ hash: 'a', title: 't', language: 'de' })).toBe(false);
    expect(isEnglishCandidate({ hash: 'a', title: 't', language: null })).toBe(false);
  });
});

describe('resolveLibraryCorpus', () => {
  it('keeps every unrelated work', () => {
    const candidates: CorpusCandidate[] = [
      { hash: 'a', title: 'Alpha', author: 'A', format: 'PDF' },
      { hash: 'b', title: 'Beta', author: 'B', format: 'MD' },
    ];
    const { kept, decisions } = resolveLibraryCorpus(withEnglish(candidates));
    expect(kept.map((c) => c.hash)).toEqual(['a', 'b']);
    expect(decisions.every((d) => d.reason === 'kept')).toBe(true);
  });

  it('drops a second copy of the same title+author as a duplicate', () => {
    const candidates: CorpusCandidate[] = [
      { hash: 'first', title: 'Example Expose', author: 'Example Author', format: 'PDF' },
      { hash: 'second', title: 'Example Expose', author: 'Example Author', format: 'PDF' },
    ];
    const { kept, decisions } = resolveLibraryCorpus(withEnglish(candidates));
    expect(kept.map((c) => c.hash)).toEqual(['first']);
    const dropped = decisions.find((d) => d.hash === 'second')!;
    expect(dropped.reason).toBe('duplicate');
    expect(dropped.keptHash).toBe('first');
  });

  it('collapses a scanned work and all its translations to one representative', () => {
    const candidates: CorpusCandidate[] = [
      {
        hash: 'scan',
        title: 'Example Manuscript MS-1',
        author: 'Example Author',
        format: 'PDF',
        language: 'la',
        translations: [
          { hash: 'old', translated: '379 complete, 0 partial, 15 marked non-text' },
          { hash: 'new', translated: '379 complete, 0 partial, 15 marked non-text' },
          { hash: 'gem', translated: '380 complete, 0 partial, 14 marked non-text' },
        ],
      },
      { hash: 'old', title: 'MS-1 (pass A)', format: 'MD', translationOf: 'scan' },
      { hash: 'new', title: 'MS-1 (pass B)', format: 'MD', translationOf: 'scan' },
      {
        hash: 'gem',
        title: 'MS-1 (OCR pass B)',
        format: 'MD',
        translationOf: 'scan',
      },
    ];
    const { kept, decisions } = resolveLibraryCorpus(withEnglish(candidates));
    // A translated text beats the scan; the fullest translation wins the tie.
    expect(kept.map((c) => c.hash)).toEqual(['gem']);
    expect(decisions.find((d) => d.hash === 'scan')?.reason).toBe('redundant-translation');
    expect(decisions.find((d) => d.hash === 'old')?.keptHash).toBe('gem');
    expect(decisions.filter((d) => d.reason === 'kept')).toHaveLength(1);
  });

  it('breaks a completeness tie toward the newest declared translation', () => {
    const candidates: CorpusCandidate[] = [
      {
        hash: 'scan',
        title: 'Work X',
        author: 'Anon',
        format: 'PDF',
        language: 'la',
        translations: [
          { hash: 't1', translated: '100 complete' },
          { hash: 't2', translated: '100 complete' },
        ],
      },
      { hash: 't1', title: 'Work X (v1)', format: 'MD', translationOf: 'scan' },
      { hash: 't2', title: 'Work X (v2)', format: 'MD', translationOf: 'scan' },
    ];
    const { kept } = resolveLibraryCorpus(withEnglish(candidates));
    expect(kept.map((c) => c.hash)).toEqual(['t2']);
  });

  it('prefers the fuller text when nothing declares completeness', () => {
    const candidates: CorpusCandidate[] = [
      { hash: 'small', title: 'Same Title', author: 'X', format: 'MD', textChars: 100 },
      { hash: 'big', title: 'Same Title', author: 'X', format: 'MD', textChars: 5000 },
    ];
    const { kept } = resolveLibraryCorpus(withEnglish(candidates));
    expect(kept.map((c) => c.hash)).toEqual(['big']);
  });

  it('prefers the English translation even over a larger non-English original', () => {
    const candidates: CorpusCandidate[] = [
      {
        hash: 'latin',
        title: 'Example Treatise',
        author: 'Example Compiler',
        format: 'MD',
        language: 'la',
        textChars: 10_000_000,
      },
      {
        hash: 'english',
        title: 'Example Treatise - English Translation',
        author: 'Example Compiler',
        format: 'MD',
        language: 'en',
        textChars: 5000,
        translationOf: 'latin',
      },
    ];
    const { kept } = resolveLibraryCorpus(candidates);
    expect(kept.map((c) => c.hash)).toEqual(['english']);
  });

  it('excludes a work whose only representation is non-English', () => {
    const candidates: CorpusCandidate[] = [
      {
        hash: 'de',
        title: 'Example German Title',
        format: 'PDF',
        language: 'de',
      },
      { hash: 'es', title: 'Example Spanish Work', format: 'PDF', language: 'es' },
      { hash: 'en', title: 'An English Book', format: 'PDF', language: 'en' },
    ];
    const { kept, decisions } = resolveLibraryCorpus(candidates);
    expect(kept.map((c) => c.hash)).toEqual(['en']);
    expect(decisions.find((d) => d.hash === 'de')?.reason).toBe('not-english');
    expect(decisions.find((d) => d.hash === 'es')?.reason).toBe('not-english');
  });

  it('is stable and returns one decision per input, in input order', () => {
    const candidates: CorpusCandidate[] = [
      { hash: 'x1', title: 'Dup', author: 'A', format: 'PDF' },
      { hash: 'y', title: 'Other', author: 'B', format: 'PDF' },
      { hash: 'x2', title: 'Dup', author: 'A', format: 'PDF' },
    ];
    const { decisions } = resolveLibraryCorpus(withEnglish(candidates));
    expect(decisions.map((d) => d.hash)).toEqual(['x1', 'y', 'x2']);
  });
});
