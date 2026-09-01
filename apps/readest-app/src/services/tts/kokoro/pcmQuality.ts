/** Peak absolute amplitude of a PCM buffer. NaN/Inf count as unusable (0). */
export const pcmPeak = (samples: ArrayLike<number>): number => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    if (!Number.isFinite(v)) return 0;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return peak;
};

// Speech is typically 0.1–0.9. WebGPU NaN/zeros encode as a valid-length
// silent WAV; duration checks pass and highlighting still runs.
export const MIN_AUDIBLE_PEAK = 0.02;

export const assertAudiblePcm = (samples: ArrayLike<number>, label: string): number => {
  const peak = pcmPeak(samples);
  if (peak < MIN_AUDIBLE_PEAK) {
    throw new Error(`${label} produced inaudible audio (peak=${peak.toFixed(5)})`);
  }
  return peak;
};
