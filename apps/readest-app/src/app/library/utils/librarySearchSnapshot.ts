import type { Book, LibrarySearchConfig, LibrarySearchSectionResult } from '@/types/book';

/** One book's hits, as every library search view holds them. */
export interface SearchResultGroup {
  book: Book;
  sections: LibrarySearchSectionResult[];
  matchCount: number;
  truncated?: boolean;
}

export interface SearchIssue {
  book: Book;
  message: string;
}

/** A finished library scan, kept so another view can show it without redoing it. */
export interface LibrarySearchSnapshot {
  searchKey: string;
  groups: SearchResultGroup[];
  issues: SearchIssue[];
  skipped: number;
  truncated: boolean;
  expandedBooks: string[];
}

/**
 * Identity of a scan: the books searched, the options in force, and the query.
 *
 * Both the results list and the spiral dial run the *same* scan, so they build
 * their key here rather than each rolling their own. Anything that would change
 * what a scan returns must be in this string — that is what makes reusing a
 * snapshot safe, and what makes flipping between the two views instant instead of
 * a second full sweep of the library.
 */
export const makeLibrarySearchKey = (
  books: Book[],
  config: LibrarySearchConfig,
  query: string,
): string => {
  const booksKey = books
    .map((book) => book.hash)
    .sort()
    .join('|');
  const configKey = [
    config.mode,
    config.matchCase,
    config.matchDiacritics,
    config.englishOnly,
    config.nearbyWords,
  ].join(':');
  return `${booksKey}\u0000${configKey}\u0000${query}`;
};

// Module-scoped: opening a result in the reader and coming back, or switching
// between the list and the dial, must restore the same results rather than
// rescanning. One slot is enough — the newest scan is the one anyone returns to.
let snapshot: LibrarySearchSnapshot | null = null;

/** The finished scan for exactly this key, or null. */
export const readLibrarySearchSnapshot = (searchKey: string): LibrarySearchSnapshot | null =>
  snapshot && snapshot.searchKey === searchKey ? snapshot : null;

export const writeLibrarySearchSnapshot = (next: LibrarySearchSnapshot): void => {
  snapshot = next;
};

/** Drop the cached scan — used to isolate tests, and when a caller needs to force a re-scan. */
export const clearLibrarySearchSnapshot = (): void => {
  snapshot = null;
};

/** Record which result groups the user expanded, for the view that restores them. */
export const updateLibrarySearchSnapshotExpanded = (
  searchKey: string,
  expandedBooks: string[],
): void => {
  if (snapshot && snapshot.searchKey === searchKey) snapshot.expandedBooks = expandedBooks;
};
