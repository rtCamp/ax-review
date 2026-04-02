/**
 * Workflow orchestrator for accessibility analysis.
 * 
 * This module handles the core analysis pipeline:
 * 1. Fetch PR files from GitHub
 * 2. Filter to web files
 * 3. Redact secrets
 * 4. Create batches
 * 5. Process with LLM
 * 
 * Separated from index.ts to:
 * - Keep the entry point simple (just error handling)
 * - Enable testing of the workflow independently
 * - Make the code easier to navigate
 * 
 * @module orchestrator
 */

import * as core from '@actions/core';
import type { A11yIssue, ActionConfig } from './types';
import type { LLMClient } from './llm/types';
import type { GitHubClient } from './github/client';
import { redactSecrets } from './security/gitleaks';
import { getSystemPrompt, buildUserPrompt } from './prompts/a11y-prompt';
import { createBatches } from './utils/batching';
import { fetchPRFiles, filterWebFiles, shouldSkipFile } from './github/pr';
import { countElementsInFiles, verifyCompleteness } from './utils/element-counter';

/**
 * Result from batch processing.
 * Contains all found issues plus metadata about any failed batches.
 * 
 * **Why track failed batches:**
 * Users need to know if some files weren't analyzed.
 * A partial analysis is better than no analysis, but users
 * should be warned about gaps.
 */
export interface AnalysisResult {
  /** All accessibility issues found across all successful batches */
  issues: A11yIssue[];
  
  /** Batches that failed to process */
  failedBatches: FailedBatch[];
  
  /** Total number of batches */
  totalBatches: number;
  
  /** Number of successfully processed batches */
  successfulBatches: number;
  
  /** Potential gaps detected during verification */
  verificationGaps?: string[];
}

/**
 * Information about a batch that failed to process.
 * Used for reporting partial analysis results.
 */
export interface FailedBatch {
  /** Zero-based index of the failed batch */
  batchIndex: number;
  
  /** Files that were in this batch */
  files: string[];
  
  /** Error message explaining the failure */
  error: string;
}

/**
 * Context for the analysis workflow.
 * Contains all the dependencies and configuration needed.
 */
export interface AnalysisContext {
  /** GitHub API client */
  github: GitHubClient;
  
  /** LLM client for analysis */
  llm: LLMClient;
  
  /** Action configuration */
  config: ActionConfig;
  
  /** Repository owner */
  owner: string;
  
  /** Repository name */
  repo: string;
  
  /** PR number */
  prNumber: number;
  
  /** PR metadata */
  headSha: string;
}

/**
 * Execute the full accessibility analysis workflow.
 * 
 * This function orchestrates the entire analysis pipeline:
 * 1. Fetch PR files from GitHub (filtered by maxFiles)
 * 2. Filter to web file types (JS, TS, HTML, CSS, etc.)
 * 3. Run Gitleaks to remove secrets
 * 4. Split files into batches for LLM
 * 5. Process each batch with LLM
 * 6. Aggregate results
 * 
 * **Why batch processing:**
 * LLMs have context limits (e.g., 1M tokens for Gemini Flash).
 * A large PR could easily exceed this. Batching allows analyzing
 * PRs of any size by processing files in groups.
 * 
 * **Error handling:**
 * Each batch is processed independently. If one batch fails
 * (rate limit, timeout, parse error), it's logged but doesn't
 * stop other batches. The user is warned about partial results.
 * 
 * @param context - Analysis context with all dependencies
 * @returns Promise resolving to analysis result with issues and failures
 * 
 * @example
 * const result = await analyzeFiles({
 *   github,
 *   llm,
 *   config,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   prNumber: 123,
 *   headSha: 'abc123...'
 * });
 * 
 * console.log(`Found ${result.issues.length} issues`);
 * if (result.failedBatches.length > 0) {
 *   console.warn(`Warning: ${result.failedBatches.length} batches failed`);
 * }
 */
