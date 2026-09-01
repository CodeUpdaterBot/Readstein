/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import {
  SUPERTONIC_ASSETS,
  SUPERTONIC_CACHE,
  isSupertonicVoiceId,
  supertonicAssetUrl,
} from './assets';
import { createTextToSpeech, encodeWav, loadVoiceStyle, type Style, type TextToSpeech } from './helper';
import type { SupertonicWorkerRequest, SupertonicWorkerResponse } from './protocol';

let tts: TextToSpeech | null = null;
let device: 'webgpu' | 'wasm' = 'wasm';
const styles = new Map<string, Style>();
const blobUrls: string[] = [];

const post = (msg: SupertonicWorkerResponse, transfer?: Transferable[]) => {
  self.postMessage(msg, transfer ?? []);
};

const cachePut = async (cache: Cache, url: string, body: ArrayBuffer, type: string) => {
  await cache.put(
    url,
    new Response(body, {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000' },
    }),
  );
};

const downloadAssets = async (id: number): Promise<Record<string, string>> => {
  const cache = await caches.open(SUPERTONIC_CACHE);
  const total = SUPERTONIC_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
  let loaded = 0;
  const urls: Record<string, string> = {};

  for (const asset of SUPERTONIC_ASSETS) {
    const remote = supertonicAssetUrl(asset.path);
    let blob: Blob | null = null;
    const hit = await cache.match(remote);
    if (hit) {
      blob = await hit.blob();
      loaded += asset.bytes;
      post({ id, type: 'progress', loaded: Math.min(loaded, total), total });
    } else {
      const response = await fetch(remote);
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${asset.path}`);
      const reader = response.body?.getReader();
      if (!reader) {
        const buffer = await response.arrayBuffer();
        await cachePut(cache, remote, buffer, response.headers.get('Content-Type') || 'application/octet-stream');
        blob = new Blob([buffer]);
        loaded += asset.bytes;
        post({ id, type: 'progress', loaded: Math.min(loaded, total), total });
      } else {
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          post({
            id,
            type: 'progress',
            loaded: Math.min(loaded + received, total),
            total,
          });
        }
        const buffer = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        await cachePut(
          cache,
          remote,
          buffer.buffer,
          response.headers.get('Content-Type') || 'application/octet-stream',
        );
        blob = new Blob([buffer]);
        loaded += asset.bytes;
      }
    }
    const objectUrl = URL.createObjectURL(blob);
    blobUrls.push(objectUrl);
    urls[asset.key] = objectUrl;
  }
  return urls;
};

const createSessions = async (urls: Record<string, string>): Promise<TextToSpeech> => {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
  ort.env.wasm.numThreads = 4;
  const wasmOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  };
  try {
    const webgpu = await createTextToSpeech(
      {
        durationPredictor: urls['duration_predictor.onnx']!,
        textEncoder: urls['text_encoder.onnx']!,
        vectorEstimator: urls['vector_estimator.onnx']!,
        vocoder: urls['vocoder.onnx']!,
        ttsJson: urls['tts.json']!,
        unicodeIndexer: urls['unicode_indexer.json']!,
      },
      { ...wasmOptions, executionProviders: ['webgpu'] },
    );
    device = 'webgpu';
    return webgpu;
  } catch (err) {
    console.warn('[Supertonic] WebGPU session failed, using WASM', err);
    device = 'wasm';
    return createTextToSpeech(
      {
        durationPredictor: urls['duration_predictor.onnx']!,
        textEncoder: urls['text_encoder.onnx']!,
        vectorEstimator: urls['vector_estimator.onnx']!,
        vocoder: urls['vocoder.onnx']!,
        ttsJson: urls['tts.json']!,
        unicodeIndexer: urls['unicode_indexer.json']!,
      },
      wasmOptions,
    );
  }
};

const styleFor = async (voice: string, urls: Record<string, string>): Promise<Style> => {
  const id = isSupertonicVoiceId(voice) ? voice : 'F1';
  const cached = styles.get(id);
  if (cached) return cached;
  const href = urls[`${id}.json`];
  if (!href) throw new Error(`Missing Supertonic voice style ${id}`);
  const json = await fetch(href).then((res) => res.json());
  const style = await loadVoiceStyle(json);
  styles.set(id, style);
  return style;
};

let assetUrls: Record<string, string> | null = null;

self.onmessage = async (event: MessageEvent<SupertonicWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      assetUrls = await downloadAssets(msg.id);
      tts = await createSessions(assetUrls);
      post({ id: msg.id, type: 'ready', device });
      return;
    }
    if (msg.type === 'synthesize') {
      if (!tts || !assetUrls) throw new Error('Supertonic is not loaded');
      const style = await styleFor(msg.voice, assetUrls);
      const { wav, durationSec } = await tts.synthesize(msg.text, msg.lang || 'en', style, 8, 1.05);
      const encoded = encodeWav(wav, tts.sampleRate);
      post(
        {
          id: msg.id,
          type: 'audio',
          wav: encoded,
          sampleRate: tts.sampleRate,
          durationSec,
        },
        [encoded],
      );
      return;
    }
    if (msg.type === 'shutdown') {
      tts = null;
      styles.clear();
      for (const url of blobUrls) URL.revokeObjectURL(url);
      blobUrls.length = 0;
      assetUrls = null;
      post({ id: msg.id, type: 'shutdown-ok' });
    }
  } catch (err) {
    post({
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
