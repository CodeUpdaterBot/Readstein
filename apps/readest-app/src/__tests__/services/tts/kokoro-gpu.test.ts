import { describe, expect, it } from 'vitest';
import {
  buildLoadAttempts,
  snapshotGpuAdapter,
  type GpuAdapterSnapshot,
} from '@/services/tts/kokoro/discoverGpu';
import { MIN_AUDIBLE_PEAK, pcmPeak } from '@/services/tts/kokoro/pcmQuality';

const gpuOk = (name: string): GpuAdapterSnapshot => ({
  available: true,
  isFallbackAdapter: false,
  name,
  vendor: 'nvidia',
});

const noGpu: GpuAdapterSnapshot = {
  available: false,
  isFallbackAdapter: false,
  name: '',
  vendor: '',
  reason: 'WebGPU API missing',
};

describe('buildLoadAttempts', () => {
  it('puts WebGPU fp32 first for Small when a discrete GPU is present', () => {
    const attempts = buildLoadAttempts('small', gpuOk('NVIDIA GeForce RTX 3080'));
    expect(attempts[0]).toEqual({ dtype: 'fp32', device: 'webgpu' });
    expect(attempts.some((a) => a.device === 'wasm' && a.dtype === 'q8')).toBe(true);
    expect(attempts.every((a) => a.device !== 'webgpu' || a.dtype !== 'q8')).toBe(true);
  });

  it('skips WebGPU when the browser only offers a software adapter', () => {
    const attempts = buildLoadAttempts('small', {
      available: false,
      isFallbackAdapter: true,
      name: 'Microsoft Basic Render Driver',
      vendor: '',
      reason: 'software',
    });
    expect(attempts.every((a) => a.device === 'wasm')).toBe(true);
    expect(attempts[0]).toEqual({ dtype: 'q8', device: 'wasm' });
  });

  it('uses WASM q8 for Small when WebGPU is missing', () => {
    expect(buildLoadAttempts('small', noGpu)[0]).toEqual({ dtype: 'q8', device: 'wasm' });
  });

  it('prefers q4f16 on WebGPU for Tiny', () => {
    expect(buildLoadAttempts('tiny', gpuOk('NVIDIA'))[0]).toEqual({
      dtype: 'q4f16',
      device: 'webgpu',
    });
  });
});

describe('snapshotGpuAdapter', () => {
  it('reports missing API', async () => {
    const snap = await snapshotGpuAdapter(undefined);
    expect(snap.available).toBe(false);
    expect(snap.reason).toMatch(/WebGPU API missing/);
  });

  it('requests the high-performance adapter and reads its name', async () => {
    const gpu = {
      requestAdapter: async (opts?: { powerPreference?: string }) => {
        expect(opts?.powerPreference).toBe('high-performance');
        return {
          isFallbackAdapter: false,
          info: { vendor: 'nvidia', device: 'NVIDIA GeForce RTX 4070' },
        };
      },
    };
    const snap = await snapshotGpuAdapter(gpu);
    expect(snap.available).toBe(true);
    expect(snap.name).toBe('NVIDIA GeForce RTX 4070');
    expect(snap.vendor).toBe('nvidia');
  });

  it('rejects a software fallback adapter', async () => {
    const gpu = {
      requestAdapter: async () => ({
        isFallbackAdapter: true,
        info: { description: 'SwiftShader' },
      }),
    };
    const snap = await snapshotGpuAdapter(gpu);
    expect(snap.available).toBe(false);
    expect(snap.isFallbackAdapter).toBe(true);
  });
});

describe('pcmPeak', () => {
  it('treats NaN as unusable silence', () => {
    expect(pcmPeak(new Float32Array([NaN, 0.5]))).toBe(0);
  });

  it('rejects near-zero WebGPU output as inaudible', () => {
    expect(pcmPeak(new Float32Array(64))).toBe(0);
    expect(pcmPeak(new Float32Array([0.5, -0.4]))).toBeGreaterThan(MIN_AUDIBLE_PEAK);
  });
});
