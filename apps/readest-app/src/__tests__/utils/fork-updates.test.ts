/**
 * This fork must never contact official Readest update endpoints.
 */
import { describe, expect, it, vi } from 'vitest';

const mockCheck = vi.fn();
const mockSetUpdaterWindowVisible = vi.fn();
const mockFetch = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));
vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => 'windows',
  arch: () => 'x86_64',
}));
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    once() {}
  },
}));
vi.mock('@/components/UpdaterWindow', () => ({
  setUpdaterWindowVisible: (...args: unknown[]) => mockSetUpdaterWindowVisible(...args),
}));

import { checkAppReleaseNotes, checkForAppUpdates } from '@/helpers/updater';
import { FORK_DISABLE_UPDATES } from '@/utils/fork';

describe('fork update policy', () => {
  it('keeps official auto-update disabled', () => {
    expect(FORK_DISABLE_UPDATES).toBe(true);
  });

  it('does not call the official updater or changelog', async () => {
    await expect(checkForAppUpdates((s) => s, false)).resolves.toBe(false);
    await expect(checkAppReleaseNotes(false)).resolves.toBe(false);
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSetUpdaterWindowVisible).not.toHaveBeenCalled();
  });
});
