// Medium clips (~500–1000 chars, ~40–80s of speech): long enough that playback
// of clip N covers generating clip N+1 on WASM, without sending a whole page
// in one generate. Hard cap is 1000; pack fills toward that on sentence
// boundaries so typical clips land in the 500–1000 range.
export const KOKORO_MAX_CHARS = 1000;

// Phone CPU cannot finish a 1000-char Kokoro generate before the previous
// clip ends (RTF often > 1). Short clips start sooner and keep the buffer
// ahead even on Kitten.
export const SHERPA_MAX_CHARS = 220;

const SENTENCE_RE = /(?<=[.!?])\s+/;
const CLAUSE_RE = /(?<=[;:—–-])\s+/;
const COMMA_RE = /(?<=,)\s+/;

const wrapWords = (text: string, max: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const word of words) {
    if (!buf) {
      if (word.length <= max) {
        buf = word;
      } else {
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
      }
      continue;
    }
    if (`${buf} ${word}`.length <= max) {
      buf = `${buf} ${word}`;
    } else {
      out.push(buf);
      buf = word.length <= max ? word : '';
      if (word.length > max) {
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
      }
    }
  }
  if (buf) out.push(buf);
  return out;
};

const pack = (pieces: string[], max: number): string[] => {
  const out: string[] = [];
  let buf = '';
  for (const piece of pieces) {
    const part = piece.trim();
    if (!part) continue;
    if (part.length > max) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(...wrapWords(part, max));
      continue;
    }
    if (!buf) {
      buf = part;
      continue;
    }
    if (`${buf} ${part}`.length <= max) {
      buf = `${buf} ${part}`;
    } else {
      out.push(buf);
      buf = part;
    }
  }
  if (buf) out.push(buf);
  return out;
};

const splitLongPiece = (text: string, max: number): string[] => {
  if (text.length <= max) return [text];
  const clauses = text
    .split(CLAUSE_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  if (clauses.length > 1) return clauses.flatMap((c) => splitLongPiece(c, max));
  const commas = text
    .split(COMMA_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  if (commas.length > 1) return commas.flatMap((c) => splitLongPiece(c, max));
  return wrapWords(text, max);
};

/**
 * Split book text into medium Kokoro utterances (≤ maxChars).
 */
export const splitKokoroUtterances = (
  text: string,
  maxChars: number = KOKORO_MAX_CHARS,
): string[] => {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed
    .split(SENTENCE_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const pieces = (sentences.length > 1 ? sentences : [trimmed]).flatMap((piece) =>
    splitLongPiece(piece, maxChars),
  );
  return pack(pieces, maxChars);
};
