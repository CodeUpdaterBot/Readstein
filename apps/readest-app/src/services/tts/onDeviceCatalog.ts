import type { TTSModelSize } from './types';
import { isAndroidSherpaPlatform } from './kokoro/sherpaPlatform';
import { isKokoroLanguageSupported, SUPERTONIC_LANGS } from './kokoro/protocol';

export type OnDeviceEngine = 'piper' | 'kitten' | 'supertonic' | 'kokoro';

export type OnDevicePlatform = 'android' | 'desktop';

export type OnDeviceModel = {
  id: TTSModelSize;
  engine: OnDeviceEngine;
  /** Short name in the picker, e.g. "Amy Low". */
  name: string;
  /** Group header. */
  engineLabel: string;
  /** Approximate parameter count in millions (sort key). */
  paramsM: number;
  /** Approximate first-download size in MB (Android sherpa package). */
  sizeMB: number;
  /** Desktop download when it uses a different package (official HF ONNX). */
  desktopSizeMB?: number;
  sampleRateHz: number;
  quality?: 'x_low' | 'low' | 'medium' | 'high';
  platforms: readonly OnDevicePlatform[];
};

export type ModelTier = 'tiny' | 'small' | 'medium' | 'large';

/**
 * On-device packages the picker can load.
 *
 * Android uses sherpa-onnx (Kitten / Piper VITS / Supertonic). Desktop keeps
 * Kokoro WASM/WebGPU and runs official Supertonic ONNX in a worker.
 * https://github.com/OHF-Voice/piper1-gpl
 * https://github.com/supertone-inc/supertonic
 */
export const ON_DEVICE_MODELS: readonly OnDeviceModel[] = [
  {
    id: 'piper-amy-low',
    engine: 'piper',
    name: 'Amy Low',
    engineLabel: 'Piper',
    paramsM: 18,
    sizeMB: 20,
    sampleRateHz: 16000,
    quality: 'low',
    platforms: ['android'],
  },
  {
    id: 'kitten-nano',
    engine: 'kitten',
    name: 'Nano',
    engineLabel: 'Kitten',
    paramsM: 15,
    sizeMB: 25,
    sampleRateHz: 24000,
    platforms: ['android'],
  },
  {
    id: 'piper-lessac-medium',
    engine: 'piper',
    name: 'Lessac Medium',
    engineLabel: 'Piper',
    paramsM: 18,
    sizeMB: 20,
    sampleRateHz: 22050,
    quality: 'medium',
    platforms: ['android'],
  },
  {
    id: 'kitten-mini',
    engine: 'kitten',
    name: 'Mini',
    engineLabel: 'Kitten',
    paramsM: 80,
    sizeMB: 50,
    sampleRateHz: 24000,
    platforms: ['android'],
  },
  {
    id: 'kokoro-tiny',
    engine: 'kokoro',
    name: 'Tiny q4',
    engineLabel: 'Kokoro',
    paramsM: 82,
    sizeMB: 40,
    sampleRateHz: 24000,
    platforms: ['desktop'],
  },
  {
    id: 'kokoro-small',
    engine: 'kokoro',
    name: 'Small q8',
    engineLabel: 'Kokoro',
    paramsM: 82,
    sizeMB: 86,
    sampleRateHz: 24000,
    platforms: ['desktop'],
  },
  {
    id: 'kokoro-large',
    engine: 'kokoro',
    name: 'Large fp16',
    engineLabel: 'Kokoro',
    paramsM: 82,
    sizeMB: 170,
    sampleRateHz: 24000,
    platforms: ['desktop'],
  },
  {
    id: 'supertonic-3',
    engine: 'supertonic',
    name: '3',
    engineLabel: 'Supertonic',
    paramsM: 99,
    sizeMB: 123,
    desktopSizeMB: 400,
    sampleRateHz: 44100,
    platforms: ['android', 'desktop'],
  },
];

const LEGACY_ANDROID: Record<'tiny' | 'small' | 'large', TTSModelSize> = {
  tiny: 'kitten-nano',
  small: 'kitten-mini',
  large: 'kitten-mini',
};

const LEGACY_DESKTOP: Record<'tiny' | 'small' | 'large', TTSModelSize> = {
  tiny: 'kokoro-tiny',
  small: 'kokoro-small',
  large: 'kokoro-large',
};

export function currentOnDevicePlatform(): OnDevicePlatform {
  return isAndroidSherpaPlatform() ? 'android' : 'desktop';
}

export function isOnDeviceModelId(value: unknown): value is TTSModelSize {
  if (typeof value !== 'string') return false;
  if (value === 'tiny' || value === 'small' || value === 'large') return true;
  return ON_DEVICE_MODELS.some((model) => model.id === value);
}

