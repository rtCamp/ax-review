/**
 * Core TypeScript interfaces for ax-review.
 * These types define the shape of data throughout the application.
 * 
 * @module types
 */

/**
 * Represents a single accessibility issue found in the PR diff.
 */
export interface A11yIssue {
  /** Relative file path from repo root */
  file: string;

  /** Line number in the NEW file (1-indexed), null if not line-specific */
  line: number | null;

  /** WCAG 2.2 criterion number (e.g., "1.1.1", "2.4.4") */
  wcag_criterion: string;

  /** WCAG conformance level */
  wcag_level: WcagLevel;

  /** Issue severity */
  severity: Severity;

  /** Confidence in the finding */
  confidence: Confidence;

  /** Short, actionable title for the issue */
  title: string;

  /** Explanation of why this is an accessibility problem */
  description: string;

  /** Impact on users with disabilities */
  impact: string;

  /** EXACT code fix (not instructions). Must be copy-paste ready. */
  suggestion: string;
}

/**
 * WCAG conformance levels.
 */
export type WcagLevel = 'A' | 'AA' | 'AAA';

/**
 * Issue severity classification.
 * Based on accessibility-agents severity model.
 */
export type Severity = 'CRITICAL' | 'SERIOUS' | 'MODERATE' | 'MINOR';

/**
 * Confidence level in the finding.
 */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * A file changed in the PR with its diff patch.
 */
export interface FilePatch {
  /** Relative file path */
  filename: string;

  /** Git diff patch content */
  patch: string;

  /** Git status of the file */
  status: FileStatus;

  /** Number of additions */
  additions: number;

  /** Number of deletions */
  deletions: number;
}

/**
 * Git file status.
 */
export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed';

/**
 * LLM provider options - hot-swappable via config.
 */
export type LLMProvider = 'gemini' | 'ollama';

/**
 * Output mode for posting results.
 */
export type OutputMode = 'comments' | 'checks';

/**
 * Result from LLM analysis.
 */
export interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

/**
 * Secret detected by Gitleaks (redacted before LLM processing).
 */
export interface SecretFinding {
  /** File containing the secret */
  file: string;

  /** Line number (1-indexed) */
  line: number;

  /** Gitleaks rule ID */
  ruleId: string;

  /** Redacted secret placeholder */
  redacted: string;
}

/**
 * PR metadata from GitHub API.
 */
export interface PRInfo {
  /** PR number */
  number: number;

  /** PR title */
  title: string;

  /** PR body/description */
  body: string | null;

  /** Head commit SHA */
  headSha: string;

  /** Base branch name */
  baseRef: string;

  /** Head branch name */
  headRef: string;

  /** Whether the PR is a draft */
  isDraft: boolean;

  /** PR author login */
  author: string;

  /** Repository owner */
  owner: string;

  /** Repository name */
  repo: string;
}

/**
 * GitHub review comment for inline feedback.
 */
export interface ReviewComment {
  /** File path */
  path: string;

  /** Diff position (1-indexed) */
  position: number;

  /** Comment body (markdown) */
  body: string;
}

/**
 * Check Run annotation.
 */
export interface CheckAnnotation {
  /** File path */
  path: string;

  /** Start line (1-indexed) */
  start_line: number;

  /** End line (1-indexed) */
  end_line: number;

  /** Start column (1-indexed) */
  start_column?: number;

  /** End column (1-indexed) */
  end_column?: number;

  /** Annotation level */
  annotation_level: 'failure' | 'warning' | 'notice';

  /** Short message */
  message: string;

  /** Detailed description (markdown) */
  raw_details?: string;

  /** Title */
  title?: string;
}

/**
 * Action configuration parsed from inputs.
 */
export interface ActionConfig {
  githubToken: string;
  llmProvider: LLMProvider;
  apiKey?: string | undefined;
  model?: string | undefined;
  ollamaUrl: string;
  outputMode: OutputMode;
  failOnIssues: boolean;
  maxFiles: number;
  batchSize: number;
  skipDrafts: boolean;
}

/**
 * Information about a failed batch during LLM processing.
 */
export interface FailedBatch {
  /** Batch index (0-based) */
  batchIndex: number;
  
  /** Files that were in the failed batch */
  files: string[];
  
  /** Error message from the failure */
  error: string;
}

/**
 * Result tracking for batch processing.
 */
export interface BatchProcessingResult {
  /** All successfully extracted issues */
  issues: A11yIssue[];
  
  /** Batches that failed to process */
  failedBatches: FailedBatch[];
  
  /** Total batches processed */
  totalBatches: number;
  
  /** Batches that succeeded */
  successfulBatches: number;
}

/**
 * Statistics summary for output.
 */
export interface IssueStats {
  total: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  violations: number;
  goodPractices: number;
}