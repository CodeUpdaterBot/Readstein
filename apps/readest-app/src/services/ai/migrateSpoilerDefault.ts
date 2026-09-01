import type { SystemSettings } from '@/types/settings';

/**
 * Spoiler protection used to default on with no toggle. Notebook chat is
 * whole-book Q&A over the index, so one-time flip existing installs to off.
 * Returns true when settings were changed (caller should persist).
 */
export function migrateAiSpoilerDefault(settings: SystemSettings): boolean {
  const ai = settings.aiSettings;
  if (!ai || ai.spoilerDefaultMigrated) return false;
  ai.spoilerProtection = false;
  ai.spoilerDefaultMigrated = true;
  return true;
}
