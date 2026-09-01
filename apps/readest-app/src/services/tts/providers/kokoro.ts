// On-device speech as a SpeechProvider.
// Desktop/web: Kokoro WASM/WebGPU, or official Supertonic ONNX in a worker.
// Android: sherpa-onnx — Piper, Kitten, and Supertonic. No Kokoro on phone.

import type { TTSWordBoundary } from '@/libs/edgeTTS';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';
import { estimateWordBoundaries } from '../kokoro/estimateBoundaries';
import { kokoroModelStore } from '../kokoro/modelStore';
import { KOKORO_DEFAULT_VOICE, KOKORO_VOICES, onDeviceLangCode } from '../kokoro/protocol';
import { isAndroidSherpaPlatform } from '../kokoro/sherpaPlatform';
import {
  PIPER_AMY_VOICES,
  PIPER_LESSAC_VOICES,
  SHERPA_KOKORO_DEFAULT_VOICE,
  SUPERTONIC_VOICES,
  mapVoiceToSherpaId,
  voicesForOnDeviceModel,
} from '../kokoro/sherpaVoices';
import { isOnDeviceLanguageSupported, resolveOnDeviceModel } from '../onDeviceCatalog';
import { SHERPA_MAX_CHARS, splitKokoroUtterances } from '../kokoro/splitUtterances';

const fallbackVoiceFor = (id: string | undefined): string => {
  const model = resolveOnDeviceModel(id);
  if (model.engine === 'supertonic') return 'F1';
  if (model.id === 'piper-lessac-medium') return PIPER_LESSAC_VOICES[0]!.id;
  if (model.engine === 'piper') return PIPER_AMY_VOICES[0]!.id;
  if (isAndroidSherpaPlatform()) return SHERPA_KOKORO_DEFAULT_VOICE;
  return KOKORO_DEFAULT_VOICE;
};

const resolveVoice = (requested: string | undefined): string => {
  const model = resolveOnDeviceModel(kokoroModelStore.getState().size);
  if (model.engine === 'supertonic') {
    return SUPERTONIC_VOICES.some((voice) => voice.id === requested) ? requested! : 'F1';
  }
  if (model.engine === 'piper') {
    return fallbackVoiceFor(model.id);
  }
  if (isAndroidSherpaPlatform()) return mapVoiceToSherpaId(requested);
  return requested || KOKORO_DEFAULT_VOICE;
};

export class KokoroSpeechProvider implements SpeechProvider {
  readonly id = 'kokoro-tts';
  readonly label = 'On-device';
  get fallbackVoiceId() {
    return fallbackVoiceFor(kokoroModelStore.getState().size);
  }
  readonly cacheable = true;
  get synthesisLookahead() {
    return isAndroidSherpaPlatform() ? 2 : 1;
  }

  splitUtterance(text: string): string[] {
    return splitKokoroUtterances(text, isAndroidSherpaPlatform() ? SHERPA_MAX_CHARS : undefined);
  }

  async init(): Promise<boolean> {
    if (typeof Worker === 'undefined' && !isAndroidSherpaPlatform()) return false;
    if (!kokoroModelStore.isModelDownloaded()) return false;
    return kokoroModelStore.ensureLoaded();
  }

  /** Force-load even if not previously downloaded (user opted into On-device). */
  async initForce(): Promise<boolean> {
    if (typeof Worker === 'undefined' && !isAndroidSherpaPlatform()) return false;
    return kokoroModelStore.ensureLoaded();
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    const model = resolveOnDeviceModel(kokoroModelStore.getState().size);
    if (model.engine === 'supertonic' || isAndroidSherpaPlatform()) {
      return voicesForOnDeviceModel(model.id).map((voice) => ({
        id: voice.id,
        name: voice.name,
        lang: voice.lang,
      }));
    }
    return KOKORO_VOICES.map((voice) => ({ id: voice.id, name: voice.name, lang: voice.lang }));
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    const preferred = fallbackVoiceFor(kokoroModelStore.getState().size);
    return voices.find((voice) => voice.id === preferred)?.id ?? voices[0]?.id;
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const model = resolveOnDeviceModel(kokoroModelStore.getState().size);
    if (!isOnDeviceLanguageSupported(model.id, req.lang)) {
      throw new SpeechSynthesisPermanentError(
        `${model.engineLabel} does not support language: ${req.lang}`,
      );
    }
    const text = req.text.trim();
    if (!text) {
      throw new SpeechSynthesisPermanentError('Empty text');
    }
    try {
      const voice = resolveVoice(req.voice);
      const lang = onDeviceLangCode(req.lang);
      const { wav, durationSec } = await kokoroModelStore.synthesize(text, voice, signal, lang);
      const boundaries: TTSWordBoundary[] = estimateWordBoundaries(text, durationSec);
      return { audio: wav, boundaries };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof SpeechSynthesisPermanentError) throw err;
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    // Keep the worker warm across sessions; modelStore owns lifecycle.
  }
}
