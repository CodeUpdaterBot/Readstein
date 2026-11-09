import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';

import type { BookDoc, SectionItem } from '@/libs/document';
import { CFI } from '@/libs/document';
import {
  FOOTNOTE_PREFIX_ID,
  buildChapterFootnotes,
  expandInlineFootnotes,
  extractFootnoteDefs,
} from './mdFootnotes';
import { frontmatterToMetadata, parseFrontmatter } from './mdFrontmatter';
import { sanitizeHtml } from './sanitize';
import { sourceLanguageCodeOfHeading, TARGET_LANGUAGE_LABEL } from './sourceLanguage';

// Render a standalone Markdown (.md) file into an in-memory foliate-js book at
// runtime (no EPUB conversion). The document is split into one section per
// top-level heading so reading progress, the cross-device location cursor and
// TTS section tracking all work per chapter — the same contract fb2.js gives a
// single-file format. Layout/font/theme styling applies for free because the
// reader styles whatever HTML the view renders.

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// A scoped parser: `marked` itself is a shared singleton also imported by the
// annotation note renderer and the export dialog, and must not gain footnote
// parsing as a side effect.
const markdown = new Marked({ gfm: true }).use(markedFootnote({ prefixId: FOOTNOTE_PREFIX_ID }), {
  hooks: { preprocess: expandInlineFootnotes },
});

// Minimal defaults so code blocks wrap inside the paginated column (long lines
// would otherwise overflow and break pagination) and tables/images stay legible
// under every theme. `currentColor` keeps borders readable in dark / e-ink.
const MD_STYLE = `
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; overflow-wrap: break-word; }
pre, code { font-family: monospace; }
table { border-collapse: collapse; }
th, td { border: 1px solid currentColor; padding: 0.2em 0.5em; }
blockquote { margin-inline: 1em; }
.md-footnotes { margin-block-start: 2em; font-size: 0.9em; }
.md-footnotes hr { width: 30%; margin-inline-start: 0; border: 0; border-top: 1px solid currentColor; opacity: 0.4; }
sup a, .footnote-backref { text-decoration: none; }
.footnote-backref { margin-inline-start: 0.4em; }
`;

const wrapXhtml = (inner: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  `<html xmlns="${XHTML_NS}"><head><meta charset="utf-8"/>` +
  `<style>${MD_STYLE}</style></head><body>${inner}</body></html>`;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

const isExternalUri = (uri: string): boolean => /^(?:https?|mailto|tel):/i.test(uri);

interface TocNode {
  label: string;
  href: string;
  subitems?: TocNode[];
}

type MarkdownSection = SectionItem & {
  load: () => string;
  loadContent: () => Promise<string>;
  unload: () => void;
};

/** A paragraph that is nothing but a column heading, e.g. `<p><strong>German:</strong></p>`. */
const languageLabelOf = (el: Element | null): string | null => {
  if (!el || el.tagName !== 'P' || el.children.length !== 1) return null;
  const only = el.children[0] as Element;
  if (only.tagName !== 'STRONG') return null;
  const text = (el.textContent ?? '').trim();
  if (text === `${TARGET_LANGUAGE_LABEL}:`) return text;
  // A source heading in a language the table does not know is left alone rather
  // than guessed at, so a book whose column cannot be named keeps every word.
  return sourceLanguageCodeOfHeading(text) ? text : null;
};

/**
 * Mark the source-language column so the reader can hide it.
 *
 * A translation file carries the two columns as `<p><strong>Latin:</strong></p>`
 * followed by the source (as blockquotes) and then the same for `English:`. The
 * source heading names the language, and hiding the source turns the book into a
 * plain reading copy of the English, which is what a reader who only wants the
 * translation is asking for.
 *
 * The marking is deliberately structural — a wrapper element and two class names —
 * so the reader can toggle it with CSS alone. Nothing is removed from the document,
 * so a CFI taken before the toggle still resolves to the same text afterwards,
 * which is what keeps the reader's place when the pages reflow.
 */
const markTranslationColumns = (body: HTMLElement): string | null => {
  const doc = body.ownerDocument;
  let detected: string | null = null;
  for (const candidate of Array.from(body.querySelectorAll('p'))) {
    const heading = languageLabelOf(candidate);
    if (!heading) continue;
    // Only a source-language heading opens a column to hide. The target heading
    // ('English:') closes one instead, and is marked further down.
    const code = sourceLanguageCodeOfHeading(heading);
    if (!code) continue;
    if (candidate.closest('.source-text')) continue;

    // The source runs to the next structural heading or to the English label.
    const taken: ChildNode[] = [candidate];
    for (let node = candidate.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (/^H[1-6]$/.test(el.tagName) || languageLabelOf(el)) break;
      }
      taken.push(node);
    }

    const wrapper = doc.createElement('div');
    wrapper.className = 'source-text';
    // The language travels with the column so a future reader can style or cite it
    // without re-parsing the heading.
    wrapper.setAttribute('data-lang', code);
    detected ??= code;
    candidate.parentNode?.insertBefore(wrapper, candidate);
    for (const node of taken) wrapper.appendChild(node);

    // The 'English:' heading only means anything while the source sits beside it;
    // marking it lets the reader hide it with the source.
    const next = wrapper.nextSibling;
    if (next && next.nodeType === Node.ELEMENT_NODE) {
      (next as Element).classList.add('translation-label');
    }
  }

  // The first source language in the document names the work's source column for
  // the reader's switch: a Latin work offers 'Show Latin', a German one 'Show German'.
  return detected;
};

