import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveSysSettings = vi.fn(async () => {});
const updateBooks = vi.fn(async () => {});

const settingsState = {
  settings: {
    householdMembers: [] as Array<{ id: string; name: string; color: string; createdAt: number }>,
    currentHouseholdMemberId: null as string | null,
    libraryHouseholdFilter: 'everyone',
  },
};

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: (...args: unknown[]) => saveSysSettings(...args),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: { name?: string }) =>
    key.replace('{{name}}', opts?.name ?? ''),
}));

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = (selector?: (s: typeof settingsState) => unknown) =>
    selector ? selector(settingsState) : settingsState;
  useSettingsStore.getState = () => settingsState;
  return { useSettingsStore };
});

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      library: [
        {
          hash: 'h1',
          format: 'EPUB',
          title: 'T',
          author: 'A',
          createdAt: 1,
          updatedAt: 1,
          addedByMemberId: 'alex',
          memberIds: ['alex'],
        },
      ],
      updateBooks,
    }),
  },
}));

import HouseholdSettings from '@/components/settings/theme/HouseholdSettings';

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
  settingsState.settings.householdMembers = [];
  settingsState.settings.currentHouseholdMemberId = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  settingsState.settings.householdMembers = [];
  settingsState.settings.currentHouseholdMemberId = null;
});

describe('HouseholdSettings', () => {
  it('shows a first-run tip when no people have been added', () => {
    render(<HouseholdSettings />);
    expect(screen.getByText(/Add names, then new imports/)).toBeTruthy();
    expect(screen.getByText('One library on this PC. Filter by who added or owns a book.')).toBeTruthy();
  });

  it('adds a person from the name field', async () => {
    render(<HouseholdSettings />);
    fireEvent.change(screen.getByLabelText('Add a person'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(saveSysSettings).toHaveBeenCalledWith(
        expect.anything(),
        'householdMembers',
        expect.arrayContaining([expect.objectContaining({ name: 'Alex' })]),
      );
    });
  });

  it('lists existing people and can remove them', async () => {
    settingsState.settings.householdMembers = [
      { id: 'alex', name: 'Alex', color: 'rose', createdAt: 1 },
    ];
    render(<HouseholdSettings />);
    expect(screen.getByDisplayValue('Alex')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove Alex'));
    await waitFor(() => {
      expect(saveSysSettings).toHaveBeenCalledWith(expect.anything(), 'householdMembers', []);
      expect(updateBooks).toHaveBeenCalled();
    });
  });
});
