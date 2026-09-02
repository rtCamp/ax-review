/**
 * LLM client factory - creates the appropriate client based on provider.
 * This is the entry point for hot-swapping LLM providers.
 * 
 * @module llm/index
 */

import type { LLMProvider } from '../types';
import type { LLMClient, GeminiConfig, OllamaConfig, OpenRouterConfig } from './types';
import { GeminiClient } from './gemini';
import { OllamaClient } from './ollama';
import { OpenRouterClient } from './openrouter';
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
  config: GeminiConfig | OllamaConfig | OpenRouterConfig
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
    case 'openrouter': {
      if (!('apiKey' in config) || !config.apiKey) {
        throw new LLMError('OpenRouter provider requires an API key', undefined, false);
      }
      return new OpenRouterClient(config as OpenRouterConfig);
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = provider;
      throw new LLMError(
        `Unknown LLM provider: ${String(_exhaustiveCheck)}. Supported providers: gemini, ollama, openrouter`,
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
      return 'gemini-3.7-flash';
    case 'ollama':
      return 'minimax-m2.7:cloud';
    case 'openrouter':
      return 'google/gemini-3.7-flash';
    default:
      return 'gemini-3.7-flash';
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
): GeminiConfig | OllamaConfig | OpenRouterConfig {
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
    case 'openrouter': {
      if (!apiKey) {
        throw new LLMError(
          'OpenRouter requires an API key. Get your key from https://openrouter.ai/keys',
          undefined,
          false
        );
      }
      return {
        apiKey,
        model: model ?? getDefaultModel(provider),
      };
    }
    default:
      // This should never happen due to TypeScript narrowing
      throw new LLMError(`Unknown provider: ${provider}`, undefined, false);
  }
}
