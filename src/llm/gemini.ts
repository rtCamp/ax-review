/**
 * Gemini API client implementation.
 * Uses the @google/generative-ai SDK with structured JSON output.
 * 
 * @module llm/gemini
 * 
 * @example
 * // Create client
 * const client = new GeminiClient({
 *   apiKey: process.env.GEMINI_API_KEY,
 *   model: 'gemini-2.0-flash',
 *   timeout: 60000
 * });
 * 
 * // Validate configuration
 * if (!await client.validateConfig()) {
 *   throw new Error('Invalid Gemini API key');
 * }
 * 
 * // Analyze diff content
 * const result = await client.analyze(systemPrompt, userPrompt);
 * console.log(result.issues);
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { LLMError, type AnalysisResult, type GeminiConfig } from './types';
import { BaseLLMClient } from './base';
import { LLM_LIMITS } from '../constants';

/**
 * Default Gemini model.
 * Flash is faster and cheaper than Pro for this use case.
 * @see https://ai.google.dev/models/gemini
 */
const DEFAULT_MODEL = 'gemini-3-flash-preview';

/**
 * Gemini client implementing the LLMClient interface.
 * 
 * **How it works:**
 * 1. Uses Google's Generative AI SDK for authentication and request handling
 * 2. Configures JSON response mode for structured output
 * 3. Disables all safety filters (we need to analyze potentially problematic code)
 * 4. Retries on rate limits with exponential backoff
 * 
 * **Why Gemini:**
 * - Native JSON mode (no need to parse markdown code blocks)
 * - Fast inference (flash model)
 * - Good accessibility knowledge in training data
 * - Free tier available for testing
 * 
 * **Rate limits:**
 * - Free tier: 15 requests per minute
 * - Paid tier: 1000+ requests per minute
 * - This client handles rate limits with exponential backoff
 * 
 * @extends BaseLLMClient
 */
export class GeminiClient extends BaseLLMClient {
  /**
   * Provider identifier for logging and error messages.
   */
  public readonly provider = 'gemini';

  /**
   * Google Generative AI SDK client instance.
   * Created once in constructor, reused for all requests.
   */
  private readonly client: GoogleGenerativeAI;

  /**
   * Model identifier (e.g., 'gemini-2.0-flash', 'gemini-1.5-pro').
   */
  private readonly model: string;

  /**
   * Gemini API key for authentication.
   * Required for all Gemini API calls.
   */
  private readonly apiKey: string;

  /**
   * Create a new Gemini client.
   * 
   * @param config - Configuration options
   * @param config.apiKey - Gemini API key (required, get from https://aistudio.google.com/apikey)
   * @param config.model - Model to use (default: 'gemini-2.0-flash')
   * @param config.timeout - Request timeout in ms (default: 60000)
   * 
   * @example
   * const client = new GeminiClient({
   *   apiKey: process.env.GEMINI_API_KEY,
   *   model: 'gemini-2.0-flash',
   *   timeout: 30000
   * });
   */
  constructor(config: GeminiConfig) {
    super();
    
    if (!config.apiKey) {
      throw new Error('[Gemini] API key is required. Please set the api-key input or GEMINI_API_KEY environment variable.');
    }
    
    if (config.apiKey.length < 10) {
      throw new Error(`[Gemini] API key appears to be invalid (too short: ${config.apiKey.length} characters). Expected a longer key from Google AI Studio.`);
    }
    
    this.apiKey = config.apiKey;
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeout = config.timeout ?? LLM_LIMITS.DEFAULT_TIMEOUT_MS;
  }

