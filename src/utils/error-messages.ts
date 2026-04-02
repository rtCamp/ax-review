/**
 * Shared error handling utilities for LLM clients.
 * Provides consistent error enhancement across providers.
 * 
 * @module utils/error-messages
 */

import { LLMError } from '../llm/types';

/**
 * LLM provider type.
 */
type LLMProvider = 'gemini' | 'ollama';

/**
 * Context for error enhancement.
 */
interface ErrorContext {
  model: string;
  timeout?: number;
}

/**
 * Enhance LLM error message with troubleshooting guidance.
 * Provides actionable advice for common LLM API errors.
 */
export function enhanceLLMError(
  provider: LLMProvider,
  error: Error | string,
  context: ErrorContext
): LLMError {
  const message = typeof error === 'string' ? error : error.message;
  const lower = message.toLowerCase();
  const isRetryable = checkIfRetryable(lower);
  const enhanced = buildEnhancedMessage(provider, lower, context);

  return new LLMError(enhanced, typeof error === 'object' ? error : undefined, isRetryable);
}

/**
 * Check if an error is retryable.
 */
function checkIfRetryable(message: string): boolean {
  return (
    message.includes('429') ||
    message.includes('rate') ||
    message.includes('quota') ||
    message.includes('timeout') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('500')
  );
}

/**
 * Build enhanced error message with provider-specific guidance.
 */
function buildEnhancedMessage(
  provider: LLMProvider,
  message: string,
  context: ErrorContext
): string {
  const troubleshooting = getTroubleshootingGuidance(provider, message, context);
  return `${message}\n\nTroubleshooting:\n${troubleshooting}`;
}

/**
 * Get provider-specific troubleshooting guidance.
 */
function getTroubleshootingGuidance(
  provider: LLMProvider,
  message: string,
  context: ErrorContext
): string {
  if (provider === 'gemini') {
    return getGeminiTroubleshooting(message, context);
  }
  return getOllamaTroubleshooting(message, context);
}

/**
 * Gemini-specific troubleshooting guidance.
 */
function getGeminiTroubleshooting(message: string, context: ErrorContext): string {
  if (message.includes('api_key') || message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden')) {
    return (
      '1. Invalid or missing API key\n' +
      '2. Get your API key from: https://aistudio.google.com/apikey\n' +
      '3. Set the api-key input in your workflow\n' +
      '4. Ensure the key has not expired or been revoked'
    );
  }

  if (message.includes('model') || message.includes('not found') || message.includes('404')) {
    return (
      `1. Model '${context.model}' not found\n` +
      '2. Available models: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash\n' +
      '3. Check https://ai.google.dev/models for current model names\n' +
      '4. Update the model input in your workflow'
    );
  }

  if (message.includes('429') || message.includes('rate') || message.includes('quota')) {
    return (
      '1. Rate limit or quota exceeded\n' +
      '2. Free tier: 15 requests/minute, 1500/day\n' +
      '3. Wait a few minutes and retry\n' +
      '4. Consider upgrading at https://ai.google.dev/pricing'
    );
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return (
      `1. Request exceeded ${context.timeout ?? 60000}ms timeout\n` +
      '2. Large PRs may need more time - increase timeout input\n' +
      '3. Reduce batch-size to process fewer files per request\n' +
      '4. Try again during off-peak hours'
    );
  }

  if (message.includes('network') || message.includes('fetch') || message.includes('econn') || message.includes('enotfound')) {
    return (
      '1. Network connectivity issue\n' +
      '2. Check internet connection\n' +
      '3. Verify https://generativelanguage.googleapis.com is accessible\n' +
      '4. Check for firewall or proxy issues'
    );
  }

  return (
    `1. Provider: Gemini\n` +
    `2. Model: ${context.model}\n` +
    `3. Timeout: ${context.timeout ?? 60000}ms\n` +
    '4. Check the error message above for specific details'
  );
}

/**
 * Ollama-specific troubleshooting guidance.
 */
function getOllamaTroubleshooting(message: string, context: ErrorContext): string {
  if (message.includes('401') || message.includes('unauthorized') || message.includes('forbidden') || message.includes('403')) {
    return (
      '1. Invalid or missing API key\n' +
      '2. Get your API key from: https://ollama.com/settings/keys\n' +
      '3. Ensure the key has not expired'
    );
  }

  if (message.includes('404') || message.includes('not found') || message.includes('model')) {
    return (
      `1. Model '${context.model}' not found\n` +
      '2. Check available models at: https://ollama.com/search?c=cloud\n' +
      '3. Try: llama3.2, llama3.1:70b, mistral, deepseek-coder'
    );
  }

  if (message.includes('429') || message.includes('rate') || message.includes('quota')) {
    return (
      '1. Rate limit or quota exceeded\n' +
      '2. Wait a few minutes before retrying\n' +
      '3. Check usage at: https://ollama.com/settings'
    );
  }

  if (message.includes('fetch failed') || message.includes('network') || message.includes('econnrefused')) {
    return (
      '1. Network connectivity issue\n' +
      '2. Check internet connection\n' +
      '3. Verify https://ollama.com is accessible'
    );
  }

  if (message.includes('json') || message.includes('parse') || message.includes('invalid')) {
    return (
      '1. Model returned invalid JSON\n' +
      '2. Try a more capable model: llama3.2, mistral\n' +
      '3. Report issue if persistent'
    );
  }

  return (
    `1. Provider: Ollama Cloud\n` +
    `2. Model: ${context.model}\n` +
    '3. Get API key: https://ollama.com/settings/keys'
  );
}