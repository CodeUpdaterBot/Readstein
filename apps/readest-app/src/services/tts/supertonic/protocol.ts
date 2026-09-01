export type SupertonicWorkerBody =
  | { type: 'init' }
  | { type: 'synthesize'; text: string; voice: string; lang?: string }
  | { type: 'shutdown' };

export type SupertonicWorkerRequest = SupertonicWorkerBody & { id: number };

export type SupertonicWorkerResponse =
  | { id: number; type: 'ready'; device: 'webgpu' | 'wasm' }
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'audio'; wav: ArrayBuffer; sampleRate: number; durationSec: number }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'shutdown-ok' };
