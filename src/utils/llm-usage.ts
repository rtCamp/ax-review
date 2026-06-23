/**
 * Lightweight LLM token usage tracking.
 *
 * Used for cost estimation only.
 * Logs aggregate token usage across all requests made during a workflow run.
 *
 * @module utils/llm-usage
 */

import * as core from '@actions/core';

interface LLMUsage {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const usage: LLMUsage = {
  provider: 'Undefined',
  model: 'Undefined',
  promptTokens: 0,
  completionTokens: 0,
};

/**
 * Record token usage from a single LLM request.
 *
 * @param promptTokens - Input tokens processed
 * @param completionTokens - Output tokens generated
 */
export function recordLLMUsage(
  provider: string,
  model: string,
  promptTokens = 0,
  completionTokens = 0
): void {
  usage.provider = provider;
  usage.model = model;
  usage.promptTokens += promptTokens;
  usage.completionTokens += completionTokens;
}

/**
 * Log aggregate token usage for the current workflow run.
 */
export function logLLMUsage(): void {
  const totalTokens = usage.promptTokens + usage.completionTokens;

  core.info('=== LLM Usage Summary ===');
  core.info(`Provider: ${usage.provider}`);
  core.info(`Model: ${usage.model}`);
  core.info(`Prompt Tokens: ${usage.promptTokens}`);
  core.info(`Completion Tokens: ${usage.completionTokens}`);
  core.info(`Total Tokens: ${totalTokens}`);
  core.info('=========================');
}

/**
 * Reset usage counters.
 * Primarily useful for tests.
 */
export function resetLLMUsage(): void {
  usage.provider = 'Undefined';
  usage.model = 'Undefined';
  usage.promptTokens = 0;
  usage.completionTokens = 0;
}
