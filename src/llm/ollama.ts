/**
 * Ollama Cloud API client using the official ollama SDK.
 * 
 * @module llm/ollama
 */

import { Ollama } from 'ollama';
import { LLMError, type AnalysisResult } from './types';
import { LLM_LIMITS } from '../constants';

/**
 * Default model for Ollama Cloud.
 */
const DEFAULT_MODEL = 'minimax-m2.7:cloud';

/**
 * Ollama Cloud API endpoint.
 */
const OLLAMA_CLOUD_URL = 'https://ollama.com';

/**
 * Context window for Ollama models.
 */
const CONTEXT_WINDOW = 32768;

/**
 * Raw issue from LLM response (before validation).
 */
interface RawIssue {
  file?: unknown;
  line?: unknown;
  wcag_criterion?: unknown;
  wcag_level?: unknown;
  severity?: unknown;
  confidence?: unknown;
  title?: unknown;
  description?: unknown;
  impact?: unknown;
  suggestion?: unknown;
}

/**
 * Raw response from LLM (before validation).
 */
interface RawResponse {
  issues?: unknown;
  summary?: unknown;
}

/**
 * Ollama client using the official SDK.
 */
export class OllamaClient {
  public readonly provider = 'ollama';
  private ollama: Ollama;
  private model: string;

  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    this.model = config.model ?? DEFAULT_MODEL;
    
    this.ollama = new Ollama({
      host: (config.baseUrl ?? OLLAMA_CLOUD_URL).replace(/\/$/, ''),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  }

  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    try {
      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        format: 'json',
        options: {
          temperature: LLM_LIMITS.TEMPERATURE,
          num_ctx: CONTEXT_WINDOW,
        },
      });

      const content = response.message?.content;
      
      if (!content) {
        throw new LLMError('Ollama returned empty response', undefined, false);
      }

      return this.parseResponse(content);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private parseResponse(content: string): AnalysisResult {
    // Strip markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/i, '').replace(/\s*```$/,'');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/i, '').replace(/\s*```$/,'');
    }

    try {
      // Try parsing directly
      try {
        const parsed = JSON.parse(cleanContent);
        return this.validateResult(parsed);
      } catch {
        // Extract JSON from response that might have extra text
      }

      // Find JSON object by matching brackets
      const startIndex = cleanContent.indexOf('{');
      if (startIndex === -1) {
        throw new LLMError(
          `No JSON object found in response. Model may not have returned valid JSON.`,
          undefined,
          false
        );
      }

      let depth = 0;
      let endIndex = startIndex;
      for (let i = startIndex; i < cleanContent.length; i++) {
        if (cleanContent[i] === '{') depth++;
        if (cleanContent[i] === '}') depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }

      const jsonStr = cleanContent.substring(startIndex, endIndex);
      const parsed = JSON.parse(jsonStr);
      return this.validateResult(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMError(`Failed to parse response: ${message}`, undefined, false);
    }
  }

  private validateResult(data: unknown): AnalysisResult {
    if (typeof data !== 'object' || data === null) {
      throw new LLMError('Response is not an object', undefined, false);
    }
    
    const response = data as RawResponse;
    
    if (!Array.isArray(response.issues)) {
      throw new LLMError('Response missing issues array', undefined, false);
    }

    if (typeof response.summary !== 'string') {
      throw new LLMError('Response missing summary string', undefined, false);
    }

    return {
      issues: response.issues.map((issue: RawIssue) => ({
        file: String(issue.file ?? ''),
        line: issue.line ? Number(issue.line) : null,
        wcag_criterion: String(issue.wcag_criterion ?? ''),
        wcag_level: this.parseWcagLevel(issue.wcag_level),
        severity: this.parseSeverity(issue.severity),
        confidence: this.parseConfidence(issue.confidence),
        title: String(issue.title ?? ''),
        description: String(issue.description ?? ''),
        impact: String(issue.impact ?? ''),
        suggestion: String(issue.suggestion ?? ''),
      })),
      summary: String(response.summary),
    };
  }

  private parseWcagLevel(value: unknown): 'A' | 'AA' | 'AAA' {
    const level = String(value ?? 'A').toUpperCase();
    if (level === 'AA' || level === 'AAA') return level;
    return 'A';
  }

  private parseSeverity(value: unknown): 'CRITICAL' | 'SERIOUS' | 'MODERATE' | 'MINOR' {
    const severity = String(value ?? 'MINOR').toUpperCase();
    if (severity === 'CRITICAL' || severity === 'SERIOUS' || severity === 'MODERATE') {
      return severity;
    }
    return 'MINOR';
  }

  private parseConfidence(value: unknown): 'high' | 'medium' | 'low' {
    const confidence = String(value ?? 'medium').toLowerCase();
    if (confidence === 'high' || confidence === 'low') return confidence;
    return 'medium';
  }

  private handleError(error: unknown): LLMError {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('forbidden')) {
      return new LLMError(
        `${message}\n\nTroubleshooting:\n` +
        `1. Invalid or missing API key\n` +
        `2. Get your API key from: https://ollama.com/settings/keys\n` +
        `3. Ensure the key has not expired`,
        undefined,
        false
      );
    }

    if (lower.includes('404') || lower.includes('not found') || lower.includes('model')) {
      return new LLMError(
        `${message}\n\nTroubleshooting:\n` +
        `1. Model '${this.model}' not found\n` +
        `2. Check available models at: https://ollama.com/search?c=cloud\n`,
        undefined,
        false
      );
    }

    if (lower.includes('429') || lower.includes('rate') || lower.includes('quota')) {
      return new LLMError(
        `${message}\n\nTroubleshooting:\n` +
        `1. Rate limit or quota exceeded\n` +
        `2. Wait a few minutes before retrying\n` +
        `3. Check usage at: https://ollama.com/settings`,
        undefined,
        true
      );
    }

    if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('network')) {
      return new LLMError(
        `${message}\n\nTroubleshooting:\n` +
        `1. Network connectivity issue\n` +
        `2. Check internet connection\n` +
        `3. Verify https://ollama.com is accessible`,
        undefined,
        true
      );
    }

    return new LLMError(`Ollama error: ${message}`, undefined, false);
  }

  async validateConfig(): Promise<boolean> {
    try {
      await this.ollama.list();
      return true;
    } catch {
      return false;
    }
  }
}