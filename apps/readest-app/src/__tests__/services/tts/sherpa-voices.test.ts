import { describe, expect, it } from 'vitest';
import {
  mapVoiceToSherpaId,
  sherpaKittenVoiceSid,
  sherpaSupertonicVoiceSid,
  sherpaVoiceSid,
  SHERPA_KOKORO_DEFAULT_VOICE,
} from '@/services/tts/kokoro/sherpaVoices';

describe('Sherpa voice mapping', () => {
  it('keeps native kokoro-en-v0_19 ids', () => {
    expect(mapVoiceToSherpaId('af_bella')).toBe('af_bella');
    expect(sherpaVoiceSid('af_bella')).toBe(1);
    expect(sherpaVoiceSid('bm_lewis')).toBe(10);
  });

  it('maps desktop Kokoro 1.0 ids onto the closest sherpa speaker', () => {
    expect(mapVoiceToSherpaId('af_heart')).toBe('af_bella');
    expect(sherpaVoiceSid('af_heart')).toBe(1);
    expect(mapVoiceToSherpaId('bm_fable')).toBe('bm_lewis');
  });

  it('falls back to Bella for unknown voices', () => {
    expect(mapVoiceToSherpaId(undefined)).toBe(SHERPA_KOKORO_DEFAULT_VOICE);
    expect(mapVoiceToSherpaId('not-a-voice')).toBe(SHERPA_KOKORO_DEFAULT_VOICE);
  });

  it('maps Kokoro ids onto Kitten speaker ids', () => {
    expect(sherpaKittenVoiceSid('af_bella')).toBe(1);
    expect(sherpaKittenVoiceSid('af_heart')).toBe(1);
    expect(sherpaKittenVoiceSid('am_adam')).toBe(0);
    expect(sherpaKittenVoiceSid('bm_lewis')).toBe(6);
    expect(sherpaKittenVoiceSid(undefined)).toBe(1);
  });

  it('maps Supertonic style names onto speaker ids', () => {
    expect(sherpaSupertonicVoiceSid('F1')).toBe(5);
    expect(sherpaSupertonicVoiceSid('M1')).toBe(0);
    expect(sherpaSupertonicVoiceSid(undefined)).toBe(5);
  });
});
