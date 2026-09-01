import type { TTSModelSize } from '../types';
import { resolveOnDeviceModel, type OnDeviceEngine } from '../onDeviceCatalog';

export type SherpaFamily = 'kitten' | 'vits' | 'supertonic';

export type SherpaModelSpec = {
  id: TTSModelSize;
  family: SherpaFamily;
  dir: string;
  archive: string;
  url: string;
  /** Relative paths that must exist after extract. */
  requiredFiles: string[];
  sizeMB: number;
};

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

const SPECS: Partial<Record<TTSModelSize, SherpaModelSpec>> = {
  'kitten-nano': {
    id: 'kitten-nano',
    family: 'kitten',
    dir: 'kitten-nano-en-v0_1-fp16',
    archive: 'kitten-nano-en-v0_1-fp16.tar.bz2',
    url: `${RELEASE}/kitten-nano-en-v0_1-fp16.tar.bz2`,
    requiredFiles: ['model.fp16.onnx', 'voices.bin', 'tokens.txt'],
    sizeMB: 25,
  },
  'kitten-mini': {
    id: 'kitten-mini',
    family: 'kitten',
    dir: 'kitten-mini-en-v0_1-fp16',
    archive: 'kitten-mini-en-v0_1-fp16.tar.bz2',
    url: `${RELEASE}/kitten-mini-en-v0_1-fp16.tar.bz2`,
    requiredFiles: ['model.fp16.onnx', 'voices.bin', 'tokens.txt'],
    sizeMB: 50,
  },
  'piper-amy-low': {
    id: 'piper-amy-low',
    family: 'vits',
    dir: 'vits-piper-en_US-amy-low-int8',
    archive: 'vits-piper-en_US-amy-low-int8.tar.bz2',
    url: `${RELEASE}/vits-piper-en_US-amy-low-int8.tar.bz2`,
    requiredFiles: ['en_US-amy-low.int8.onnx', 'tokens.txt'],
    sizeMB: 20,
  },
  'piper-lessac-medium': {
    id: 'piper-lessac-medium',
    family: 'vits',
    dir: 'vits-piper-en_US-lessac-medium-int8',
    archive: 'vits-piper-en_US-lessac-medium-int8.tar.bz2',
    url: `${RELEASE}/vits-piper-en_US-lessac-medium-int8.tar.bz2`,
    requiredFiles: ['en_US-lessac-medium.int8.onnx', 'tokens.txt'],
    sizeMB: 20,
  },
  'supertonic-3': {
    id: 'supertonic-3',
    family: 'supertonic',
    dir: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11',
    archive: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2',
    url: `${RELEASE}/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2`,
    requiredFiles: [
      'duration_predictor.int8.onnx',
      'text_encoder.int8.onnx',
      'vector_estimator.int8.onnx',
      'vocoder.int8.onnx',
      'tts.json',
      'unicode_indexer.bin',
      'voice.bin',
    ],
    sizeMB: 123,
  },
};

export function sherpaModelSpec(size: TTSModelSize | string | undefined | null): SherpaModelSpec {
  const resolved = resolveOnDeviceModel(size, 'android');
  return SPECS[resolved.id] ?? SPECS['kitten-nano']!;
}

export function sherpaFamily(size: TTSModelSize | string | undefined | null): SherpaFamily {
  return sherpaModelSpec(size).family;
}

export function catalogEngineToSherpaFamily(engine: OnDeviceEngine): SherpaFamily | null {
  if (engine === 'kitten') return 'kitten';
  if (engine === 'piper') return 'vits';
  if (engine === 'supertonic') return 'supertonic';
  return null;
}
