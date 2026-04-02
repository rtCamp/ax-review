/**
 * LLM client factory - creates the appropriate client based on provider.
 * This is the entry point for hot-swapping LLM providers.
 * 
 * @module llm/index
 */

import type { LLMProvider } from '../types';
import type { LLMClient, GeminiConfig, OllamaConfig } from './types';
import { GeminiClient } from './gemini';
import { OllamaClient } from './ollama';
import { LLMError } from './types';

/**
 * Create an LLM client based on the provider configuration.
 * 
 * @param provider - The LLM provider to use
 * @param config - Provider-specific configuration
 * @returns An LLM client instance
 * @throws LLMError if the provider is not supported
 */
export function createLLMClient(
  provider: LLMProvider,
  config: GeminiConfig | OllamaConfig
): LLMClient {
  switch (provider) {
    case 'gemini': {
      if (!('apiKey' in config) || !config.apiKey) {
        throw new LLMError('Gemini provider requires an API key', undefined, false);
      }
      return new GeminiClient(config as GeminiConfig);
    }
    case 'ollama': {
      return new OllamaClient(config as OllamaConfig);
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = provider;
      throw new LLMError(
        `Unknown LLM provider: ${String(_exhaustiveCheck)}. Supported providers: gemini, ollama`,
        undefined,
        false
      );
    }
  }
}

/**
 * Get default model for a provider.
 */
export function getDefaultModel(provider: LLMProvider): string {
  switch (provider) {
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'ollama':
      return 'llama3.2';
    default:
      return 'gemini-2.0-flash';
  }
}

/**
 * Build configuration for a provider from action inputs.
 */
export function buildLLMConfig(
  provider: LLMProvider,
  apiKey: string | undefined,
  model: string | undefined,
  ollamaUrl: string
): GeminiConfig | OllamaConfig {
  switch (provider) {
    case 'gemini': {
      return {
        apiKey: apiKey ?? '', // Validation happens in parseInputs
        model: model ?? getDefaultModel(provider),
      };
    }
    case 'ollama': {
      if (!apiKey) {
        throw new LLMError(
          'Ollama Cloud requires an API key. Get your key from https://ollama.com/settings/keys',
          undefined,
          false
        );
      }
      return {
        baseUrl: ollamaUrl,
        model: model ?? getDefaultModel(provider),
        apiKey,
      };
    }
    default:
      // This should never happen due to TypeScript narrowing
      throw new LLMError(`Unknown provider: ${provider}`, undefined, false);
  }
}