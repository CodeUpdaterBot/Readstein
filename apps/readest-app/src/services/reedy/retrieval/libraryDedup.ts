import type { TranslationLink } from '@/libs/document';

/**
 * Library corpus deduplication.
 *
 * The AI corpus is **one entry per work**. The library, though, holds more than
 * that: the same title can appear twice (two copies of one book), and one work
 * can carry several translations (a raw run and a curated build, a DeepSeek
 * pass and a Gemini pass). Indexing all of them would put near-identical
 * passages into the corpus and make the assistant cite the same sentence twice
 * from two nominally "different" works.
 *
 * `resolveLibraryCorpus()` picks one representative per work. It is a pure
 * function — no I/O, no app types beyond the metadata shape — so the rule is
 * reviewable and testable in isolation.
 *
 * The work graph is resolved by union-find over three kinds of link:
 *   1. a translation → the work it translates (`translationOf`);
 *   2. a source work → the translations it declares (`metadata.translations`);
 *   3. two records with the same normalised title+author (plain duplicates).
 *
 * Within a work, the kept representative is chosen by, in order: it holds real
 * translatable text (not a scan), then it is the more complete translation,
 * then the larger text, then the newest declared translation.
 */

/** Formats whose text is scanned/mixed and is a weaker corpus entry than a translation. */
const SCAN_FORMATS = new Set(['PDF', 'CBZ']);

export interface CorpusCandidate {
  hash: string;
  title: string;
  author?: string | null;
  /** BookFormat, e.g. 'MD' | 'PDF' | 'EPUB'. */
  format?: string | null;
  /**
   * The record's `primaryLanguage` (ISO 639-1, e.g. 'en', 'la', 'de'). The
   * corpus is **English-only**, so a candidate that is not English can neither
   * be kept nor represent a work.
   */
  language?: string | null;
  /** On a translation: the library hash of the work it translates. */
  translationOf?: string | null;
  /** On a source work: the translation links it declares. */
  translations?: TranslationLink[] | null;
  /** Extractable text length when known — a tie-break on which copy is fuller. */
  textChars?: number | null;
}

export type CorpusDropReason = 'duplicate' | 'redundant-translation' | 'not-english';

/** The corpus holds English text only; anything else is excluded outright. */
export function isEnglishCandidate(candidate: CorpusCandidate): boolean {
  return (candidate.language ?? '').toLowerCase().startsWith('en');
}

export interface CorpusDecision {
  hash: string;
  reason: 'kept' | CorpusDropReason;
  /** For a dropped candidate, the hash of the representative that was kept. */
  keptHash?: string;
}

export interface CorpusResolution {
  /** One candidate per work, in the input order of each group's representative. */
  kept: CorpusCandidate[];
  /** Every candidate, in input order, with what happened to it. */
  decisions: CorpusDecision[];
}

/** Normalise a title/author for duplicate detection: accents kept, punctuation and site noise stripped. */
export function normalizeWorkText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\(z-library[^)]*\)/g, '') // "… (z-library.sk, 1lib.sk, z-lib.sk).pdf"
    .replace(/\.(pdf|epub|md|mobi|azw3?|cbz|txt)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Parse the leading integer of a `translated` string ("379 complete, 0 partial, …"). */
function parseComplete(translated: string | undefined): number {
  if (!translated) return 0;
  const m = translated.match(/(\d+)\s*complete/i);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/**
 * Score a candidate within its work group; strictly higher wins. Encoded as an
 * array so ties fall through to the next dimension in order.
 */
function scoreOf(
  c: CorpusCandidate,
  declaredRank: Map<string, number>,
  declaredComplete: Map<string, number>,
  inputIndex: Map<string, number>,
): number[] {
  const isText = c.format && !SCAN_FORMATS.has(c.format.toUpperCase()) ? 1 : 0;
  return [
    // English first and above all else: the corpus is English-only, so an
    // English copy always represents a work over a Latin/German one.
    isEnglishCandidate(c) ? 1 : 0,
    isText,
    declaredComplete.get(c.hash) ?? 0,
    c.textChars ?? 0,
    declaredRank.get(c.hash) ?? -1,
    // Final tie-break: prefer the earlier input so the result is stable.
    -(inputIndex.get(c.hash) ?? 0),
  ];
}

function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function resolveLibraryCorpus(candidates: CorpusCandidate[]): CorpusResolution {
  const index = new Map(candidates.map((c, i) => [c.hash, i]));
  const parent = new Map<string, string>();
  for (const c of candidates) parent.set(c.hash, c.hash);

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Declared translation metadata, keyed on the translation's hash.
  const declaredRank = new Map<string, number>();
  const declaredComplete = new Map<string, number>();
  for (const c of candidates) {
    for (const [rank, link] of (c.translations ?? []).entries()) {
      if (!index.has(link.hash)) continue;
      declaredRank.set(link.hash, rank);
      declaredComplete.set(link.hash, parseComplete(link.translated));
    }
  }

  const titleKeys = new Map<string, string>();
  for (const c of candidates) {
    // 1 + 2: translation <-> source links.
    if (c.translationOf && index.has(c.translationOf)) union(c.hash, c.translationOf);
    for (const link of c.translations ?? []) {
      if (index.has(link.hash)) union(c.hash, link.hash);
    }
    // 3: duplicate copies by normalised title+author.
    const key = `${normalizeWorkText(c.title)}|${normalizeWorkText(c.author)}`;
    const prior = titleKeys.get(key);
    if (prior) union(c.hash, prior);
    else titleKeys.set(key, c.hash);
  }

  // Group, then pick a representative per group.
  const groups = new Map<string, CorpusCandidate[]>();
  for (const c of candidates) {
    const root = find(c.hash);
    const list = groups.get(root);
    if (list) list.push(c);
    else groups.set(root, [c]);
  }

  const decisions: CorpusDecision[] = [];
  const decisionByHash = new Map<string, CorpusDecision>();

  for (const list of groups.values()) {
    let winner = list[0]!;
    let winnerScore = scoreOf(winner, declaredRank, declaredComplete, index);
    for (const c of list.slice(1)) {
      const s = scoreOf(c, declaredRank, declaredComplete, index);
      if (compareScore(s, winnerScore) > 0) {
        winner = c;
        winnerScore = s;
      }
    }

    // English-only corpus: a work with no English representation at all — a
    // Latin or German original with no translation in the library — contributes
    // nothing and is excluded whole, rather than indexed in its source language.
    if (!isEnglishCandidate(winner)) {
      for (const c of list) {
        decisionByHash.set(c.hash, { hash: c.hash, reason: 'not-english' });
      }
      continue;
    }

    for (const c of list) {
      const involvesTranslation =
        list.length > 1 && list.some((x) => x.translationOf || (x.translations?.length ?? 0) > 0);
      const decision: CorpusDecision =
        c.hash === winner.hash
          ? { hash: c.hash, reason: 'kept' }
          : {
              hash: c.hash,
              reason: involvesTranslation ? 'redundant-translation' : 'duplicate',
              keptHash: winner.hash,
            };
      decisionByHash.set(c.hash, decision);
    }
  }

  // Emit in input order for deterministic, reviewable output.
  const kept: CorpusCandidate[] = [];
  for (const c of candidates) {
    const d = decisionByHash.get(c.hash)!;
    decisions.push(d);
    if (d.reason === 'kept') kept.push(c);
  }

  return { kept, decisions };
}