  /**
   * Analyze diff content for accessibility issues.
   * 
   * This method:
   * 1. Creates a generative model with safety settings disabled
   * 2. Sends the system and user prompts to Gemini
   * 3. Parses the JSON response
   * 4. Validates against the expected schema
   * 5. Retries on transient failures
   * 
   * **Why safety filters are disabled:**
   * We analyze all code, including potentially problematic patterns.
   * Safety filters would block legitimate accessibility analysis
   * of things like missing alt text (which mentions "image").
   * 
   * @param systemPrompt - WCAG 2.2 expert system prompt
   * @param userPrompt - Formatted diff with repository context
   * @returns Promise resolving to analysis result with issues and summary
   * @throws LLMError on API failure, timeout, or invalid response
   */
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    try {
      return await this.executeWithRetry(
        // Make the API request
        async () => {
          const model = this.client.getGenerativeModel({
            model: this.model,
            generationConfig: {
              // Low temperature for deterministic, consistent output
              temperature: LLM_LIMITS.TEMPERATURE,
              // Force JSON mode - ensures structured output
              responseMimeType: 'application/json',
            },
            systemInstruction: systemPrompt,
            // Disable all safety filters for code analysis
            // We need to analyze potentially problematic patterns
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          });

          // Note: Gemini SDK doesn't support AbortController natively,
          // but executeWithRetry handles timeout at the promise level
          return model.generateContent(userPrompt);
        },
        // Extract text from Gemini response
        (result) => result.response.text(),
        // Determine if error should trigger retry
        (error) => this.isRateLimitError(error),
        // Provider name for error messages
        'Gemini'
      );
    } catch (error) {
      // Enhance error message with troubleshooting guidance
      const originalMessage = error instanceof Error ? error.message : String(error);
      const enhancedMessage = this.enhanceErrorMessage(originalMessage);
      
      // Re-throw with enhanced message
      if (error instanceof LLMError) {
        throw new LLMError(enhancedMessage, error.originalError, error.isRetryable);
      }
      throw new LLMError(enhancedMessage, error instanceof Error ? error : undefined, false);
    }
  }

  /**
   * Enhance error message with troubleshooting guidance.
   * Provides actionable advice for common Gemini errors.
   */
  private enhanceErrorMessage(originalMessage: string): string {
    const lower = originalMessage.toLowerCase();
    
    if (lower.includes('api_key') || lower.includes('api key') || lower.includes('401') || lower.includes('403')) {
      return `${originalMessage}\n\nTroubleshooting:\n` +
        `1. Check that GEMINI_API_KEY is set correctly in your repository secrets\n` +
        `2. Verify the API key is valid at https://aistudio.google.com/apikey\n` +
        `3. Ensure the key has not expired or been revoked\n` +
        `4. Try generating a new API key if the issue persists`;
    }
    
    if (lower.includes('model') || lower.includes('not found') || lower.includes('404')) {
      return `${originalMessage}\n\nTroubleshooting:\n` +
        `1. Model '${this.model}' may not be available\n` +
        `2. Available models: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash\n` +
        `3. Check https://ai.google.dev/models for current model names\n` +
        `4. Update the 'model' input in your workflow`;
    }
    
    if (lower.includes('quota') || lower.includes('rate') || lower.includes('429')) {
      return `${originalMessage}\n\nTroubleshooting:\n` +
        `1. You've exceeded the Gemini API rate limit or quota\n` +
        `2. Free tier: 15 requests/minute, 1500 requests/day\n` +
        `3. Wait a few minutes and retry\n` +
        `4. Consider upgrading to a paid tier at https://ai.google.dev/pricing`;
    }
    
    if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('etimedout')) {
      return `${originalMessage}\n\nTroubleshooting:\n` +
        `1. The request took longer than the ${this.timeout}ms timeout\n` +
        `2. Large PRs may need more time - increase 'timeout' input\n` +
        `3. Reduce 'batch-size' to process fewer files per request\n` +
        `4. Gemini may be experiencing high load - retry later`;
    }
    
    if (lower.includes('fetch') || lower.includes('network') || lower.includes('econn') || lower.includes('enotfound')) {
      return `${originalMessage}\n\nTroubleshooting:\n` +
        `1. Check your internet connection\n` +
        `2. Verify https://generativelanguage.googleapis.com is accessible\n` +
        `3. Check if a firewall or proxy is blocking the request\n` +
        `4. The action runner may have network restrictions`;
    }
    
    if (lower.includes('safety') || lower.includes('blocked') || lower.includes('content')) {
      return `${originalMessage}\n\nTroubleshooting:\n` +
        `1. Gemini's safety filters blocked the request\n` +
        `2. This is unusual for code analysis - the diff may contain sensitive content\n` +
        `3. Try simplifying the diff or removing sensitive files\n` +
        `4. All safety filters are disabled in the request - this should not happen`;
    }
    
    // Generic enhancement with full error context
    return `${originalMessage}\n\nTroubleshooting:\n` +
      `1. Provider: Gemini\n` +
      `2. Model: ${this.model}\n` +
      `3. Timeout: ${this.timeout}ms\n` +
      `4. Check the full error message above for specific details\n` +
      `5. If the issue persists, file a bug at https://github.com/your-org/ax-review/issues`;
  }

  /**
   * Validate that the Gemini API key is working.
   * 
   * This makes a minimal request to verify:
   * - API key is valid
   * - Model exists and is accessible
   * - Network connectivity is working
   * 
   * NOTE: This method is kept for interface compatibility but is not
   * called during normal operation to save API calls. Errors are handled
   * gracefully during the main analyze() call instead.
   * 
   * @returns Promise resolving to true if valid, false otherwise
   * 
   * @example
   * if (!await client.validateConfig()) {
   *   core.setFailed('Invalid Gemini API key');
   *   return;
   * }
   */
  async validateConfig(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      // Minimal test request - just verify the key works
      await model.generateContent('test');
      return true;
    } catch (error) {
      // Log the actual error for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Gemini] Configuration validation failed: ${errorMessage}`);
      
      // Log additional details for common issues
      if (errorMessage.includes('API_KEY') || errorMessage.includes('api key')) {
        console.error('[Gemini] API key appears to be invalid or missing');
      } else if (errorMessage.includes('model') || errorMessage.includes('not found')) {
        console.error(`[Gemini] Model '${this.model}' may not be available. Check your model name.`);
      } else if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('ECONN')) {
        console.error('[Gemini] Network error - check your internet connection');
      } else if (errorMessage.includes('quota') || errorMessage.includes('rate') || errorMessage.includes('429')) {
        console.error('[Gemini] Rate limit or quota exceeded');
      }
      
      return false;
    }
  }

  /**
   * Check if an error indicates a rate limit.
   * 
   * Rate limits are retryable after backoff.
   * Gemini returns 429 status for rate limits.
   * 
   * @param error - Error from API call
   * @returns true if error is rate-limit related
   */
  private isRateLimitError(error: Error): boolean {
    if (!error) return false;
    const message = error.message.toLowerCase();
    // Check for common rate limit indicators
    return (
      message.includes('rate') ||
      message.includes('limit') ||
      message.includes('429') ||
      message.includes('quota')
    );
  }
}