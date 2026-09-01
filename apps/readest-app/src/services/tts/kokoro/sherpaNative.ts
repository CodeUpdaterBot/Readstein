import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import type { TTSModelSize } from '../types';
import { sherpaModelSpec } from './sherpaModels';

const SHERPA_READY_KEY = 'kokoroSherpaModelSizes';

export type SherpaStatus = {
  ready: boolean;
  loaded: boolean;
};

export type SherpaAudio = {
  wavBase64: string;
  sampleRate: number;
  durationSec: number;
};

export { isAndroidSherpaPlatform } from './sherpaPlatform';

const readReadySizes = (): string[] => {
  try {
    const raw = localStorage.getItem(SHERPA_READY_KEY);
    if (!raw) {
      // Legacy single-model flag from the first Android Kokoro build.
      // First Android build only shipped Kokoro; that cache is unused now.
      return [];
    }
    const parsed = JSON.parse(raw) as { readySizes?: string[] };
    return Array.isArray(parsed.readySizes) ? parsed.readySizes : [];
  } catch {
    return [];
  }
};

const legacyReadyAliases = (id: string): string[] => {
  if (id === 'kitten-nano') return ['tiny'];
  if (id === 'kitten-mini') return ['small', 'large'];
  return [];
};

export function wasSherpaMarkedReady(size?: TTSModelSize): boolean {
  const spec = sherpaModelSpec(size);
  const ready = readReadySizes();
  if (ready.includes(spec.id)) return true;
  return legacyReadyAliases(spec.id).some((alias) => ready.includes(alias));
}

export function markSherpaReady(size?: TTSModelSize) {
  try {
    const spec = sherpaModelSpec(size);
    const readySizes = readReadySizes();
    if (!readySizes.includes(spec.id)) readySizes.push(spec.id);
    localStorage.setItem(SHERPA_READY_KEY, JSON.stringify({ readySizes }));
  } catch {
    /* ignore */
  }
}

export async function sherpaStatus(size?: TTSModelSize): Promise<SherpaStatus> {
  return invoke<SherpaStatus>('plugin:native-tts|sherpa_status', {
    payload: { size: sherpaModelSpec(size).id },
  });
}

export async function sherpaEnsureModel(
  size?: TTSModelSize,
  onProgress?: (progress: number) => void,
): Promise<SherpaStatus> {
  let listener: PluginListener | null = null;
  if (onProgress) {
    listener = await addPluginListener<{ progress: number }>(
      'native-tts',
      'sherpa_progress',
      (event) => {
        if (typeof event.progress === 'number') onProgress(event.progress);
      },
    );
  }
  try {
    const spec = sherpaModelSpec(size);
    const status = await invoke<SherpaStatus>('plugin:native-tts|sherpa_ensure_model', {
      payload: { size: spec.id },
    });
    if (status.ready) markSherpaReady(spec.id);
    return status;
  } finally {
    await listener?.unregister();
  }
}

export async function sherpaSynthesize(
  text: string,
  voice: string,
  size?: TTSModelSize,
  lang?: string,
): Promise<SherpaAudio> {
  return invoke<SherpaAudio>('plugin:native-tts|sherpa_synthesize', {
    payload: { text, voice, size: sherpaModelSpec(size).id, lang },
  });
}

export function decodeWavBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