/** The translator's own working note for a page, e.g. `*confidence: medium | ...*`. */
const CONFIDENCE_PREFIX = /^confidence\s*:/i;

/**
 * A paragraph that is a single italic run starting with `confidence:` — the
 * translator's record of how the page was read, how sure they are, and what they
 * corrected.
 *
 * This is working apparatus, not the work. A reader who hides the source language
 * is asking to read the translation as a book, so these go with it. Genuine notes
 * that belong to the manuscript — `[in red]`, `[large red initial]`, `[later
 * hand, ...]` — sit inside the English prose and are left exactly as they are.
 */
const isEditorialNote = (el: Element | null): boolean => {
  if (!el || el.tagName !== 'P' || el.children.length !== 1) return false;
  const only = el.children[0] as Element;
  if (only.tagName !== 'EM') return false;
  return CONFIDENCE_PREFIX.test((el.textContent ?? '').trim());
};

/** Wrap those notes so the reader can hide them with the source column. */
const markEditorialNotes = (body: HTMLElement): void => {
  const doc = body.ownerDocument;
  for (const candidate of Array.from(body.querySelectorAll('p'))) {
    if (!isEditorialNote(candidate)) continue;
    if (candidate.parentElement?.classList.contains('editorial-note')) continue;
    const wrapper = doc.createElement('div');
    wrapper.className = 'editorial-note';
    candidate.parentNode?.insertBefore(wrapper, candidate);
    wrapper.appendChild(candidate);
  }
};

