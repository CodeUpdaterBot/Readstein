/** Official Supertonic 3 ONNX + voice styles on Hugging Face. */
export const SUPERTONIC_HF_BASE =
  'https://huggingface.co/Supertone/supertonic-3/resolve/main';

export const SUPERTONIC_VOICE_IDS = [
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
] as const;

export type SupertonicVoiceId = (typeof SUPERTONIC_VOICE_IDS)[number];

export type SupertonicAsset = {
  key: string;
  path: string;
  /** Approximate bytes for download progress. */
  bytes: number;
};

export const SUPERTONIC_ONNX_ASSETS: readonly SupertonicAsset[] = [
  { key: 'duration_predictor.onnx', path: 'onnx/duration_predictor.onnx', bytes: 3_700_000 },
  { key: 'text_encoder.onnx', path: 'onnx/text_encoder.onnx', bytes: 36_000_000 },
  { key: 'vector_estimator.onnx', path: 'onnx/vector_estimator.onnx', bytes: 257_000_000 },
  { key: 'vocoder.onnx', path: 'onnx/vocoder.onnx', bytes: 101_000_000 },
  { key: 'tts.json', path: 'onnx/tts.json', bytes: 8_000 },
  { key: 'unicode_indexer.json', path: 'onnx/unicode_indexer.json', bytes: 1_200_000 },
];

export const SUPERTONIC_VOICE_ASSETS: readonly SupertonicAsset[] = SUPERTONIC_VOICE_IDS.map(
  (id) => ({
    key: `${id}.json`,
    path: `voice_styles/${id}.json`,
    bytes: 80_000,
  }),
);

export const SUPERTONIC_ASSETS: readonly SupertonicAsset[] = [
  ...SUPERTONIC_ONNX_ASSETS,
  ...SUPERTONIC_VOICE_ASSETS,
];

export const SUPERTONIC_CACHE = 'readest-supertonic-3';

export function supertonicAssetUrl(path: string): string {
  return `${SUPERTONIC_HF_BASE}/${path}`;
}

export function isSupertonicVoiceId(value: string | undefined | null): value is SupertonicVoiceId {
  return !!value && (SUPERTONIC_VOICE_IDS as readonly string[]).includes(value);
}
