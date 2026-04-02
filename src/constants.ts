/**
 * Centralized constants for the GitHub Action.
 * Avoids magic numbers and provides configurable limits.
 * 
 * @module constants
 */

/**
 * GitHub API limits and defaults.
 */
export const GITHUB_LIMITS = {
  /** Maximum files per page when paginating PR files */
  PER_PAGE: 100,
  
  /** Maximum annotations per Check Run */
  MAX_ANNOTATIONS: 50,
  
  /** Maximum inline comments per PR review */
  MAX_REVIEW_COMMENTS: 50,
  
  /** Default maximum files to analyze */
  DEFAULT_MAX_FILES: 100,
} as const;

/**
 * LLM processing limits.
 */
export const LLM_LIMITS = {
  /** Default batch size (files per LLM request) */
  DEFAULT_BATCH_SIZE: 20,
  
  /** Default timeout for LLM requests (milliseconds) - 10 minutes */
  DEFAULT_TIMEOUT_MS: 600000,
  
  /** Maximum retries for transient errors */
  MAX_RETRIES: 3,
  
  /** Base delay for exponential backoff (milliseconds) */
  BASE_DELAY_MS: 1000,
  
  /** Temperature for LLM inference - low for deterministic output */
  TEMPERATURE: 0.1,
} as const;

/**
 * Action defaults.
 */
export const ACTION_DEFAULTS = {
  /** Default LLM provider */
  LLM_PROVIDER: 'gemini',
  
  /** Default output mode - checks (annotations) is recommended for better visibility */
  OUTPUT_MODE: 'checks',
  
  /** Default Ollama Cloud URL */
  OLLAMA_URL: 'https://ollama.com',
} as const;