import type { TTSModelSize } from '../types';
import type { KokoroDtype } from './protocol';

export type InferenceDevice = 'webgpu' | 'wasm';

export type GpuAdapterSnapshot = {
  available: boolean;
  isFallbackAdapter: boolean;
  name: string;
  vendor: string;
  reason?: string;
};

export type LoadAttempt = {
  dtype: KokoroDtype;
  device: InferenceDevice;
};

type AdapterInfoLike = {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
};

type AdapterLike = {
  isFallbackAdapter?: boolean;
  info?: AdapterInfoLike;
  requestAdapterInfo?: () => Promise<AdapterInfoLike>;
};

type GpuLike = {
  requestAdapter: (opts?: {
    powerPreference?: 'low-power' | 'high-performance';
  }) => Promise<AdapterLike | null>;
};

const formatAdapterName = (info: AdapterInfoLike | undefined): string => {
  const description = info?.description?.trim();
  const device = info?.device?.trim();
  const vendor = info?.vendor?.trim();
  return description || device || vendor || 'GPU';
};

/**
 * Probe WebGPU in the current realm (window or dedicated worker).
 * `powerPreference: 'high-performance'` is what gets a discrete NVIDIA GPU
 * instead of an Intel iGPU on Windows laptops.
 */
export const snapshotGpuAdapter = async (gpu?: GpuLike | null): Promise<GpuAdapterSnapshot> => {
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return {
      available: false,
      isFallbackAdapter: false,
      name: '',
      vendor: '',
      reason: 'WebGPU API missing (use Chrome or Edge on http://localhost or HTTPS)',
    };
  }

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return {
        available: false,
        isFallbackAdapter: false,
        name: '',
        vendor: '',
        reason: 'No WebGPU adapter (GPU blocked, outdated driver, or unsupported GPU)',
      };
    }

    let info: AdapterInfoLike | undefined = adapter.info;
    if (!info && typeof adapter.requestAdapterInfo === 'function') {
      try {
        info = await adapter.requestAdapterInfo();
      } catch {
        info = undefined;
      }
    }

    const isFallbackAdapter = adapter.isFallbackAdapter === true;
    if (isFallbackAdapter) {
      return {
        available: false,
        isFallbackAdapter: true,
        name: formatAdapterName(info),
        vendor: info?.vendor?.trim() || '',
        reason: 'Browser offered a software GPU adapter; WASM CPU is faster',
      };
    }

    return {
      available: true,
      isFallbackAdapter: false,
      name: formatAdapterName(info),
      vendor: info?.vendor?.trim() || '',
    };
  } catch (err) {
    return {
      available: false,
      isFallbackAdapter: false,
      name: '',
      vendor: '',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Ordered (dtype, device) attempts. WebGPU needs fp32 (kokoro-js recommendation)
 * or q4f16 — q4/q8 on WebGPU are slow or produce garbage. WASM keeps the
 * user's Tiny/Small/Large quantized files.
 */
export const buildLoadAttempts = (
  size: TTSModelSize,
  gpu: GpuAdapterSnapshot,
): LoadAttempt[] => {
  const gpuAttempts: LoadAttempt[] =
    size === 'tiny'
      ? [
          { dtype: 'q4f16', device: 'webgpu' },
          { dtype: 'fp16', device: 'webgpu' },
          { dtype: 'fp32', device: 'webgpu' },
        ]
      : size === 'large'
        ? [
            { dtype: 'fp32', device: 'webgpu' },
            { dtype: 'fp16', device: 'webgpu' },
          ]
        : [
            { dtype: 'fp32', device: 'webgpu' },
            { dtype: 'fp16', device: 'webgpu' },
            { dtype: 'q4f16', device: 'webgpu' },
          ];

  const wasmAttempts: LoadAttempt[] =
    size === 'tiny'
      ? [
          { dtype: 'q4', device: 'wasm' },
          { dtype: 'q8', device: 'wasm' },
        ]
      : size === 'large'
        ? [
            { dtype: 'fp16', device: 'wasm' },
            { dtype: 'q8', device: 'wasm' },
          ]
        : [
            { dtype: 'q8', device: 'wasm' },
            { dtype: 'q4', device: 'wasm' },
          ];

  if (gpu.available && !gpu.isFallbackAdapter) {
    return [...gpuAttempts, ...wasmAttempts];
  }
  return wasmAttempts;
};

export const navigatorGpu = (): GpuLike | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  return gpu;
};
