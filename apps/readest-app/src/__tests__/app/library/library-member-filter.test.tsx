import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateToLibrary = vi.fn();
const saveSysSettings = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const setSettingsDialogOpen = vi.fn();
const setRequestedPanel = vi.fn();
const setActiveSettingsItemId = vi.fn();

const settingsState = {
  settings: {
    householdMembers: [] as Array<{ id: string; name: string; color: string; createdAt: number }>,
    libraryHouseholdFilter: 'everyone',
    currentHouseholdMemberId: null as string | null,
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: (...args: unknown[]) => navigateToLibrary(...args),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: (...args: unknown[]) => saveSysSettings(...args),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/settingsStore', () => {
  const useSettingsStore = (selector?: (s: typeof settingsState) => unknown) =>
    selector ? selector(settingsState) : settingsState;
  useSettingsStore.getState = () => ({
    ...settingsState,
    setRequestedPanel,
    setActiveSettingsItemId,
    setSettingsDialogOpen,
  });
  return { useSettingsStore };
});

import LibraryMemberFilter from '@/app/library/components/LibraryMemberFilter';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  settingsState.settings.householdMembers = [];
  settingsState.settings.libraryHouseholdFilter = 'everyone';
});

describe('LibraryMemberFilter', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  it('is hidden until the household has at least one person', () => {
    const { container } = render(<LibraryMemberFilter />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Everyone, each person, Unassigned, and Manage', () => {
    settingsState.settings.householdMembers = [
      { id: 'alex', name: 'Alex', color: 'rose', createdAt: 1 },
      { id: 'sam', name: 'Sam', color: 'sky', createdAt: 2 },
    ];
    render(<LibraryMemberFilter />);
    expect(screen.getByRole('tab', { name: 'Everyone' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Alex' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sam' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Unassigned' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  });

  it('sets the current member when a person pill is clicked', async () => {
    settingsState.settings.householdMembers = [
      { id: 'alex', name: 'Alex', color: 'rose', createdAt: 1 },
    ];
    render(<LibraryMemberFilter />);
    fireEvent.click(screen.getByRole('tab', { name: 'Alex' }));
    await waitFor(() => {
      expect(saveSysSettings).toHaveBeenCalledWith(
        expect.anything(),
        'libraryHouseholdFilter',
        'alex',
      );
      expect(saveSysSettings).toHaveBeenCalledWith(
        expect.anything(),
        'currentHouseholdMemberId',
        'alex',
      );
    });
    expect(navigateToLibrary).toHaveBeenCalled();
  });

  it('opens household settings from Manage', () => {
    settingsState.settings.householdMembers = [
      { id: 'alex', name: 'Alex', color: 'rose', createdAt: 1 },
    ];
    render(<LibraryMemberFilter />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(setRequestedPanel).toHaveBeenCalledWith('Theme');
    expect(setActiveSettingsItemId).toHaveBeenCalledWith('settings.library.household');
    expect(setSettingsDialogOpen).toHaveBeenCalledWith(true);
  });
});
