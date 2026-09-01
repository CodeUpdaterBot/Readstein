import type { TTSModelSize } from '../types';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type KokoroDtype = 'q4' | 'q8' | 'fp16' | 'fp32' | 'q4f16';

export const MODEL_SIZE_TO_DTYPE: Record<'tiny' | 'small' | 'large', KokoroDtype> = {
  tiny: 'q4',
  small: 'q8',
  large: 'fp16',
};

/** Approximate download size in MB for desktop Kokoro (banner fallback). */
export const MODEL_SIZE_MB: Record<'tiny' | 'small' | 'large', number> = {
  tiny: 40,
  small: 86,
  large: 170,
};

export type KokoroVoiceMeta = {
  id: string;
  name: string;
  lang: string;
};

/** English voices shipped with Kokoro 82M v1.0. */
export const KOKORO_VOICES: KokoroVoiceMeta[] = [
  { id: 'af_heart', name: 'Heart', lang: 'en-US' },
  { id: 'af_alloy', name: 'Alloy', lang: 'en-US' },
  { id: 'af_aoede', name: 'Aoede', lang: 'en-US' },
  { id: 'af_bella', name: 'Bella', lang: 'en-US' },
  { id: 'af_jessica', name: 'Jessica', lang: 'en-US' },
  { id: 'af_kore', name: 'Kore', lang: 'en-US' },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-US' },
  { id: 'af_nova', name: 'Nova', lang: 'en-US' },
  { id: 'af_river', name: 'River', lang: 'en-US' },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-US' },
  { id: 'af_sky', name: 'Sky', lang: 'en-US' },
  { id: 'am_adam', name: 'Adam', lang: 'en-US' },
  { id: 'am_echo', name: 'Echo', lang: 'en-US' },
  { id: 'am_eric', name: 'Eric', lang: 'en-US' },
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en-US' },
  { id: 'am_liam', name: 'Liam', lang: 'en-US' },
  { id: 'am_michael', name: 'Michael', lang: 'en-US' },
  { id: 'am_onyx', name: 'Onyx', lang: 'en-US' },
  { id: 'am_puck', name: 'Puck', lang: 'en-US' },
  { id: 'am_santa', name: 'Santa', lang: 'en-US' },
  { id: 'bf_alice', name: 'Alice', lang: 'en-GB' },
  { id: 'bf_emma', name: 'Emma', lang: 'en-GB' },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-GB' },
  { id: 'bf_lily', name: 'Lily', lang: 'en-GB' },
  { id: 'bm_daniel', name: 'Daniel', lang: 'en-GB' },
  { id: 'bm_fable', name: 'Fable', lang: 'en-GB' },
  { id: 'bm_george', name: 'George', lang: 'en-GB' },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-GB' },
];

export const KOKORO_DEFAULT_VOICE = 'af_heart';

/** Kokoro / Piper / Kitten are English-first; other languages fall back. */
export const isKokoroLanguageSupported = (lang: string | undefined | null): boolean => {
  if (!lang) return true;
  return lang.toLowerCase().startsWith('en');
};

/** Supertonic 3 language codes, plus `na` for language-agnostic text. */
export const SUPERTONIC_LANGS = [
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
  'na',
] as const;

export function onDeviceLangCode(lang: string | undefined | null): string {
  if (!lang) return 'en';
  const base = lang.toLowerCase().split(/[-_]/)[0] ?? 'en';
  return (SUPERTONIC_LANGS as readonly string[]).includes(base) ? base : 'na';
}

// ── Worker protocol ─────────────────────────────────────────────────────────

export type KokoroWorkerRequest =
  | { id: number; type: 'init'; size: TTSModelSize; dtype: KokoroDtype }
  | { id: number; type: 'synthesize'; text: string; voice: string }
  | { id: number; type: 'shutdown' };

export type KokoroWorkerResponse =
  | {
      id: number;
      type: 'ready';
      device: 'webgpu' | 'wasm';
      dtype: KokoroDtype;
      adapterName?: string;
    }
  | {
      id: number;
      type: 'device-info';
      available: boolean;
      adapterName?: string;
      reason?: string;
    }
  | { id: number; type: 'progress'; loaded: number; total: number }
  | {
      id: number;
      type: 'audio';
      wav: ArrayBuffer;
      sampleRate: number;
      durationSec: number;
    }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'shutdown-ok' };
