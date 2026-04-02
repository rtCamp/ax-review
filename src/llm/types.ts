/**
 * LLM client interface and configuration types.
 * Defines the abstract interface for hot-swappable LLM providers.
 * 
 * @module llm/types
 */

import type { Confidence, Severity, WcagLevel } from '../types';

/**
 * Result from LLM analysis.
 */
export interface AnalysisResult {
  issues: Array<{
    file: string;
    line: number | null;
    wcag_criterion: string;
    wcag_level: WcagLevel;
    severity: Severity;
    confidence: Confidence;
    title: string;
    description: string;
    impact: string;
    suggestion: string;
  }>;
  summary: string;
}

/**
 * Abstract interface for LLM providers.
 * Implement this interface to add a new provider.
 * 
 * Hot-swap is achieved by:
 * 1. Implement this interface
 * 2. Add provider name to LLMProvider type in src/types.ts
 * 3. Register in src/llm/index.ts factory
 */
export interface LLMClient {
  /** The provider name (e.g., "gemini", "ollama") */
  readonly provider: string;

  /**
   * Analyze diff content for accessibility issues.
   * 
   * @param systemPrompt - WCAG 2.2 expert system prompt
   * @param userPrompt - Formatted diff with repository context
   * @returns Promise resolving to analysis result with issues and summary
   * @throws LLMError on API failure or invalid response
   */
  analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult>;

  /**
   * Check if the client is properly configured.
   * Call this during validation to fail early.
   */
  validateConfig(): Promise<boolean>;
}

/**
 * Configuration for Gemini provider.
 */
export interface GeminiConfig {
  /** Gemini API key (required) */
  apiKey: string;
  /** Model name (default: gemini-2.0-flash) */
  model?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
}

/**
 * Configuration for Ollama Cloud provider.
 */
export interface OllamaConfig {
  /** API key from ollama.com (required for cloud access) */
  apiKey: string;
  /** Model name (default: llama3.2) */
  model?: string;
  /** Ollama Cloud API endpoint (default: https://ollama.com) */
  baseUrl?: string;
}

/**
 * Error class for LLM-specific errors.
 */
export class LLMError extends Error {
  public readonly originalError: Error | undefined;
  public readonly isRetryable: boolean;

  constructor(message: string, originalError?: Error, isRetryable: boolean = false) {
    super(message);
    this.name = 'LLMError';
    this.originalError = originalError;
    this.isRetryable = isRetryable;
  }
}

/**
 * JSON schema for structured LLM response.
 * This ensures we get parseable, consistent output.
 */
export const A11Y_RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    issues: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          wcag_criterion: { type: 'string' },
          wcag_level: { type: 'string', enum: ['A', 'AA', 'AAA'] },
          severity: { type: 'string', enum: ['CRITICAL', 'SERIOUS', 'MODERATE', 'MINOR'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          description: { type: 'string' },
          impact: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['file', 'wcag_criterion', 'wcag_level', 'severity', 'confidence', 'title', 'description', 'impact', 'suggestion'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['issues', 'summary'],
};

/**
 * Validates an LLM response against the expected schema.
 */
export function validateAnalysisResult(data: unknown): data is AnalysisResult {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const result = data as Record<string, unknown>;

  if (!Array.isArray(result['issues'])) {
    return false;
  }

  if (typeof result['summary'] !== 'string') {
    return false;
  }

  for (const issue of result['issues']) {
    if (!isValidIssue(issue)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates a single issue object.
 */
function isValidIssue(issue: unknown): issue is AnalysisResult['issues'][number] {
  if (typeof issue !== 'object' || issue === null) {
    return false;
  }

  const i = issue as Record<string, unknown>;

  return (
    typeof i['file'] === 'string' &&
    (i['line'] === null || typeof i['line'] === 'number') &&
    typeof i['wcag_criterion'] === 'string' &&
    isWcagLevel(i['wcag_level']) &&
    isSeverity(i['severity']) &&
    isConfidence(i['confidence']) &&
    typeof i['title'] === 'string' &&
    typeof i['description'] === 'string' &&
    typeof i['impact'] === 'string' &&
    typeof i['suggestion'] === 'string'
  );
}

/**
 * Represents a single issue in the response (internal type for validation).
 */
interface A11yIssueLike {
  file: string;
  line: number | null;
  wcag_criterion: string;
  wcag_level: WcagLevel;
  severity: Severity;
  confidence: Confidence;
  title: string;
  description: string;
  impact: string;
  suggestion: string;
}

function isWcagLevel(value: unknown): value is WcagLevel {
  return value === 'A' || value === 'AA' || value === 'AAA';
}

function isSeverity(value: unknown): value is Severity {
  return value === 'CRITICAL' || value === 'SERIOUS' || value === 'MODERATE' || value === 'MINOR';
}

function isConfidence(value: unknown): value is Confidence {
  return value === 'high' || value === 'medium' || value === 'low';
}