export async function makeMarkdownBook(file: File): Promise<BookDoc> {
  const text = await file.text();
  // The frontmatter block is stripped before rendering so it does not show up
  // as a stray `<hr>` + text; its keys become the book's metadata (issue #5279).
  const { body, fields } = parseFrontmatter(text);
  const { metadata: frontmatter, coverBlob } = frontmatterToMetadata(fields);
  const rawHtml = await markdown.parse(body);
  const safeHtml = sanitizeHtml(rawHtml);
  const docBody = new DOMParser().parseFromString(safeHtml, 'text/html').body;

  const sourceLanguage = markTranslationColumns(docBody);
  markEditorialNotes(docBody);

  // Lift the collected footnote definitions out before anything else looks at
  // the document: they are re-emitted per chapter below, and taking them out
  // here also keeps the generated "Footnotes" heading out of the TOC.
  const footnoteDefs = extractFootnoteDefs(docBody);

  // Ensure every id is unique (including author-provided ids on raw HTML /
  // footnotes), then give each heading a stable slug id for TOC anchors and
  // internal-link resolution.
  const usedIds = new Set<string>();
  for (const el of Array.from(docBody.querySelectorAll('[id]'))) {
    if (el.id) usedIds.add(el.id);
  }
  const uniqueId = (base: string): string => {
    let id = base;
    let n = 1;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };
  // All six Markdown heading levels, so the TOC mirrors the document outline in
  // full and deep headings stay linkable by anchor (issue #5357).
  const headingEls = Array.from(docBody.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  for (const h of headingEls) {
    if (!h.id) h.id = uniqueId(slugify(h.textContent ?? ''));
  }

  // Split the top-level nodes into sections at heading boundaries. Content
  // before the first heading of that level becomes a leading preamble section
  // (only when it has real content).
  //
  // The level is the shallowest one that actually structures the document, i.e.
  // the first level carrying at least two headings. Splitting only on <h1> would
  // leave a very common shape as one enormous section: a single <h1> title with
  // its real structure in <h2>s (generated translations using "## Page N", for
  // example). One section means no per-chapter TOC, no reading progress and — the
  // reason this matters — a content search that returns one undifferentiated blob
  // instead of per-section results.
  const structuralHeadingLevel = (() => {
    for (let level = 1; level <= 6; level++) {
      const tag = `H${level}`;
      const count = Array.from(docBody.childNodes).filter(
        (node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === tag,
      ).length;
      if (count >= 2) return level;
    }
    // Fewer than two headings anywhere: a single section either way.
    return 1;
  })();
  const structuralHeadingTag = `H${structuralHeadingLevel}`;
  const hasContent = (nodes: ChildNode[]): boolean =>
    nodes.some(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE ||
        (n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim()),
    );
  const groups: ChildNode[][] = [];
  let current: ChildNode[] = [];
  for (const node of Array.from(docBody.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === structuralHeadingTag) {
      if (hasContent(current)) groups.push(current);
      current = [node];
    } else {
      current.push(node);
    }
  }
  if (hasContent(current)) groups.push(current);
  if (groups.length === 0) groups.push([]);

  // Give each chapter its own endnote list, numbered from 1, so a reference in
  // chapter 2 resolves within chapter 2 instead of jumping to the end of the
  // book. Must run before the ids below are mapped to sections.
  groups.forEach((nodes, index) => {
    const notes = buildChapterFootnotes(nodes, index, footnoteDefs, uniqueId);
    if (notes) nodes.push(notes);
  });

  // Serialize each section to well-formed XHTML. Marked emits HTML5 void tags
  // (<br>, <hr>, <img>) that are parse errors under application/xhtml+xml, so
  // XMLSerializer (not innerHTML) is required. Map every id to its section.
  const serializer = new XMLSerializer();
  const idMap = new Map<string, number>();
  const xhtml = groups.map((nodes, index) => {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (el.id) idMap.set(el.id, index);
      for (const child of Array.from(el.querySelectorAll('[id]'))) {
        if (child.id) idMap.set(child.id, index);
      }
    }
    return wrapXhtml(nodes.map((n) => serializer.serializeToString(n)).join(''));
  });

  // Build a nested heading outline as the TOC, each entry linking to its
  // section index plus heading anchor.
  const root: TocNode[] = [];
  const stack: { level: number; subitems: TocNode[] }[] = [{ level: 0, subitems: root }];
  for (const h of headingEls) {
    const label = (h.textContent ?? '').trim();
    if (!label) continue;
    const level = Number(h.tagName.slice(1));
    const item: TocNode = { label, href: `${idMap.get(h.id) ?? 0}#${h.id}`, subitems: [] };
    while (stack[stack.length - 1]!.level >= level) stack.pop();
    stack[stack.length - 1]!.subitems.push(item);
    stack.push({ level, subitems: item.subitems! });
  }
  const prune = (items: TocNode[]): TocNode[] =>
    items.map(({ label, href, subitems }) => ({
      label,
      href,
      subitems: subitems && subitems.length ? prune(subitems) : undefined,
    }));
  const toc = prune(root);

  // The same transform pipeline EPUB/MOBI content goes through: the reader
  // attaches its content transformers (proofread, simplecc, punctuation, ...)
  // to `book.transformTarget`, and the paginator renders `loadContent()` via
  // srcdoc when it is defined. Transformed content is cached per section and
  // invalidated by unload() (the paginator unloads a section whenever its view
  // is destroyed, e.g. on the viewer recreation a proofread rule change
  // triggers), so rule changes show up on the next load. createDocument()
  // stays raw, mirroring EPUB: TTS replays this same pipeline itself, and a
  // pre-transformed document would double-apply the transformers.
  const transformTarget = new EventTarget();
  const transformed: (string | undefined)[] = new Array(xhtml.length).fill(undefined);
  const transformSection = async (index: number): Promise<string> => {
    const cached = transformed[index];
    if (cached !== undefined) return cached;
    const str = xhtml[index]!;
    let result = str;
    try {
      const detail: { data: string | Promise<string>; type: string } = {
        data: str,
        type: 'application/xhtml+xml',
      };
      // Readonly, mirroring foliate's Loader.createURL dispatch. Selection
      // scoped proofread rules compare their TOC-style sectionHref
      // ("<index>#<anchor>") against this name via split('#')[0].
      Object.defineProperty(detail, 'name', { value: String(index) });
      transformTarget.dispatchEvent(new CustomEvent('data', { detail }));
      const out = await detail.data;
      // '' is the reader transform handler's error fallback.
      if (typeof out === 'string' && out) result = out;
    } catch {
      // Keep the raw section on any transform failure.
    }
    transformed[index] = result;
    return result;
  };

  const urls: (string | undefined)[] = new Array(xhtml.length).fill(undefined);
  const sections: MarkdownSection[] = xhtml.map((str, index) => ({
    id: String(index),
    // A per-section spine CFI base. foliate-js builds location CFIs as
    // `section.cfi ?? CFI.fake.fromIndex(index)`; an empty string defeats that
    // `??` fallback, so every saved position would collapse to a section-less
    // CFI and reopening would resume from the start. Set the same fake spine
    // CFI foliate would synthesize so positions round-trip across reopens.
    cfi: CFI.fake.fromIndex(index),
    size: new TextEncoder().encode(str).length,
    linear: 'yes',
    load: () => {
      if (urls[index] === undefined) {
        urls[index] = URL.createObjectURL(new Blob([str], { type: 'application/xhtml+xml' }));
      }
      return urls[index]!;
    },
    loadContent: () => transformSection(index),
    unload: () => {
      transformed[index] = undefined;
    },
    loadText: async () => str,
    createDocument: async () => new DOMParser().parseFromString(str, 'application/xhtml+xml'),
  }));

  // The filename is the title unless frontmatter — an explicit metadata block —
  // says otherwise. A heading is body content: preferring the first <h1> made
  // every note whose first line is a heading import under that heading instead
  // of its own name, and the <h1> was matched by tag name rather than position,
  // so one buried mid-document could win even when the file opened with an <h2>.
  const title = frontmatter.title || file.name.replace(/\.(?:md|markdown)$/i, '');

  const book = {
    metadata: {
      author: '',
      language: 'en',
      ...frontmatter,
      // The language the source column is written in, read off the document's own
      // column headings. It names the reader's 'Show <language>' switch, so a German
      // work never offers to hide 'Latin'. A declared frontmatter value is only a
      // fallback: what the headings actually say is the truth about the column.
      sourceLanguage: sourceLanguage ?? frontmatter.sourceLanguage,
      title,
      // A frontmatter identifier — an explicit one, else the ISBN — makes the
      // same book import to the same `metaHash` from any copy of the file. With
      // neither, the filename stays the identifier, so books already in the
      // library keep the hash they were imported under.
      identifier: frontmatter.identifier || frontmatter.isbn || file.name,
    },
    rendition: { layout: 'reflowable' as const },
    dir: 'ltr',
    toc,
    sections,
    transformTarget,
    splitTOCHref: (href: string): string[] => (href ? href.split('#') : []),
    getTOCFragment: (doc: Document, id: string): Element | null => doc.getElementById(id),
    resolveHref: (href: string) => {
      const [a, b] = href.split('#');
      if (a) {
        const index = Number(a);
        if (!Number.isInteger(index) || index < 0 || index >= sections.length) return null;
        return { index, anchor: (doc: Document) => (b ? doc.getElementById(b) : null) };
      }
      if (!b) return null;
      const index = idMap.get(b);
      if (index === undefined) return null;
      return { index, anchor: (doc: Document) => doc.getElementById(b) };
    },
    isExternal: (uri: string): boolean => isExternalUri(uri),
    getCover: async (): Promise<Blob | null> => coverBlob,
    destroy: () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    },
  };

  return book as unknown as BookDoc;
}
