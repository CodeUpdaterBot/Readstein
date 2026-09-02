import type { TTSModelSize } from '../types';
import {
  downloadSizeMB,
  isOnDeviceModelId,
  kokoroDtypeSize,
  resolveOnDeviceModel,
} from '../onDeviceCatalog';
import type { SupertonicWorkerBody, SupertonicWorkerResponse } from '../supertonic/protocol';
import {
  KOKORO_MODEL_ID,
  MODEL_SIZE_TO_DTYPE,
  type KokoroDtype,
  type KokoroWorkerRequest,
  type KokoroWorkerResponse,
} from './protocol';
import { isAndroidSherpaPlatform } from './sherpaPlatform';
import { sherpaModelSpec } from './sherpaModels';
import {
  markSherpaReady,
  sherpaEnsureModel,
  sherpaStatus,
  sherpaSynthesize,
  decodeWavBase64,
  wasSherpaMarkedReady,
} from './sherpaNative';

const STORAGE_KEY = 'kokoroTTSModel';
const DISMISS_BANNER_KEY = 'kokoroTTSBannerDismissed';

export type KokoroModelStatus =
  | 'idle'
  | 'loading'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'unavailable';

export type KokoroModelState = {
  status: KokoroModelStatus;
  size: TTSModelSize;
  progress: number; // 0..1
  error?: string;
  /** True once from_pretrained finished for the current size. */
  loaded: boolean;
  /** Where inference actually runs after init. */
  device: 'webgpu' | 'wasm' | null;
  /** GPU adapter label when device is webgpu (e.g. NVIDIA GeForce RTX 3080). */
  adapterName?: string;
  loadedDtype?: KokoroDtype;
  gpuAvailable?: boolean;
  gpuReason?: string;
};

type Listener = (state: KokoroModelState) => void;

type Pending<T> = {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  onProgress?: (loaded: number, total: number) => void;
};

const DEFAULT_STATE: KokoroModelState = {
  status: 'idle',
  size: 'small',
  progress: 0,
  loaded: false,
  device: null,
};

const readStoredSize = (): TTSModelSize => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'small';
    const parsed = JSON.parse(raw) as { size?: TTSModelSize; ready?: boolean };
    if (isOnDeviceModelId(parsed.size)) return parsed.size;
  } catch {
    /* ignore */
  }
  return 'small';
};

const kokoroReadyKeys = (size: TTSModelSize): string[] => {
  const dtype = kokoroDtypeSize(size);
  return Array.from(new Set([size, dtype, `kokoro-${dtype}`]));
};

const wasMarkedReady = (...sizes: string[]): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { size?: TTSModelSize; readySizes?: string[] };
    if (!Array.isArray(parsed.readySizes)) return false;
    return sizes.some((size) => parsed.readySizes!.includes(size));
  } catch {
    return false;
  }
};

const markReady = (size: TTSModelSize) => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const readySizes = Array.isArray(parsed['readySizes'])
      ? (parsed['readySizes'] as string[])
      : [];
    if (!readySizes.includes(size)) readySizes.push(size);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, size, readySizes }));
  } catch {
    /* ignore */
  }
};

const desktopReady = (size: TTSModelSize): boolean => {
  const resolved = resolveOnDeviceModel(size, 'desktop');
  if (resolved.engine === 'supertonic') return wasMarkedReady('supertonic-3');
  return wasMarkedReady(...kokoroReadyKeys(resolved.id));
};

const persistSize = (size: TTSModelSize) => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, size }));
  } catch {
    /* ignore */
  }
};

/**
 * Singleton that owns the Kokoro web worker, download progress, and model-size
 * preference. Speakers go through KokoroSpeechProvider → this store.
 */
