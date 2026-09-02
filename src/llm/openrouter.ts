/**
 * OpenRouter API client implementation.
 * Uses the OpenAI-compatible REST API via native fetch.
 *
 * @module llm/openrouter
 *
 * @example
 * // Create client
 * const client = new OpenRouterClient({
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   model: 'google/gemini-3.7-flash',
 * });
 *
 * // Analyze diff content
 * const result = await client.analyze(systemPrompt, userPrompt);
 * console.log(result.issues);
 */

import { LLMError, type AnalysisResult, type OpenRouterConfig } from './types';
import { BaseLLMClient } from './base';
import { LLM_LIMITS } from '../constants';
import { recordLLMUsage } from '../utils/llm-usage';

const DEFAULT_MODEL = 'google/gemini-3.7-flash';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

// Raw response shapes (before schema validation)

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenRouterChoice {
  message?: {
    content?: string | null;
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  error?: {
    message?: string;
    code?: number | string;
  };
}

/**
 * OpenRouter client implementing the LLMClient interface.
 *
 * @extends BaseLLMClient
 */
export class OpenRouterClient extends BaseLLMClient {
  public readonly provider = 'openrouter';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  /**
   * Create a new OpenRouter client.
   *
   * @param config - Configuration options
   * @param config.apiKey  - OpenRouter API key (required)
   * @param config.model   - Model slug (default: 'google/gemini-3.7-flash')
   * @param config.baseUrl - API base URL (default: 'https://openrouter.ai/api/v1')
   * @param config.timeout - Request timeout in ms (default: LLM_LIMITS.DEFAULT_TIMEOUT_MS)
   */
  constructor(config: OpenRouterConfig) {
    super();

    if (!config.apiKey) {
      throw new LLMError(
        '[OpenRouter] API key is required. Get your key from https://openrouter.ai/keys',
        undefined,
        false
      );
    }

    if (config.apiKey.length < 10) {
      throw new LLMError(
        `[OpenRouter] API key appears to be invalid (too short: ${config.apiKey.length} chars).`,
        undefined,
        false
      );
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = config.timeout ?? LLM_LIMITS.DEFAULT_TIMEOUT_MS;
  }

  /**
   * Analyze diff content for accessibility issues.
   *
   * @param systemPrompt - WCAG 2.2 expert system prompt
   * @param userPrompt   - Formatted diff with repository context
   * @returns Promise resolving to analysis result with issues and summary
   * @throws LLMError on API failure, timeout, or invalid response
   */
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    try {
      return await this.executeWithRetry(
        async (signal) => {
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
              'HTTP-Referer': `${process.env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${process.env['GITHUB_REPOSITORY'] ?? ''}`.replace(/\/$/, ''),
              'X-Title': process.env['GITHUB_REPOSITORY'] ?? 'ax-review',
            },
            body: JSON.stringify({
              model: this.model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              stream: false,
              temperature: LLM_LIMITS.TEMPERATURE,
              response_format: { type: 'json_object' },
              provider: {
                allow_fallbacks: true,
              },
            }),
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new LLMError(
              `OpenRouter API error ${response.status}: ${response.statusText}. ${errorBody}`,
              undefined,
              this.isRetryableStatus(response.status)
            );
          }

          return response.json() as Promise<OpenRouterResponse>;
        },

        (raw) => {
          recordLLMUsage(
            this.provider,
            this.model,
            raw.usage?.prompt_tokens ?? 0,
            raw.usage?.completion_tokens ?? 0
          );

          const content = raw.choices?.[0]?.message?.content;

          if (!content) {
            throw new LLMError(
              'OpenRouter returned an empty response. ' +
              'The model may not support json_object response format. Try a different model.',
              undefined,
              false
            );
          }

          return content;
        },
        (error) => this.isRetryableError(error),
        'OpenRouter'
      );
    } catch (error) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const enhanced = this.enhanceErrorMessage(originalMessage);

      if (error instanceof LLMError) {
        throw new LLMError(enhanced, error.originalError, error.isRetryable);
      }
      throw new LLMError(enhanced, error instanceof Error ? error : undefined, false);
    }
  }

  /**
   * Validate that the OpenRouter API key is working by listing available models.
   */
  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Determine if a non-2xx HTTP status code is worth retrying.
   */
  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Determine if an error thrown during the request is retryable.
   */
  private isRetryableError(error: Error): boolean {
    if (error instanceof LLMError) {
      return error.isRetryable;
    }
    const msg = error.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate') ||
      msg.includes('quota') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('network') ||
      msg.includes('fetch failed') ||
      error.name === 'AbortError'
    );
  }

  /**
   * Add actionable troubleshooting hints to error messages.
   */
  private enhanceErrorMessage(original: string): string {
    const lower = original.toLowerCase();

    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key') || lower.includes('403')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Check that your OpenRouter API key is set correctly\n` +
        `2. Verify the key is valid at https://openrouter.ai/keys\n` +
        `3. Ensure the key has not expired or been revoked`
      );
    }

    if (lower.includes('404') || lower.includes('not found') || lower.includes('model')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Model '${this.model}' may not be available on OpenRouter\n` +
        `2. Browse available models at https://openrouter.ai/models\n` +
        `3. Update the 'model' input in your workflow to a valid slug (e.g. google/gemini-3.7-flash)`
      );
    }

    if (lower.includes('429') || lower.includes('rate') || lower.includes('quota')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Rate limit or quota exceeded\n` +
        `2. Wait a few minutes before retrying\n` +
        `3. Check your usage and limits at https://openrouter.ai/account`
      );
    }

    if (lower.includes('timeout') || lower.includes('abort') || lower.includes('etimedout')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. The request timed out after ${this.timeout}ms\n` +
        `2. Large PRs may need more time — reduce 'batch-size'\n` +
        `3. Try a faster model (e.g. google/gemini-3.5-flash-lite, openai/gpt-4o-mini)`
      );
    }

    if (lower.includes('fetch') || lower.includes('network') || lower.includes('econnrefused') || lower.includes('enotfound')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Network connectivity issue — check internet connection\n` +
        `2. Verify https://openrouter.ai is accessible from your runner\n` +
        `3. Check if a firewall or proxy is blocking the request`
      );
    }

    if (lower.includes('json') || lower.includes('parse')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. The model did not return valid JSON\n` +
        `2. Some models ignore response_format — try google/gemini-3.7-flash or openai/gpt-4o-mini\n` +
        `3. Reduce 'batch-size' so the prompt fits within the model's context window`
      );
    }

    return (
      `${original}\n\nTroubleshooting:\n` +
      `1. Provider: OpenRouter\n` +
      `2. Model: ${this.model}\n` +
      `3. Timeout: ${this.timeout}ms\n` +
      `4. Check https://openrouter.ai/docs for API status and known issues`
    );
  }
}
