/**
 * LiteLLM gateway client implementation.
 * Uses the OpenAI-compatible REST API exposed by a LiteLLM proxy.
 *
 * @module llm/litellm
 *
 * @example
 * // Create client
 * const client = new LiteLLMClient({
 *   apiKey: process.env.LITELLM_API_KEY,
 *   model: 'openrouter/google/gemini-3.7-flash',
 * });
 *
 * // Analyze diff content
 * const result = await client.analyze(systemPrompt, userPrompt);
 * console.log(result.issues);
 */

import { LLMError, type AnalysisResult, type LiteLLMConfig } from './types';
import { BaseLLMClient } from './base';
import { LLM_LIMITS } from '../constants';
import { recordLLMUsage } from '../utils/llm-usage';
import { isRetryableError, isRetryableStatus } from './retry';

const DEFAULT_MODEL = 'openrouter/google/gemini-3.7-flash';
const DEFAULT_BASE_URL = 'https://litellm.rstuff.in/v1';

// Raw response shapes (before schema validation)

interface LiteLLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface LiteLLMChoice {
  message?: {
    content?: string | null;
  };
}

interface LiteLLMResponse {
  choices?: LiteLLMChoice[];
  usage?: LiteLLMUsage;
  error?: {
    message?: string;
    code?: number | string;
  };
}

/**
 * LiteLLM gateway client implementing the LLMClient interface.
 *
 * @extends BaseLLMClient
 */
export class LiteLLMClient extends BaseLLMClient {
  public readonly provider = 'litellm';
  private readonly apiKey: string;
  private readonly model: string;

  /**
   * Create a new LiteLLM gateway client.
   *
   * @param config - Configuration options
   * @param config.apiKey  - LiteLLM API key or master key (required)
   * @param config.model   - Model slug routed by the proxy (default: 'openrouter/google/gemini-3.7-flash')
   * @param config.timeout - Request timeout in ms (default: LLM_LIMITS.DEFAULT_TIMEOUT_MS)
   */
  constructor(config: LiteLLMConfig) {
    super();

    if (!config.apiKey) {
      throw new LLMError(
        '[LiteLLM] API key is required. Set the master key or a virtual key configured in your LiteLLM proxy.',
        undefined,
        false
      );
    }

    if (config.apiKey.length < 10) {
      throw new LLMError(
        `[LiteLLM] API key appears to be invalid (too short: ${config.apiKey.length} chars).`,
        undefined,
        false
      );
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
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
          const response = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
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
            }),
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new LLMError(
              `LiteLLM API error ${response.status}: ${response.statusText}. ${errorBody}`,
              undefined,
              isRetryableStatus(response.status)
            );
          }

          return response.json() as Promise<LiteLLMResponse>;
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
              'LiteLLM returned an empty response. ' +
              'The upstream model may not support json_object response format. Try a different model.',
              undefined,
              false
            );
          }

          return content;
        },
        (error) => isRetryableError(error),
        'LiteLLM'
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
   * Validate the LiteLLM gateway is reachable by calling the models endpoint.
   */
  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch(`${DEFAULT_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Add actionable troubleshooting hints to error messages.
   */
  private enhanceErrorMessage(original: string): string {
    const lower = original.toLowerCase();

    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key') || lower.includes('403')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Check that your LiteLLM API key is set correctly\n` +
        `2. Verify the key is valid in your LiteLLM proxy config\n` +
        `3. Ensure the key has not expired or been revoked`
      );
    }

    if (lower.includes('404') || lower.includes('not found') || lower.includes('model')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Model '${this.model}' may not be configured in your LiteLLM proxy\n` +
        `2. Check the model list at ${DEFAULT_BASE_URL}/models\n` +
        `3. Update the 'model' input to a model slug your proxy exposes (e.g. openrouter/google/gemini-3.7-flash)`
      );
    }

    if (lower.includes('429') || lower.includes('rate') || lower.includes('quota')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Rate limit or quota exceeded on the upstream provider\n` +
        `2. Wait a few minutes before retrying\n` +
        `3. Check your LiteLLM proxy logs for quota details`
      );
    }

    if (lower.includes('timeout') || lower.includes('abort') || lower.includes('etimedout')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. The request timed out after ${this.timeout}ms\n` +
        `2. Large PRs may need more time — reduce 'batch-size'\n` +
        `3. Check that your LiteLLM proxy (${DEFAULT_BASE_URL}) is reachable from the runner`
      );
    }

    if (lower.includes('fetch') || lower.includes('network') || lower.includes('econnrefused') || lower.includes('enotfound')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. Network connectivity issue — check internet connection\n` +
        `2. Verify your LiteLLM proxy (${DEFAULT_BASE_URL}) is accessible from the runner\n` +
        `3. Check if a firewall or proxy is blocking the request`
      );
    }

    if (lower.includes('json') || lower.includes('parse')) {
      return (
        `${original}\n\nTroubleshooting:\n` +
        `1. The upstream model did not return valid JSON\n` +
        `2. Some models ignore response_format — try openrouter/google/gemini-3.7-flash or openrouter/openai/gpt-4o-mini\n` +
        `3. Reduce 'batch-size' so the prompt fits within the model's context window`
      );
    }

    return (
      `${original}\n\nTroubleshooting:\n` +
      `1. Provider: LiteLLM (${DEFAULT_BASE_URL})\n` +
      `2. Model: ${this.model}\n` +
      `3. Timeout: ${this.timeout}ms\n` +
      `4. Check your LiteLLM proxy logs for more details`
    );
  }
}