class KokoroModelStore {
  #state: KokoroModelState = {
    ...DEFAULT_STATE,
    size: typeof window !== 'undefined' ? readStoredSize() : 'small',
    status: 'idle',
  };
  #listeners = new Set<Listener>();
  #worker: Worker | null = null;
  #supertonicWorker: Worker | null = null;
  #reqId = 0;
  #pending = new Map<number, Pending<KokoroWorkerResponse>>();
  #supertonicPending = new Map<number, Pending<SupertonicWorkerResponse>>();
  #initPromise: Promise<boolean> | null = null;
  // One generate at a time: the worker cannot run two Kokoro inferences.
  #synthMutex: Promise<void> = Promise.resolve();

  getState(): KokoroModelState {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) listener(this.#state);
  }

  #set(partial: Partial<KokoroModelState>) {
    this.#state = { ...this.#state, ...partial };
    this.#emit();
  }

  getDtype(): KokoroDtype {
    return MODEL_SIZE_TO_DTYPE[kokoroDtypeSize(this.#state.size)];
  }

  getApproxSizeMB(): number {
    const model = resolveOnDeviceModel(this.#state.size);
    return downloadSizeMB(model);
  }

  /** Whether a previous download finished for the current size (cache warm). */
  isModelDownloaded(): boolean {
    if (isAndroidSherpaPlatform()) {
      return wasSherpaMarkedReady(this.#state.size) || this.#state.loaded;
    }
    return desktopReady(this.#state.size) || this.#state.loaded;
  }

  isBannerDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_BANNER_KEY) === '1';
    } catch {
      return false;
    }
  }

  dismissBanner() {
    try {
      localStorage.setItem(DISMISS_BANNER_KEY, '1');
    } catch {
      /* ignore */
    }
    this.#emit();
  }

  setModelSize(size: TTSModelSize) {
    if (size === this.#state.size) return;
    persistSize(size);
    void this.shutdown();
    const sizeReady = isAndroidSherpaPlatform() ? wasSherpaMarkedReady(size) : desktopReady(size);
    this.#set({
      size,
      status: sizeReady ? 'ready' : 'idle',
      progress: 0,
      loaded: false,
      device: null,
      adapterName: undefined,
      loadedDtype: undefined,
      error: undefined,
    });
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<KokoroWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        const pending = this.#pending.get(msg.id);
        pending?.onProgress?.(msg.loaded, msg.total);
        const total = msg.total || 1;
        const alreadyOnDisk = desktopReady(this.#state.size);
        this.#set({
          status: alreadyOnDisk ? 'loading' : 'downloading',
          progress: Math.min(1, msg.loaded / total),
        });
        return;
      }
      if (msg.type === 'device-info') {
        this.#set({
          gpuAvailable: msg.available,
          adapterName: msg.adapterName,
          gpuReason: msg.reason,
        });
        return;
      }
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.type === 'error') pending.reject(new Error(msg.message));
      else pending.resolve(msg);
    };
    worker.onerror = (err) => {
      const message = err.message || 'Kokoro worker error';
      for (const [, p] of this.#pending) p.reject(new Error(message));
      this.#pending.clear();
      this.#set({ status: 'error', error: message, loaded: false });
    };
    this.#worker = worker;
    return worker;
  }

  #request(
    body:
      | { type: 'init'; size: TTSModelSize; dtype: KokoroDtype }
      | { type: 'synthesize'; text: string; voice: string }
      | { type: 'shutdown' },
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<KokoroWorkerResponse> {
    const worker = this.#ensureWorker();
    const id = ++this.#reqId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress });
      const message = { ...body, id } as KokoroWorkerRequest;
      worker.postMessage(message);
    });
  }

  #ensureSupertonicWorker(): Worker {
    if (this.#supertonicWorker) return this.#supertonicWorker;
    const worker = new Worker(new URL('../supertonic/supertonic.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<SupertonicWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        this.#supertonicPending.get(msg.id)?.onProgress?.(msg.loaded, msg.total);
        const total = msg.total || 1;
        this.#set({
          status: desktopReady('supertonic-3') ? 'loading' : 'downloading',
          progress: Math.min(1, msg.loaded / total),
        });
        return;
      }
      const pending = this.#supertonicPending.get(msg.id);
      if (!pending) return;
      this.#supertonicPending.delete(msg.id);
      if (msg.type === 'error') pending.reject(new Error(msg.message));
      else pending.resolve(msg);
    };
    worker.onerror = (err) => {
      const message = err.message || 'Supertonic worker error';
      for (const [, pending] of this.#supertonicPending) pending.reject(new Error(message));
      this.#supertonicPending.clear();
      this.#set({ status: 'error', error: message, loaded: false });
    };
    this.#supertonicWorker = worker;
    return worker;
  }

  #supertonicRequest(
    body: SupertonicWorkerBody,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<SupertonicWorkerResponse> {
    const worker = this.#ensureSupertonicWorker();
    const id = ++this.#reqId;
    return new Promise((resolve, reject) => {
      this.#supertonicPending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ ...body, id });
    });
  }

  async #ensureSupertonicLoaded(): Promise<boolean> {
    const alreadyOnDisk = desktopReady('supertonic-3');
    this.#set({
      status: alreadyOnDisk ? 'loading' : 'downloading',
      progress: alreadyOnDisk ? 1 : 0,
      error: undefined,
      device: null,
    });
    const resp = await this.#supertonicRequest({ type: 'init' });
    if (resp.type !== 'ready') throw new Error('Unexpected Supertonic init response');
    markReady('supertonic-3');
    this.#set({
      status: 'ready',
      progress: 1,
      loaded: true,
      device: resp.device,
    });
    console.info(`[Supertonic] inference on ${resp.device}`);
    return true;
  }

  /**
   * Load the model in the worker. Safe to call repeatedly; concurrent callers
   * share one init. Returns false when Workers or kokoro-js are unavailable.
   */
  async ensureLoaded(): Promise<boolean> {
    if (this.#state.loaded) {
      if (isAndroidSherpaPlatform()) return true;
      if (resolveOnDeviceModel(this.#state.size).engine === 'supertonic') return true;
      if (this.#worker) return true;
    }
    if (!isAndroidSherpaPlatform() && typeof Worker === 'undefined') {
      this.#set({ status: 'unavailable', error: 'Web Workers not supported' });
      return false;
    }
    if (this.#initPromise) return this.#initPromise;

    this.#initPromise = (async () => {
      try {
        if (isAndroidSherpaPlatform()) {
          return this.#ensureSherpaLoaded(this.#state.size);
        }
        const resolved = resolveOnDeviceModel(this.#state.size);
        if (resolved.engine === 'supertonic') {
          return this.#ensureSupertonicLoaded();
        }
        const dtypeSize = kokoroDtypeSize(this.#state.size);
        const alreadyOnDisk = desktopReady(dtypeSize);
        this.#set({
          status: alreadyOnDisk ? 'loading' : 'downloading',
          progress: alreadyOnDisk ? 1 : 0,
          error: undefined,
          device: null,
        });
        const dtype = this.getDtype();
        const resp = await this.#request({
          type: 'init',
          size: dtypeSize,
          dtype,
        });
        if (resp.type !== 'ready') {
          throw new Error('Unexpected Kokoro init response');
        }
        markReady(dtypeSize);
        this.#set({
          status: 'ready',
          progress: 1,
          loaded: true,
          device: resp.device,
          adapterName: resp.adapterName,
          loadedDtype: resp.dtype,
        });
        console.info(
          `[Kokoro] inference on ${resp.device}` +
            (resp.adapterName ? ` (${resp.adapterName})` : '') +
            ` dtype=${resp.dtype}`,
        );
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[Kokoro] init failed', err);
        this.#set({ status: 'error', error: message, loaded: false, device: null });
        await this.shutdown();
        return false;
      } finally {
        this.#initPromise = null;
      }
    })();

    return this.#initPromise;
  }

  async #ensureSherpaLoaded(size: TTSModelSize): Promise<boolean> {
    try {
      const alreadyOnDisk = wasSherpaMarkedReady(size);
      this.#set({
        status: alreadyOnDisk ? 'loading' : 'downloading',
        progress: alreadyOnDisk ? 0 : 0,
        error: undefined,
        device: null,
      });
      const probe = await sherpaStatus(size).catch(() => ({ ready: false, loaded: false }));
      if (probe.ready && probe.loaded) {
        markSherpaReady(size);
        this.#set({
          status: 'ready',
          progress: 1,
          loaded: true,
          device: 'wasm',
          loadedDtype: size === 'large' ? 'fp32' : 'q8',
        });
        return true;
      }
      const status = await sherpaEnsureModel(size, (progress) => {
        this.#set({
          status: alreadyOnDisk || probe.ready ? 'loading' : 'downloading',
          progress,
        });
      });
      if (!status.ready) {
        throw new Error('On-device voice model is not ready');
      }
      markSherpaReady(size);
      this.#set({
        status: 'ready',
        progress: 1,
        loaded: true,
        device: 'wasm',
        loadedDtype: size === 'large' ? 'fp32' : 'q8',
      });
      console.info(`[Kokoro] inference on sherpa-onnx (${sherpaModelSpec(size).dir})`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[Kokoro] Sherpa init failed', err);
      this.#set({ status: 'error', error: message, loaded: false, device: null });
      return false;
    }
  }

  async synthesize(
    text: string,
    voice: string,
    signal?: AbortSignal,
    lang?: string,
  ): Promise<{ wav: ArrayBuffer; sampleRate: number; durationSec: number }> {
    if (!(await this.ensureLoaded())) {
      throw new Error(this.#state.error || 'Kokoro model unavailable');
    }

    let release!: () => void;
    const prev = this.#synthMutex;
    this.#synthMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      if (isAndroidSherpaPlatform()) {
        const audio = await sherpaSynthesize(text, voice, this.#state.size, lang);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return {
          wav: decodeWavBase64(audio.wavBase64),
          sampleRate: audio.sampleRate,
          durationSec: audio.durationSec,
        };
      }

      const abortHandler = () => {
        /* worker keeps running; caller abandons the promise */
      };
      signal?.addEventListener('abort', abortHandler, { once: true });
      try {
        const resolved = resolveOnDeviceModel(this.#state.size);
        const resp =
          resolved.engine === 'supertonic'
            ? await this.#supertonicRequest({ type: 'synthesize', text, voice, lang })
            : await this.#request({ type: 'synthesize', text, voice });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (resp.type !== 'audio') throw new Error('Unexpected on-device synthesize response');
        return {
          wav: resp.wav,
          sampleRate: resp.sampleRate,
          durationSec: resp.durationSec,
        };
      } finally {
        signal?.removeEventListener('abort', abortHandler);
      }
    } finally {
      release();
    }
  }

  async shutdown(): Promise<void> {
    this.#initPromise = null;
    if (this.#worker) {
      try {
        await this.#request({ type: 'shutdown' });
      } catch {
        /* ignore */
      }
      this.#worker.terminate();
      this.#worker = null;
    }
    if (this.#supertonicWorker) {
      try {
        await this.#supertonicRequest({ type: 'shutdown' });
      } catch {
        /* ignore */
      }
      this.#supertonicWorker.terminate();
      this.#supertonicWorker = null;
    }
    this.#pending.clear();
    this.#supertonicPending.clear();
    this.#set({ loaded: false, progress: 0, device: null });
  }

  get modelId(): string {
    return KOKORO_MODEL_ID;
  }
}

export const kokoroModelStore = new KokoroModelStore();
