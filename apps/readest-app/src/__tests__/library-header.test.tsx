import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { LibrarySearchConfig, LibrarySearchTarget } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, o?: Record<string, string | number>) =>
    o ? key.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(o[n] ?? '')) : key,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: undefined }) }));
vi.mock('@/store/themeStore', () => ({
  // safeAreaInsets must be present: the component returns null without it.
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ currentBookshelf: [] as Book[] }),
}));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => <div /> }));
vi.mock('@/app/library/components/LibrarySearchOptionsMenu', () => ({ default: () => <div /> }));

import LibraryHeader from '@/app/library/components/LibraryHeader';

describe('the library header search bar', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  const renderHeader = (searchTarget: LibrarySearchTarget) =>
    render(
      <LibraryHeader
        isSelectMode={false}
        isSelectAll={false}
        onPullLibrary={() => {}}
        onImportBooksFromFiles={() => {}}
        onOpenCatalogManager={() => {}}
        onOpenFeeds={() => {}}
        onToggleSelectMode={() => {}}
        onSelectAll={() => {}}
        onDeselectAll={() => {}}
        searchQuery=''
        searchTarget={searchTarget}
        searchConfig={
          {
            scope: 'book',
            mode: 'contains',
            matchCase: false,
            matchDiacritics: false,
          } as LibrarySearchConfig
        }
        onSearchConfigChange={() => {}}
        onSearchQueryChange={() => {}}
        onSearchTargetChange={() => {}}
        spiralMode={false}
        onToggleSpiral={() => {}}
      />,
    );

  it('keeps the icons and drops the divider rules either side of the dial', () => {
    // The dial used to sit between two hairline pipes. They carried no meaning and
    // made the cluster read as three groups instead of one.
    for (const target of ['books', 'text'] as LibrarySearchTarget[]) {
      const { container, unmount } = renderHeader(target);
      expect(container.querySelectorAll('[class*="0.5px"]').length).toBe(0);
      expect(screen.getByLabelText('Spiral Search')).toBeTruthy();
      unmount();
    }
  });

  it('still offers import and select while searching books, and options while searching text', () => {
    const books = renderHeader('books');
    expect(screen.getByLabelText('Import Books')).toBeTruthy();
    expect(screen.getByLabelText('Select Books')).toBeTruthy();
    books.unmount();

    renderHeader('text');
    expect(screen.getByLabelText('Search Options')).toBeTruthy();
    expect(screen.queryByLabelText('Import Books')).toBeNull();
  });
});
