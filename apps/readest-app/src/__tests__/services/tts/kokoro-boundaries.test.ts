import { describe, expect, it } from 'vitest';
import { estimateWordBoundaries } from '@/services/tts/kokoro/estimateBoundaries';
import { isKokoroLanguageSupported } from '@/services/tts/kokoro/protocol';
import {
  KOKORO_MAX_CHARS,
  SHERPA_MAX_CHARS,
  splitKokoroUtterances,
} from '@/services/tts/kokoro/splitUtterances';

describe('estimateWordBoundaries', () => {
  it('returns empty for empty text', () => {
    expect(estimateWordBoundaries('', 1)).toEqual([]);
  });

  it('splits duration across words proportionally', () => {
    const boundaries = estimateWordBoundaries('Hi world', 1);
    expect(boundaries).toHaveLength(2);
    expect(boundaries[0]!.text).toBe('Hi');
    expect(boundaries[1]!.text).toBe('world');
    expect(boundaries[0]!.offset).toBe(0);
    expect(boundaries[1]!.offset).toBeGreaterThan(boundaries[0]!.offset);
    const totalTicks = boundaries.reduce((sum, b) => sum + b.duration, 0);
    expect(totalTicks).toBeCloseTo(10_000_000, -3);
  });
});

describe('isKokoroLanguageSupported', () => {
  it('accepts English locales', () => {
    expect(isKokoroLanguageSupported('en')).toBe(true);
    expect(isKokoroLanguageSupported('en-US')).toBe(true);
    expect(isKokoroLanguageSupported('EN-GB')).toBe(true);
  });

  it('rejects non-English', () => {
    expect(isKokoroLanguageSupported('zh')).toBe(false);
    expect(isKokoroLanguageSupported('fr-FR')).toBe(false);
  });
});

describe('splitKokoroUtterances', () => {
  it('returns empty for whitespace', () => {
    expect(splitKokoroUtterances('   ')).toEqual([]);
  });

  it('keeps short text as one utterance', () => {
    expect(splitKokoroUtterances('Hello world.')).toEqual(['Hello world.']);
  });

  it('keeps a medium paragraph as one clip', () => {
    const text =
      'The Illuminati were founded in 1776 by Adam Weishaupt. Beethoven later dedicated a work to a related circle. Conspiracy writers then mixed those facts with occult rumor until the page became one long spoken block.';
    expect(text.length).toBeLessThan(KOKORO_MAX_CHARS);
    expect(splitKokoroUtterances(text)).toEqual([text]);
  });

  it('splits long punctuated text at the char cap', () => {
    const sentence =
      'Conspiracy writers mixed those facts with occult rumor until the page became one long spoken block that keeps going with more names and dates. ';
    const text = sentence.repeat(12).trim();
    const parts = splitKokoroUtterances(text);
    expect(text.length).toBeGreaterThan(KOKORO_MAX_CHARS);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= KOKORO_MAX_CHARS)).toBe(true);
    expect(parts.join(' ')).toBe(text);
  });

  it('wraps unpunctuated OCR text instead of sending one giant generate', () => {
    const words = Array.from({ length: 220 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const parts = splitKokoroUtterances(text);
    expect(text.length).toBeGreaterThan(KOKORO_MAX_CHARS);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= KOKORO_MAX_CHARS)).toBe(true);
    expect(parts.join(' ')).toBe(text);
  });

  it('packs consecutive short sentences until the cap', () => {
    const parts = splitKokoroUtterances('Hi. Yo. Ok.');
    expect(parts).toEqual(['Hi. Yo. Ok.']);
  });

  it('uses a tighter cap for Android sherpa clips', () => {
    const sentence =
      'Conspiracy writers mixed those facts with occult rumor until the page became one long spoken block. ';
    const text = sentence.repeat(8).trim();
    const parts = splitKokoroUtterances(text, SHERPA_MAX_CHARS);
    expect(text.length).toBeGreaterThan(SHERPA_MAX_CHARS);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= SHERPA_MAX_CHARS)).toBe(true);
  });
});
