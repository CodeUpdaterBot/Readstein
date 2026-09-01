import type { KokoroVoiceMeta } from './protocol';

/**
 * Speaker IDs for sherpa-onnx kokoro-en-v0_19.
 * https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
 */
export const SHERPA_KOKORO_EN_VOICES: readonly (KokoroVoiceMeta & { sid: number })[] = [
  { id: 'af', name: 'Default', lang: 'en-US', sid: 0 },
  { id: 'af_bella', name: 'Bella', lang: 'en-US', sid: 1 },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-US', sid: 2 },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-US', sid: 3 },
  { id: 'af_sky', name: 'Sky', lang: 'en-US', sid: 4 },
  { id: 'am_adam', name: 'Adam', lang: 'en-US', sid: 5 },
  { id: 'am_michael', name: 'Michael', lang: 'en-US', sid: 6 },
  { id: 'bf_emma', name: 'Emma', lang: 'en-GB', sid: 7 },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-GB', sid: 8 },
  { id: 'bm_george', name: 'George', lang: 'en-GB', sid: 9 },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-GB', sid: 10 },
];

export const SHERPA_KOKORO_DEFAULT_VOICE = 'af_bella';

const ALIASES: Record<string, string> = {
  af_heart: 'af_bella',
  af_alloy: 'af_sarah',
  af_aoede: 'af_sky',
  af_jessica: 'af_nicole',
  af_kore: 'af_bella',
  af_nova: 'af_sky',
  af_river: 'af_sarah',
  am_echo: 'am_adam',
  am_eric: 'am_michael',
  am_fenrir: 'am_michael',
  am_liam: 'am_adam',
  am_onyx: 'am_michael',
  am_puck: 'am_adam',
  am_santa: 'am_michael',
  bf_alice: 'bf_emma',
  bf_lily: 'bf_isabella',
  bm_daniel: 'bm_george',
  bm_fable: 'bm_lewis',
};

export function mapVoiceToSherpaId(voice: string | undefined | null): string {
  if (!voice) return SHERPA_KOKORO_DEFAULT_VOICE;
  if (SHERPA_KOKORO_EN_VOICES.some((v) => v.id === voice)) return voice;
  return ALIASES[voice] ?? SHERPA_KOKORO_DEFAULT_VOICE;
}

export function sherpaVoiceSid(voice: string | undefined | null): number {
  const id = mapVoiceToSherpaId(voice);
  return SHERPA_KOKORO_EN_VOICES.find((v) => v.id === id)?.sid ?? 1;
}

/**
 * Kitten nano/mini expose 8 speakers (sid 0–7). Map Kokoro-style ids onto
 * the closest gender so the same voice picker works across model sizes.
 */
const KITTEN_SID_BY_KOKORO_ID: Record<string, number> = {
  af: 1,
  af_bella: 1,
  af_heart: 1,
  af_nicole: 3,
  af_jessica: 3,
  af_sarah: 5,
  af_alloy: 5,
  af_sky: 7,
  af_aoede: 7,
  af_nova: 7,
  af_kore: 1,
  af_river: 5,
  am_adam: 0,
  am_echo: 0,
  am_liam: 0,
  am_puck: 0,
  am_michael: 2,
  am_eric: 2,
  am_fenrir: 2,
  am_onyx: 6,
  am_santa: 6,
  bf_emma: 3,
  bf_alice: 3,
  bf_isabella: 5,
  bf_lily: 5,
  bm_george: 4,
  bm_daniel: 4,
  bm_lewis: 6,
  bm_fable: 6,
};

export function sherpaKittenVoiceSid(voice: string | undefined | null): number {
  if (!voice) return 1;
  if (voice in KITTEN_SID_BY_KOKORO_ID) return KITTEN_SID_BY_KOKORO_ID[voice]!;
  const mapped = mapVoiceToSherpaId(voice);
  return KITTEN_SID_BY_KOKORO_ID[mapped] ?? 1;
}

export const SHERPA_KITTEN_VOICES: readonly (KokoroVoiceMeta & { sid: number })[] = [
  { id: 'af_bella', name: 'Bella', lang: 'en-US', sid: 1 },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-US', sid: 3 },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-US', sid: 5 },
  { id: 'af_sky', name: 'Sky', lang: 'en-US', sid: 7 },
  { id: 'am_adam', name: 'Adam', lang: 'en-US', sid: 0 },
  { id: 'am_michael', name: 'Michael', lang: 'en-US', sid: 2 },
  { id: 'bm_george', name: 'George', lang: 'en-GB', sid: 4 },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-GB', sid: 6 },
];

export const PIPER_AMY_VOICES: readonly KokoroVoiceMeta[] = [
  { id: 'amy', name: 'Amy', lang: 'en-US' },
];

export const PIPER_LESSAC_VOICES: readonly KokoroVoiceMeta[] = [
  { id: 'lessac', name: 'Lessac', lang: 'en-US' },
];

/** Supertonic 3 built-in styles (sid 0–9). https://huggingface.co/Supertone/supertonic-3 */
export const SUPERTONIC_VOICES: readonly (KokoroVoiceMeta & { sid: number })[] = [
  { id: 'M1', name: 'M1', lang: 'en', sid: 0 },
  { id: 'M2', name: 'M2', lang: 'en', sid: 1 },
  { id: 'M3', name: 'M3', lang: 'en', sid: 2 },
  { id: 'M4', name: 'M4', lang: 'en', sid: 3 },
  { id: 'M5', name: 'M5', lang: 'en', sid: 4 },
  { id: 'F1', name: 'F1', lang: 'en', sid: 5 },
  { id: 'F2', name: 'F2', lang: 'en', sid: 6 },
  { id: 'F3', name: 'F3', lang: 'en', sid: 7 },
  { id: 'F4', name: 'F4', lang: 'en', sid: 8 },
  { id: 'F5', name: 'F5', lang: 'en', sid: 9 },
];

export function sherpaSupertonicVoiceSid(voice: string | undefined | null): number {
  if (!voice) return 5;
  const exact = SUPERTONIC_VOICES.find((v) => v.id === voice);
  if (exact) return exact.sid;
  const lower = voice.toLowerCase();
  const fuzzy = SUPERTONIC_VOICES.find((v) => v.id.toLowerCase() === lower);
  return fuzzy?.sid ?? 5;
}

export function voicesForOnDeviceModel(id: string): KokoroVoiceMeta[] {
  if (id === 'piper-amy-low') return [...PIPER_AMY_VOICES];
  if (id === 'piper-lessac-medium') return [...PIPER_LESSAC_VOICES];
  if (id === 'supertonic-3') return SUPERTONIC_VOICES.map(({ sid: _sid, ...v }) => v);
  if (
    id === 'kitten-nano' ||
    id === 'kitten-mini' ||
    id === 'tiny' ||
    id === 'small' ||
    id === 'large'
  ) {
    return SHERPA_KITTEN_VOICES.map(({ sid: _sid, ...v }) => v);
  }
  return SHERPA_KOKORO_EN_VOICES.map(({ sid: _sid, ...v }) => v);
}
