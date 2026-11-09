import type { Book, LibrarySearchMatch, LibrarySearchSectionResult } from '@/types/book';

export interface SourceFilterableGroup {
  book: Book;
  matchCount: number;
  sections: LibrarySearchSectionResult[];
}

const inSourceRange = (
  ranges: { start: number; end: number }[] | undefined,
  offset: number,
): boolean => !!ranges?.some((range) => offset >= range.start && offset < range.end);

/**
 * The results as the reader asked to see them: with the work's own language
 * crossed out, or with everything.
 *
 * The scan always searches a translation whole — source column and all — because
 * that is the default, it is the cheaper answer, and it means one scan serves
 * both settings. Each section result carries where its source column sits, so
 * this is all the switch costs: a filter over results that are already found.
 * Nothing is read again, no book file is opened, and the count comes back right
 * with it.
 */
export const withoutSourceLanguage = <G extends SourceFilterableGroup>(
  groups: G[],
  includeSource: boolean,
): G[] => {
  if (includeSource) return groups;
  return groups
    .map((group) => {
      const sections = group.sections
        .map((section) => ({
          ...section,
          subitems: section.subitems.filter(
            (match: LibrarySearchMatch) =>
              !inSourceRange(section.sourceRanges, match.locator.start),
          ),
        }))
        .filter((section) => section.subitems.length > 0);
      return {
        ...group,
        sections,
        matchCount: sections.reduce((total, section) => total + section.subitems.length, 0),
      };
    })
    .filter((group) => group.sections.length > 0);
};
