import type { PromptLayer } from './types';

/**
 * What the library agent knows about the shelf it is answering from.
 * Supplied by the caller as a snapshot (the corpus can change under it).
 */
export interface LibraryManifest {
  /** Number of English works in the indexed corpus. */
  workCount: number;
  /** Representative works, already capped by the caller. */
  sampleTitles: string[];
  /** True when no corpus has been built yet. */
  empty?: boolean;
}

/**
 * Shelf-awareness layer for the library-wide chat (the analogue of
 * `ReadingLayer`, which tells the per-book agent where the reader is).
 *
 * It gives the agent a librarian's view — how many works it has, and which of
 * them exist — so it can say *"your library doesn't cover this"* instead of
 * hallucinating an answer, and can name related works it holds. The actual
 * content still comes from `lookupLibraryPassage`.
 *
 * Expendable: under budget pressure the sample list goes first and the count
 * second, because a missing sample costs a little framing while a missing
 * count costs the agent its sense of scope.
 *
 * Shrink levels:
 *   0: count + sample titles + grounding instruction
 *   1: count + instruction, no titles
 *   2: drop
 */
export function createLibraryLayer(provider: () => LibraryManifest): PromptLayer {
  return {
    name: 'library',
    renderPriority: 25,
    shrinkPriority: 25,
    expendable: true,
    render() {
      return renderFull(provider());
    },
    shrink(level) {
      const manifest = provider();
      if (manifest.empty) return null;
      if (level <= 0) return renderFull(manifest);
      if (level === 1) return renderTerse(manifest);
      return null;
    },
  };
}

const GROUNDING =
  'Answer from the works you retrieve, name the work each point comes from, and if the library does not cover a question, say so plainly instead of answering from general knowledge.';

function renderFull(manifest: LibraryManifest): string | null {
  if (manifest.empty) return null;
  const lines = [
    `The user's personal library contains ${manifest.workCount} English work(s), searchable as one corpus.`,
  ];
  if (manifest.sampleTitles.length > 0) {
    lines.push('Works you hold include:');
    for (const title of manifest.sampleTitles) lines.push(`- ${title}`);
  }
  lines.push(GROUNDING);
  return lines.join('\n');
}

function renderTerse(manifest: LibraryManifest): string {
  return `The user's personal library contains ${manifest.workCount} English work(s), searchable as one corpus. ${GROUNDING}`;
}
