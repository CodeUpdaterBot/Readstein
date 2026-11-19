import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { GATEWAY_MODELS } from '../constants';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

/**
 * OpenRouter, served from the slot the AI Gateway option used to occupy.
 *
 * The Gateway provider talked to Readest's own hosted service: it built a Vercel gateway
 * client, and its health check posted to `/api/ai/chat` — a route that exists only in the
 * hosted web app. There is no such route in this app, so the option could not work here. It
 * was Readest's, not Readstein's.
 *
 * The provider id stays `ai-gateway` and the settings keys keep their names, so nothing else
 * in the app has to change — only what this provider talks to. The key that used to hold a
 * gateway key now holds an OpenRouter API token.
 *
 * The stored defaults already fit OpenRouter: its model ids are `vendor/model`, and the
 * defaults are `google/gemini-2.5-flash-lite` and `openai/text-embedding-3-small`, both of
 * which are valid OpenRouter ids. Nothing already saved is rewritten.
 */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class AIGatewayProvider implements AIProvider {
  id: AIProviderName = 'ai-gateway';
  name = 'OpenRouter';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createOpenAICompatible>;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.aiGatewayApiKey) {
      throw new Error('OpenRouter API token required');
    }
    this.client = createOpenAICompatible({
      name: 'openrouter',
      baseURL: OPENROUTER_BASE_URL,
      apiKey: settings.aiGatewayApiKey,
    });
    aiLogger.provider.init(
      'openrouter',
      settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE,
    );
  }

  getModel(): LanguageModel {
    const modelId = this.settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE;
    return this.client(modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    const embedModel = this.settings.aiGatewayEmbeddingModel || 'openai/text-embedding-3-small';
    return this.client.embeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.settings.aiGatewayApiKey;
  }

  /**
   * Ask OpenRouter for its model catalogue.
   *
   * The honest check: it proves the token is accepted by the endpoint the requests actually
   * go to, instead of proving that a route on someone else's host exists.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.settings.aiGatewayApiKey) return false;

    try {
      aiLogger.provider.init('openrouter', 'healthCheck: GET /models');
      const httpFetch = getAIFetch();
      const response = await httpFetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${this.settings.aiGatewayApiKey}` },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter responded ${response.status}`);
      }

      aiLogger.provider.init('openrouter', 'healthCheck success');
      return true;
    } catch (e) {
      const error = e as Error;
      aiLogger.provider.error('openrouter', `healthCheck failed: ${error.message}`);
      return false;
    }
  }
}
