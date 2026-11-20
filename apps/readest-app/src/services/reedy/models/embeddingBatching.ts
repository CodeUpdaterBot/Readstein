/**
 * Request planning for the embedding providers.
 *
 * The hosted embedding APIs are bounded three ways at once, and a request that
 * trips any bound fails the whole call (HTTP 400) — losing every chunk in it:
 *
 *   - **2048 inputs** per request (max array length);
 *   - **8192 tokens** per input;
 *   - **300,000 tokens** summed across all inputs in one request.
 *
 * A chunk from `CfiChunker` is ~500–550 characters, so the binding constraint is
 * the *aggregate token* ceiling, not the input count — and how many chunks fit
 * depends on the text: ordinary English runs ~4 chars/token, but dense Latin and
 * OCR'd pages can run near 2–3. Sizing batches on the input count alone would
 * therefore produce requests that are legal in shape and illegal in size.
 *
 * So the batch is planned, not guessed: {@link planEmbeddingRequests} groups
 * texts greedily under **both** a conservative token budget and the input cap.
 * The per-request slice the indexer hands over is a separate, larger number
 * ({@link EMBEDDING_BATCH_SIZE}); the planner is the safety net that keeps every
 * actual HTTP request inside the provider's limits.
 */

/** Hard provider cap: maximum inputs in one embeddings request. */
export const MAX_INPUTS_PER_REQUEST = 2048;

/**
 * Soft ceiling for one request's aggregate tokens. Kept below the documented
 * 300,000 so a mis-estimate on dense text still lands inside the real limit.
 */
export const MAX_TOKENS_PER_REQUEST = 250_000;

/**
 * Chars-per-token used to *estimate* a chunk's cost. Deliberately pessimistic
 * (English is ~4): dense Latin and OCR output tokenize worse, and over-
 * estimating only costs a slightly smaller request, while under-estimating
 * costs the whole request.
 */
export const CHARS_PER_TOKEN_FLOOR = 3;

/**
 * Texts BookIndexer hands to `embed()` in one call, for hosted providers.
 *
 * 512 is the balance point, not the maximum: 512 inputs at ~180 estimated
 * tokens each is ~92k tokens (comfortably inside the budget above), the request
 * body stays small, the response stays ~12 MB rather than ~50 MB at the 2048
 * ceiling, and — the reason not to go bigger — a failed request costs only 512
 * chunks to retry rather than 2048. On this user's ~366k-chunk shelf it means
 * ~715 requests instead of ~23,000 at the old batch of 16.
 */
export const EMBEDDING_BATCH_SIZE = 512;

/** Local engines (Ollama) prefer small batches; keep the historical value. */
export const LOCAL_EMBEDDING_BATCH_SIZE = 4;

/** Estimated token cost of one input, never zero (an input always costs something). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN_FLOOR));
}

/**
 * Split `texts` into provider-legal request groups, preserving order so the
 * caller can concatenate the returned vectors back onto the original inputs.
 *
 * A single text that exceeds the token budget on its own is emitted as its own
 * group: there is no legal way to send it, and the provider will reject that one
 * rather than the whole set.
 */
export function planEmbeddingRequests(texts: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);
    const wouldOverflow =
      current.length >= MAX_INPUTS_PER_REQUEST || currentTokens + tokens > MAX_TOKENS_PER_REQUEST;
    if (current.length > 0 && wouldOverflow) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(text);
    currentTokens += tokens;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
