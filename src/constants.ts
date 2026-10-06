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

/**
 * PR-level batch size override tiers.
 *
 * Triggered by a label matching the pattern `a11y-<N>` (e.g. `a11y-100`, `a11y-500`, `a11y-1000`).
 * The number N becomes the new maxFiles limit; batchSize is derived accordingly.
 */
export const PR_SIZE_OVERRIDE = {
  /** Regex to detect an override label and capture the file limit */
  LABEL_PATTERN: /^a11y-(\d+)$/,

  /** Hard upper cap for the label-driven file limit */
  MAX_FILES_CAP: 1500,

  /** Batch size to use when maxFiles <= 100 */
  BATCH_SIZE_LG: 20,

  /** Batch size to use when maxFiles <= 500 */
  BATCH_SIZE_XL: 25,

  /** Batch size to use when maxFiles > 500 */
  BATCH_SIZE_XXL: 50,
} as const;
