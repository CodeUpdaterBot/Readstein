import { embedMany } from 'ai';
import { getAIProvider } from '@/services/ai/providers';
import type { AISettings } from '@/services/ai/types';
import { AI_RETRY_CONFIGS, AI_TIMEOUTS, withRetryAndTimeout } from '@/services/ai/utils/retry';
import {
  EMBEDDING_BATCH_SIZE,
  LOCAL_EMBEDDING_BATCH_SIZE,
  planEmbeddingRequests,
} from './embeddingBatching';
import type { ChatModel } from './ChatModel';
import type { EmbeddingModel } from './EmbeddingModel';

/**
 * Pair of (chat, embedding) models the agent runtime uses for one turn.
 * Both come from the user's currently active AIProvider, just rewrapped to
 * the narrower Reedy interfaces so the runtime depends on metadata-bearing
 * shapes rather than the provider-shape that still serves the legacy path.
 */
export interface ReedyModels {
  chat: ChatModel;
  embedding: EmbeddingModel;
}

export function createReedyModels(settings: AISettings): ReedyModels {
  const provider = getAIProvider(settings);
  return {
    chat: adaptChatModel(provider.getModel(), chatModelIdFor(settings)),
    embedding: adaptEmbeddingModel(
      provider.getEmbeddingModel(),
      embeddingModelIdFor(settings),
      settings,
    ),
  };
}

// ---------------------------------------------------------------------------
// ChatModel adapter
// ---------------------------------------------------------------------------

/**
 * Per-model context-window metadata. Hardcoded because the Vercel SDK's
 * LanguageModel interface doesn't expose this — the SDK serializes the
 * model id and lets the provider decide. We keep a small table here keyed
 * on either the provider model id or a substring; unknown models get a
 * conservative default.
 *
 * Values from each provider's docs as of 2026-05; refresh as new families
 * land. Tokens are claimed maxes — for prompt budgeting we subtract
 * `reservedOutput` and a safety margin upstream in PromptContextBuilder.
 */
const CONTEXT_WINDOW_TABLE: Array<{
  match: (id: string) => boolean;
  contextWindow: number;
  reservedOutput: number;
  supportsTools: boolean;
}> = [
  // Google
  {
    match: (id) => id.includes('gemini-2.5') || id.includes('gemini-3'),
    contextWindow: 2_000_000,
    reservedOutput: 8_192,
    supportsTools: true,
  },
  // OpenAI
  {
    match: (id) => id.includes('gpt-5') || id.includes('gpt-4.1') || id.includes('gpt-4o'),
    contextWindow: 128_000,
    reservedOutput: 4_096,
    supportsTools: true,
  },
  // Anthropic
  {
    match: (id) => id.includes('claude-opus') || id.includes('claude-sonnet'),
    contextWindow: 200_000,
    reservedOutput: 8_192,
    supportsTools: true,
  },
  // Meta
  {
    match: (id) => id.includes('llama-4') || id.includes('llama-3.3'),
    contextWindow: 128_000,
    reservedOutput: 2_048,
    supportsTools: true,
  },
  // DeepSeek + Qwen + Grok — all support tool calls in the 2025+ generations
  {
    match: (id) => id.includes('deepseek-v3') || id.includes('qwen-3') || id.includes('grok-4'),
    contextWindow: 128_000,
    reservedOutput: 2_048,
    supportsTools: true,
  },
  // Local Ollama defaults — most models default to a 4K ctx unless the
  // user sets Modelfile params. Tool support varies; treat as off.
  {
    match: (id) => id.startsWith('llama') || id.includes('mistral') || id.includes('phi'),
    contextWindow: 4_096,
    reservedOutput: 1_024,
    supportsTools: false,
  },
];

const DEFAULT_CHAT_METADATA = {
  contextWindow: 8_192,
  reservedOutput: 1_024,
  supportsTools: false,
};

function adaptChatModel(languageModel: import('ai').LanguageModel, id: string): ChatModel {
  const meta = CONTEXT_WINDOW_TABLE.find((row) => row.match(id)) ?? DEFAULT_CHAT_METADATA;
  return {
    id,
    contextWindow: meta.contextWindow,
    reservedOutput: meta.reservedOutput,
    supportsTools: meta.supportsTools,
    getLanguageModel: () => languageModel,
  };
}

function chatModelIdFor(settings: AISettings): string {
  switch (settings.provider) {
    case 'ollama':
      return settings.ollamaModel || 'llama3.2';
    case 'ai-gateway':
      return (
        settings.aiGatewayCustomModel || settings.aiGatewayModel || 'google/gemini-2.5-flash-lite'
      );
    case 'openrouter':
      return settings.openrouterModel || 'gpt-5.6-luna';
  }
}

// ---------------------------------------------------------------------------
// EmbeddingModel adapter
// ---------------------------------------------------------------------------

function adaptEmbeddingModel(
  vercelModel: import('ai').EmbeddingModel,
  id: string,
  settings: AISettings,
): EmbeddingModel {
  // Local engines want small batches; hosted providers take the planned slice.
  // Either way `planEmbeddingRequests` re-splits every call so no single HTTP
  // request can exceed the provider's input or aggregate-token limits.
  const batchSize =
    settings.provider === 'ollama' ? LOCAL_EMBEDDING_BATCH_SIZE : EMBEDDING_BATCH_SIZE;
  let dim: number | null = null;
  return {
    id,
    get dim(): number {
      if (dim == null) {
        throw new Error('embedding dim unknown — call embed([sample]) once before reading dim');
      }
      return dim;
    },
    batchSize,
    async embed(texts, opts) {
      if (texts.length === 0) return [];
      const vectors: number[][] = [];
      for (const group of planEmbeddingRequests(texts)) {
        // Retry + timeout per REQUEST, so a transient 429/5xx on a long
        // unattended sweep costs one batch rather than the whole book — and a
        // hung request cannot stall the run. Aborts pass straight through.
        const batch = await withRetryAndTimeout(
          () =>
            embedMany({
              model: vercelModel,
              values: group,
              abortSignal: opts?.signal,
            }),
          AI_TIMEOUTS.EMBEDDING_BATCH,
          AI_RETRY_CONFIGS.EMBEDDING,
        );
        if (batch.embeddings.length !== group.length) {
          throw new Error(
            `embedding model returned ${batch.embeddings.length} vectors for ${group.length} inputs`,
          );
        }
        if (dim == null && batch.embeddings.length > 0) dim = batch.embeddings[0]!.length;
        vectors.push(...batch.embeddings);
      }
      return vectors;
    },
  };
}

function embeddingModelIdFor(settings: AISettings): string {
  switch (settings.provider) {
    case 'ollama':
      return settings.ollamaEmbeddingModel || 'nomic-embed-text';
    case 'ai-gateway':
      return settings.aiGatewayEmbeddingModel || 'openai/text-embedding-3-small';
    case 'openrouter':
      return settings.openrouterEmbeddingModel || 'openai/text-embedding-3-small';
  }
}
