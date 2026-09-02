/// <reference lib="webworker" />

import type { KokoroDtype, KokoroWorkerRequest, KokoroWorkerResponse } from './protocol';
import { KOKORO_DEFAULT_VOICE, KOKORO_MODEL_ID } from './protocol';
import { buildLoadAttempts, navigatorGpu, snapshotGpuAdapter } from './discoverGpu';
import { assertAudiblePcm } from './pcmQuality';

type KokoroTTSInstance = {
  generate: (
    text: string,
    opts: { voice: string; speed?: number },
  ) => Promise<{
    toWav?: () => ArrayBuffer;
    audio?: Float32Array;
    sampling_rate?: number;
    data?: Float32Array;
  }>;
  list_voices?: () => Record<string, unknown>;
};

let tts: KokoroTTSInstance | null = null;

const post = (msg: KokoroWorkerResponse, transfer?: Transferable[]) => {
  self.postMessage(msg, transfer ?? []);
};

/** Encode mono Float32 PCM as a 16-bit WAV ArrayBuffer. */
const encodeWav = (samples: Float32Array, sampleRate: number): ArrayBuffer => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
};

const toWavBuffer = (
  audio: Awaited<ReturnType<KokoroTTSInstance['generate']>>,
  label: string,
): { wav: ArrayBuffer; sampleRate: number; durationSec: number } => {
  const sampleRate = audio.sampling_rate ?? 24000;
  const src = audio.audio ?? audio.data;
  if (!src || src.length < 16) {
    throw new Error(`${label} returned no audio samples`);
  }
  // Copy immediately: WebGPU/WASM heap views can be overwritten or filled
  // with NaN after generate() returns.
  const pcm = new Float32Array(src);
  const peak = assertAudiblePcm(pcm, label);
  console.info(
    `[Kokoro] ${label} peak=${peak.toFixed(3)} dur=${(pcm.length / sampleRate).toFixed(2)}s`,
  );
  const wav = encodeWav(pcm, sampleRate);
  return { wav, sampleRate, durationSec: pcm.length / sampleRate };
};

const loadOne = async (
  dtype: KokoroDtype,
  device: 'webgpu' | 'wasm',
  requestId: number,
): Promise<KokoroTTSInstance> => {
  const { KokoroTTS } = await import('kokoro-js');
  const instance = (await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
    dtype,
    device,
    progress_callback: (data: { loaded?: number; total?: number; status?: string }) => {
      if (typeof data?.loaded === 'number' && typeof data?.total === 'number') {
        post({
          id: requestId,
          type: 'progress',
          loaded: data.loaded,
          total: data.total || 1,
        });
      }
    },
  })) as unknown as KokoroTTSInstance;
  const probe = await instance.generate('The quick brown fox jumps over the lazy dog.', {
    voice: KOKORO_DEFAULT_VOICE,
    speed: 1.0,
  });
  toWavBuffer(probe, `${device}/${dtype} probe`);
  return instance;
};

const initModel = async (msg: Extract<KokoroWorkerRequest, { type: 'init' }>) => {
  const gpu = await snapshotGpuAdapter(navigatorGpu());
  post({
    id: msg.id,
    type: 'device-info',
    available: gpu.available,
    adapterName: gpu.name || undefined,
    reason: gpu.reason,
  });
  console.info('[Kokoro] GPU probe', gpu);

  const attempts = buildLoadAttempts(msg.size, gpu);
  let lastError: unknown;
  for (const attempt of attempts) {
    tts = null;
    try {
      console.info(`[Kokoro] loading ${attempt.device}/${attempt.dtype}`);
      tts = await loadOne(attempt.dtype, attempt.device, msg.id);
      console.info(
        `[Kokoro] ready ${attempt.device}/${attempt.dtype}` + (gpu.name ? ` (${gpu.name})` : ''),
      );
      post({
        id: msg.id,
        type: 'ready',
        device: attempt.device,
        dtype: attempt.dtype,
        adapterName: attempt.device === 'webgpu' ? gpu.name : undefined,
      });
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[Kokoro] ${attempt.device}/${attempt.dtype} failed, trying next`, err);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Kokoro failed to load on WebGPU and WASM');
};

const handleMessage = async (msg: KokoroWorkerRequest) => {
  try {
    if (msg.type === 'init') {
      await initModel(msg);
      return;
    }

    if (msg.type === 'synthesize') {
      if (!tts) throw new Error('Kokoro not initialized');
      // Rate pinned to 1.0 — WSOLA / native playout apply playback speed.
      const audio = await tts.generate(msg.text, { voice: msg.voice, speed: 1.0 });
      const { wav, sampleRate, durationSec } = toWavBuffer(audio, 'synthesize');
      post({ id: msg.id, type: 'audio', wav, sampleRate, durationSec }, [wav]);
      return;
    }

    if (msg.type === 'shutdown') {
      tts = null;
      post({ id: msg.id, type: 'shutdown-ok' });
      return;
    }
  } catch (err) {
    post({
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

// onnxruntime-wasm is single-threaded; overlapping generate() calls stall or
// corrupt the session. Process RPC messages strictly one at a time.
let messageChain: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<KokoroWorkerRequest>) => {
  const msg = event.data;
  messageChain = messageChain.then(() => handleMessage(msg)).catch(() => undefined);
};