/** Map persisted tiny/small/large (and unknown ids) onto a catalog entry. */
export function resolveOnDeviceModel(
  id: string | undefined | null,
  platform: OnDevicePlatform = currentOnDevicePlatform(),
): OnDeviceModel {
  const raw = id ?? 'small';
  const migrated =
    raw === 'tiny' || raw === 'small' || raw === 'large'
      ? platform === 'android'
        ? LEGACY_ANDROID[raw]
        : LEGACY_DESKTOP[raw]
      : raw;
  const found = ON_DEVICE_MODELS.find((model) => model.id === migrated);
  if (found && found.platforms.includes(platform)) return found;
  const fallbackId = platform === 'android' ? 'kitten-nano' : 'kokoro-small';
  return ON_DEVICE_MODELS.find((model) => model.id === fallbackId)!;
}

export function modelsForPlatform(
  platform: OnDevicePlatform = currentOnDevicePlatform(),
): OnDeviceModel[] {
  return ON_DEVICE_MODELS.filter((model) => model.platforms.includes(platform)).sort(
    (a, b) => a.paramsM - b.paramsM || a.sizeMB - b.sizeMB || a.name.localeCompare(b.name),
  );
}

export function modelsGroupedByEngine(
  platform: OnDevicePlatform = currentOnDevicePlatform(),
): { engine: OnDeviceEngine; engineLabel: string; models: OnDeviceModel[] }[] {
  const models = modelsForPlatform(platform);
  const order: OnDeviceEngine[] = ['piper', 'kitten', 'kokoro', 'supertonic'];
  return order
    .map((engine) => {
      const group = models.filter((model) => model.engine === engine);
      return {
        engine,
        engineLabel: group[0]?.engineLabel ?? engine,
        models: group,
      };
    })
    .filter((group) => group.models.length > 0);
}

export function formatModelCaption(model: OnDeviceModel): string {
  return `${model.engineLabel} ${model.name}`;
}

/** Tiny → Large label from quality tier, then parameter count. */
export function modelTier(model: OnDeviceModel): ModelTier {
  if (model.quality === 'x_low' || model.quality === 'low') return 'tiny';
  if (model.quality === 'medium') return 'small';
  if (model.quality === 'high') return 'medium';
  if (model.engine === 'kitten' && model.id === 'kitten-nano') return 'tiny';
  if (model.engine === 'kitten') return 'medium';
  if (model.engine === 'kokoro') {
    if (model.id === 'kokoro-tiny') return 'small';
    if (model.id === 'kokoro-large') return 'large';
    return 'medium';
  }
  if (model.engine === 'supertonic') return 'large';
  if (model.paramsM < 20) return 'tiny';
  if (model.paramsM < 40) return 'small';
  if (model.paramsM < 90) return 'medium';
  return 'large';
}

export function formatModelTierLabel(model: OnDeviceModel): string {
  const tier = modelTier(model);
  if (tier === 'tiny') return 'Tiny';
  if (tier === 'small') return 'Small';
  if (tier === 'medium') return 'Medium';
  return 'Large';
}

export function formatPickerLabel(model: OnDeviceModel): string {
  return `${formatModelCaption(model)} · ${formatModelTierLabel(model)} · ${model.paramsM}M`;
}

export function downloadSizeMB(
  model: OnDeviceModel,
  platform: OnDevicePlatform = currentOnDevicePlatform(),
): number {
  return platform === 'desktop' && model.desktopSizeMB ? model.desktopSizeMB : model.sizeMB;
}

export function formatModelDetail(
  model: OnDeviceModel,
  platform: OnDevicePlatform = currentOnDevicePlatform(),
): string {
  const quality = model.quality ? ` · ${model.quality}` : '';
  const rate =
    model.sampleRateHz >= 1000
      ? `${(model.sampleRateHz / 1000).toFixed(model.sampleRateHz % 1000 === 0 ? 0 : 2)} kHz`
      : `${model.sampleRateHz} Hz`;
  return `${model.paramsM}M params${quality} · ${rate} · ~${downloadSizeMB(model, platform)} MB`;
}

export function isKokoroDesktopModel(id: TTSModelSize): boolean {
  return id === 'tiny' || id === 'small' || id === 'large' || id.startsWith('kokoro-');
}

export function modelById(id: string | undefined | null): OnDeviceModel | undefined {
  if (!id || id === 'tiny' || id === 'small' || id === 'large') return undefined;
  return ON_DEVICE_MODELS.find((model) => model.id === id);
}

export function isOnDeviceLanguageSupported(
  id: string | undefined | null,
  lang: string | undefined | null,
): boolean {
  const model = modelById(id) ?? resolveOnDeviceModel(id);
  if (model.engine === 'supertonic') {
    if (!lang) return true;
    const base = lang.toLowerCase().split(/[-_]/)[0] ?? 'en';
    return (SUPERTONIC_LANGS as readonly string[]).includes(base);
  }
  return isKokoroLanguageSupported(lang);
}

export function kokoroDtypeSize(id: TTSModelSize): 'tiny' | 'small' | 'large' {
  if (id === 'kokoro-tiny' || id === 'tiny') return 'tiny';
  if (id === 'kokoro-large' || id === 'large') return 'large';
  return 'small';
}
