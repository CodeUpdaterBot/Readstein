import { describe, expect, it } from 'vitest';
import { migrateAiSpoilerDefault } from '@/services/ai/migrateSpoilerDefault';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { SystemSettings } from '@/types/settings';

const withAi = (ai: Partial<typeof DEFAULT_AI_SETTINGS>): SystemSettings =>
  ({
    aiSettings: { ...DEFAULT_AI_SETTINGS, ...ai },
  }) as unknown as SystemSettings;

describe('migrateAiSpoilerDefault', () => {
  it('turns leftover default-on spoiler protection off once', () => {
    const settings = withAi({ spoilerProtection: true });

    expect(migrateAiSpoilerDefault(settings)).toBe(true);
    expect(settings.aiSettings.spoilerProtection).toBe(false);
    expect(settings.aiSettings.spoilerDefaultMigrated).toBe(true);
  });

  it('does not override a user who already migrated and re-enabled spoilers', () => {
    const settings = withAi({ spoilerProtection: true, spoilerDefaultMigrated: true });

    expect(migrateAiSpoilerDefault(settings)).toBe(false);
    expect(settings.aiSettings.spoilerProtection).toBe(true);
  });

  it('is a no-op when already migrated with spoilers off', () => {
    const settings = withAi({ spoilerProtection: false, spoilerDefaultMigrated: true });

    expect(migrateAiSpoilerDefault(settings)).toBe(false);
    expect(settings.aiSettings.spoilerProtection).toBe(false);
  });
});
