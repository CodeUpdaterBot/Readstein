/**
 * The languages a work's source column can be written in.
 *
 * A translation file sets each page's original beside its English, and the
 * reader offers a switch to set that original aside. The switch has to name the
 * language it is hiding — 'Show Latin' on a Latin work reads as a mistake on a
 * German one — so the language is detected while the document is parsed (see
 * `markTranslationColumns` in utils/md.ts) and named from this table.
 *
 * The label is the word the translation files print in the column heading, e.g.
 * `**German:**`. Adding a source language means adding one row here; nothing else
 * needs to know about it.
 */
export const SOURCE_LANGUAGE_BY_LABEL: Readonly<Record<string, string>> = {
  Latin: 'la',
  German: 'de',
  Greek: 'el',
  Hebrew: 'he',
  Aramaic: 'arc',
  Syriac: 'syr',
  Coptic: 'cop',
  "Ge'ez": 'gez',
  Arabic: 'ar',
  Persian: 'fa',
  Turkish: 'tr',
  Yiddish: 'yi',
  Armenian: 'hy',
  Sanskrit: 'sa',
  Akkadian: 'akk',
  Sumerian: 'sux',
  Egyptian: 'egy',
  'Old English': 'ang',
  'Middle English': 'enm',
  'Old High German': 'goh',
  'Middle High German': 'gmh',
  'Church Slavonic': 'cu',
  Russian: 'ru',
  Polish: 'pl',
  Czech: 'cs',
  Hungarian: 'hu',
  French: 'fr',
  Italian: 'it',
  Spanish: 'es',
  Portuguese: 'pt',
  Dutch: 'nl',
  Swedish: 'sv',
  Danish: 'da',
  Norwegian: 'no',
  Irish: 'ga',
  Welsh: 'cy',
};

/** The language every translation is written into. Its label ends the source column. */
export const TARGET_LANGUAGE_LABEL = 'English';

const CODE_TO_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SOURCE_LANGUAGE_BY_LABEL).map(([label, code]) => [code, label]),
);

/** `'German'` -> `'de'`, or null when the word is not a language we know. */
export const sourceLanguageCodeOfLabel = (label: string): string | null =>
  SOURCE_LANGUAGE_BY_LABEL[label] ?? null;

/** `'de'` -> `'German'`, or null for a code outside the table. */
export const sourceLanguageLabelOfCode = (code: string): string | null =>
  CODE_TO_LABEL[code] ?? null;

/**
 * The label a column heading prints, without the colon: `'German:'` -> `'German'`.
 * Returns null for anything that is not a language heading, including the target
 * column's own `'English:'`, which the reader never adds a name to.
 */
export const sourceLanguageLabelOfHeading = (heading: string): string | null => {
  const name = heading.trim().replace(/:$/, '');
  if (!name || name === TARGET_LANGUAGE_LABEL) return null;
  return sourceLanguageCodeOfLabel(name) ? name : null;
};

/**
 * `'German:'` -> `'de'`. Null for the target heading (`'English:'`) and for any
 * language outside the table — the caller leaves those columns alone rather than
 * hiding a column it cannot name.
 */
export const sourceLanguageCodeOfHeading = (heading: string): string | null => {
  const name = sourceLanguageLabelOfHeading(heading);
  return name ? sourceLanguageCodeOfLabel(name) : null;
};

export interface SourceLanguageRange {
  start: number;
  end: number;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where a section's own-language column sits inside its extracted text.
 *
 * A translation file prints the source under a heading (`**Latin:**`) and the
 * English under the next one (`**English:**`), so in the text the source column
 * is simply what lies between the two. The reader marks those pieces while it
 * parses the document (see `markTranslationColumns` in utils/md.ts), but a cached
 * search index holds only the text, and the 'English only' search has to know
 * where the source sits without a document — so this reads the text itself.
 *
 * Offsets are into the given text, which is exactly what a search result's
 * locator uses. A source heading with no English after it runs to the end.
 */
export const sourceLanguageRanges = (text: string): SourceLanguageRange[] => {
  // Longest name first: 'Old High German:' must not be read as 'German:'.
  const names = Object.keys(SOURCE_LANGUAGE_BY_LABEL).sort((a, b) => b.length - a.length);
  const opener = new RegExp(`(?:${names.map(escapeRegExp).join('|')}):`, 'g');
  const closer = new RegExp(`${escapeRegExp(TARGET_LANGUAGE_LABEL)}:`, 'g');
  const ranges: SourceLanguageRange[] = [];
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    const start = match.index;
    closer.lastIndex = start + match[0].length;
    const end = closer.exec(text)?.index ?? text.length;
    ranges.push({ start, end });
    opener.lastIndex = Math.max(end, start + match[0].length);
  }
  return ranges;
};
