import { describe, expect, it } from 'vitest';
import { shouldShowDownloadProgress } from '@/services/tts/kokoro/downloadProgress';

describe('shouldShowDownloadProgress', () => {
  it('hides the banner while hydrating a model that is already on disk', () => {
    expect(shouldShowDownloadProgress('downloading', true)).toBe(false);
    expect(shouldShowDownloadProgress('loading', true)).toBe(false);
    expect(shouldShowDownloadProgress('ready', true)).toBe(false);
  });

  it('shows progress only for a first-time network download', () => {
    expect(shouldShowDownloadProgress('downloading', false)).toBe(true);
    expect(shouldShowDownloadProgress('idle', false)).toBe(false);
    expect(shouldShowDownloadProgress('loading', false)).toBe(false);
  });
});
