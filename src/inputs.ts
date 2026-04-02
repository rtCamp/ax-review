/**
 * Input parsing and validation for the GitHub Action.
 * Handles conversion from action.yml inputs to typed configuration.
 * 
 * @module inputs
 */

import * as core from '@actions/core';
import type { ActionConfig, LLMProvider, OutputMode } from './types';
import { LLM_LIMITS, GITHUB_LIMITS, ACTION_DEFAULTS } from './constants';
import { validateApiKey, validateUrl, validateModelName } from './utils/validation';

/**
 * Parses and validates all action inputs.
 * Returns a typed configuration object or throws on validation failure.
 * 
 * @returns Validated action configuration
 * @throws Error if required inputs are missing or invalid
 */
export function parseInputs(): ActionConfig {
  const githubToken = getRequiredInput('github-token', 'GitHub token is required');
  const llmProvider = parseLLMProvider(getInput('llm-provider', ACTION_DEFAULTS.LLM_PROVIDER));
  const outputMode = parseOutputMode(getInput('output-mode', ACTION_DEFAULTS.OUTPUT_MODE));
  const failOnIssues = getBooleanInput('fail-on-issues', true);
  const maxFiles = getNumberInput('max-files', GITHUB_LIMITS.DEFAULT_MAX_FILES);
  const batchSize = getNumberInput('batch-size', LLM_LIMITS.DEFAULT_BATCH_SIZE);
  const skipDrafts = getBooleanInput('skip-drafts', true);

  // Log configuration (without exposing secrets)
  core.info(`Configuration: provider=${llmProvider}, model=${getInput('model', 'default')}, output=${outputMode}`);

  // Provider-specific validation using utilities
  const apiKey = validateApiKey(getInput('api-key', ''), llmProvider === 'gemini' ? 20 : 10);
  const ollamaUrl = validateUrl(getInput('ollama-url', ACTION_DEFAULTS.OLLAMA_URL));
  const model = validateModelName(getInput('model', ''));

  // Log configuration status (without exposing secrets)
  if (apiKey) {
    core.info('API key configured');
  }

  validateProviderConfig(llmProvider, apiKey);

  return {
    githubToken,
    llmProvider,
    apiKey: apiKey || undefined,
    model: model || undefined,
    ollamaUrl,
    outputMode,
    failOnIssues,
    maxFiles,
    batchSize,
    skipDrafts,
  };
}

function getRequiredInput(name: string, errorMessage: string): string {
  const value = core.getInput(name, { required: true });
  if (!value || value.trim() === '') {
    throw new Error(errorMessage);
  }
  return value.trim();
}

function getInput(name: string, defaultValue: string): string {
  const value = core.getInput(name, { required: false });
  return value.trim() || defaultValue;
}

function getBooleanInput(name: string, defaultValue: boolean): boolean {
  const value = core.getInput(name);
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getNumberInput(name: string, defaultValue: number): number {
  const value = core.getInput(name);
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(`Input '${name}' must be a non-negative integer, got: ${value}`);
  }
  return parsed;
}

function parseLLMProvider(value: string): LLMProvider {
  const normalized = value.toLowerCase().trim();
  if (normalized !== 'gemini' && normalized !== 'ollama') {
    throw new Error(`Invalid llm-provider '${value}'. Must be 'gemini' or 'ollama'.`);
  }
  return normalized;
}

function parseOutputMode(value: string): OutputMode {
  const normalized = value.toLowerCase().trim();
  if (normalized !== 'comments' && normalized !== 'checks') {
    throw new Error(`Invalid output-mode '${value}'. Must be 'comments' or 'checks'.`);
  }
  return normalized;
}

function validateProviderConfig(provider: LLMProvider, apiKey?: string): void {
  if (provider === 'gemini') {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        "API key is required when using 'gemini' provider. " +
        "Get your API key from https://aistudio.google.com/apikey and set the 'api-key' input."
      );
    }
    if (apiKey.length < 20) {
      throw new Error(
        "The provided Gemini API key appears to be invalid. " +
        "Gemini API keys are typically longer strings."
      );
    }
  }

  if (provider === 'ollama') {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        "API key is required when using 'ollama' provider. " +
        "Get your API key from https://ollama.com/settings/keys and set the 'api-key' input."
      );
    }
    if (apiKey.length < 10) {
      throw new Error(
        "The provided Ollama API key appears to be invalid. " +
        "API keys from ollama.com are typically longer strings."
      );
    }
  }
}

export function setOutputs(stats: {
  issuesFound: number;
  violations: number;
  goodPractices: number;
}): void {
  core.setOutput('issues-found', stats.issuesFound.toString());
  core.setOutput('violations', stats.violations.toString());
  core.setOutput('good-practices', stats.goodPractices.toString());
}