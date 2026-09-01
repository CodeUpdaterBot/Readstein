import { describe, expect, it } from 'vitest';
import {
  formatPickerLabel,
  isOnDeviceLanguageSupported,
  modelsForPlatform,
  modelsGroupedByEngine,
  resolveOnDeviceModel,
} from '@/services/tts/onDeviceCatalog';
import { sherpaModelSpec } from '@/services/tts/kokoro/sherpaModels';
import { voicesForOnDeviceModel } from '@/services/tts/kokoro/sherpaVoices';

describe('on-device TTS catalog', () => {
  it('maps legacy Android tiny/small/large onto Kitten, not Kokoro', () => {
    expect(resolveOnDeviceModel('tiny', 'android').id).toBe('kitten-nano');
    expect(resolveOnDeviceModel('small', 'android').id).toBe('kitten-mini');
    expect(resolveOnDeviceModel('large', 'android').id).toBe('kitten-mini');
    expect(resolveOnDeviceModel('tiny', 'android').engine).toBe('kitten');
  });

  it('maps legacy desktop sizes onto Kokoro quantizations', () => {
    expect(resolveOnDeviceModel('tiny', 'desktop').id).toBe('kokoro-tiny');
    expect(resolveOnDeviceModel('small', 'desktop').id).toBe('kokoro-small');
    expect(resolveOnDeviceModel('large', 'desktop').id).toBe('kokoro-large');
  });

  it('keeps Piper Android-only and Supertonic on both platforms', () => {
    const androidIds = modelsForPlatform('android').map((model) => model.id);
    const desktopIds = modelsForPlatform('desktop').map((model) => model.id);
    expect(androidIds).toContain('piper-amy-low');
    expect(androidIds).toContain('kitten-nano');
    expect(androidIds).toContain('supertonic-3');
    expect(androidIds).not.toContain('kokoro-small');
    expect(desktopIds).toContain('kokoro-small');
    expect(desktopIds).toContain('supertonic-3');
    expect(desktopIds).not.toContain('piper-amy-low');
  });

  it('sorts models by parameter count (Tiny → Large)', () => {
    const android = modelsForPlatform('android');
    const params = android.map((model) => model.paramsM);
    expect(params).toEqual([...params].sort((a, b) => a - b));
    expect(android[0]!.paramsM).toBeLessThan(android[android.length - 1]!.paramsM);
  });

  it('groups Android engines as Piper, Kitten, then Supertonic', () => {
    expect(modelsGroupedByEngine('android').map((group) => group.engine)).toEqual([
      'piper',
      'kitten',
      'supertonic',
    ]);
  });

  it('shows engine, tier, and parameter count in picker labels', () => {
    const amy = resolveOnDeviceModel('piper-amy-low', 'android');
    expect(formatPickerLabel(amy)).toMatch(/Piper Amy Low/);
    expect(formatPickerLabel(amy)).toMatch(/18M/);
  });

  it('allows Supertonic for non-English books and keeps Kitten English-only', () => {
    expect(isOnDeviceLanguageSupported('supertonic-3', 'fr-FR')).toBe(true);
    expect(isOnDeviceLanguageSupported('kitten-mini', 'fr-FR')).toBe(false);
    expect(isOnDeviceLanguageSupported('kitten-mini', 'en-US')).toBe(true);
  });
});

describe('Sherpa Android model catalog', () => {
  it('resolves Kitten / Piper / Supertonic packages', () => {
    expect(sherpaModelSpec('tiny').family).toBe('kitten');
    expect(sherpaModelSpec('small').family).toBe('kitten');
    expect(sherpaModelSpec('large').family).toBe('kitten');
    expect(sherpaModelSpec('piper-amy-low').family).toBe('vits');
    expect(sherpaModelSpec('supertonic-3').family).toBe('supertonic');
    expect(sherpaModelSpec('unknown').id).toBe('kitten-nano');
  });

  it('lists matching voices per package', () => {
    expect(voicesForOnDeviceModel('piper-amy-low').map((voice) => voice.id)).toEqual(['amy']);
    expect(voicesForOnDeviceModel('supertonic-3').map((voice) => voice.id)).toContain('F1');
    expect(voicesForOnDeviceModel('kitten-nano').length).toBe(8);
  });
});
