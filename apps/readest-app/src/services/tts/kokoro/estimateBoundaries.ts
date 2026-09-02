import type { TTSWordBoundary } from '@/libs/edgeTTS';

const TICKS_PER_SECOND = 10_000_000;

/**
 * Estimate Edge-shaped word boundaries from utterance duration and text.
 * Used when Kokoro (or any engine) does not emit real timings so word
 * highlighting and the scrubber still track roughly.
 */
export const estimateWordBoundaries = (text: string, durationSec: number): TTSWordBoundary[] => {
  const words = text.match(/\S+/g);
  if (!words || words.length === 0 || durationSec <= 0) return [];

  const weights = words.map((w) => Math.max(w.replace(/[^\p{L}\p{N}]/gu, '').length, 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const boundaries: TTSWordBoundary[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const frac = weights[i]! / totalWeight;
    const dur = durationSec * frac;
    boundaries.push({
      offset: Math.round(cursor * TICKS_PER_SECOND),
      duration: Math.round(dur * TICKS_PER_SECOND),
      text: words[i]!,
    });
    cursor += dur;
  }
  return boundaries;
};