export async function analyzeFiles(context: AnalysisContext): Promise<AnalysisResult> {
  const { github, llm, config, owner, repo, prNumber } = context;

  // Step 1: Fetch PR files
  core.info('Fetching PR files...');
  const allFiles = await fetchPRFiles(github, prNumber, config.maxFiles);
  core.info(`Found ${allFiles.length} files in PR (limit: ${config.maxFiles})`);

  // Step 2: Filter to web files for accessibility analysis
  const filteredFiles = allFiles.filter(f => !shouldSkipFile(f));
  const webFiles = filterWebFiles(filteredFiles);

  if (webFiles.length === 0) {
    core.info('No web files found to analyze');
    return {
      issues: [],
      failedBatches: [],
      totalBatches: 0,
      successfulBatches: 0,
    };
  }

  core.info(`Analyzing ${webFiles.length} web files (${filteredFiles.length - webFiles.length} non-web files skipped)`);

  // Step 3: Scan for secrets and redact them
  core.info('Scanning for secrets...');
  const { files: redactedFiles, secretsFound, skipped } = await redactSecrets(webFiles);

  if (skipped) {
    // Security scan failed - don't proceed with analysis
    // This prevents accidentally sending secrets to the LLM
    core.warning('Secret detection scan failed. Analysis skipped to prevent potential secret exposure.');
    return {
      issues: [],
      failedBatches: [],
      totalBatches: 0,
      successfulBatches: 0,
    };
  }

  if (secretsFound > 0) {
    core.info(`Redacted ${secretsFound} potential secrets from diffs`);
  }

  // Step 4: Create batches for LLM processing
  const batches = createBatches(redactedFiles, config.batchSize);
  core.info(`Created ${batches.length} batches of ${config.batchSize} files each`);

  // Step 5: Process batches with LLM
  const systemPrompt = getSystemPrompt();
  const result = await processBatches(
    batches,
    llm,
    systemPrompt,
    owner,
    repo,
    prNumber
  );

  // Step 6: Verify completeness (local computation, no API call)
  // This logs warnings if the LLM may have missed elements
  core.info('Verifying analysis completeness...');
  const elementCounts = countElementsInFiles(redactedFiles);
  const verification = verifyCompleteness(elementCounts.counts, result.issues);

  if (!verification.passed) {
    core.warning('Potential gaps detected in analysis. The LLM may have missed some issues:');
    for (const gap of verification.potentialGaps) {
      core.warning(`  - ${gap}`);
    }
    result.verificationGaps = verification.potentialGaps;
  } else {
    core.info('Verification passed - element counts match reported issues');
  }

  return result;
}

/**
 * Process all batches with the LLM.
 * 
 * This function:
 * 1. Iterates through each batch
 * 2. Builds the user prompt with diff content
 * 3. Calls the LLM for analysis
 * 4. Collects results and tracks failures
 * 
 * **Batch processing strategy:**
 * - Sequential processing (not parallel) to avoid rate limits
 * - Each batch processed independently (failures don't stop others)
 * - Progress logged for observability
 * 
 * **Why sequential vs parallel:**
 * - Gemini free tier: 15 requests/minute limit
 * - Parallel processing would hit rate limits quickly
 * - Sequential with delay between batches
 * - Future enhancement: parallel with rate limiting
 * 
 * @param batches - Array of file batches
 * @param llm - LLM client
 * @param systemPrompt - WCAG expert system prompt
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - PR number
 * @returns Analysis result with issues and any failures
 */
async function processBatches(
  batches: ReturnType<typeof createBatches>,
  llm: LLMClient,
  systemPrompt: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<AnalysisResult> {
  const allIssues: A11yIssue[] = [];
  const failedBatches: FailedBatch[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (!batch) continue;

    core.info(`Processing batch ${i + 1}/${batches.length}...`);

    const userPrompt = buildUserPrompt(owner, repo, prNumber, batch);

    try {
      const result = await llm.analyze(systemPrompt, userPrompt);
      allIssues.push(...result.issues);
      core.info(`Batch ${i + 1}: Found ${result.issues.length} issues`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      core.warning(`Batch ${i + 1} failed: ${errorMessage}`);
      
      failedBatches.push({
        batchIndex: i,
        files: batch.map(f => f.filename),
        error: errorMessage,
      });
      // Continue processing other batches
      // User will be warned about partial results
    }
  }

  return {
    issues: allIssues,
    failedBatches,
    totalBatches: batches.length,
    successfulBatches: batches.length - failedBatches.length,
  };
}