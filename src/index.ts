/**
 * Main entry point for ax-review GitHub Action.
 * 
 * This module handles:
 * - Input validation and configuration
 * - Context resolution (PR, repository)
 * - Error handling and output setting
 * - Workflow orchestration
 * 
 * The actual analysis logic is in orchestrator.ts and output.ts.
 * This file is intentionally minimal - just entry point concerns.
 * 
 * @module index
 * 
 * @example
 * // Entry point is called automatically when action runs
 * // No exports needed - run() is called at module load
 * 
 * // Error handling:
 * // - Input validation errors: immediate failure with message
 * // - LLM config errors: immediate failure with message  
 * // - Batch failures: continue with warning, report in output
 * // - Partial results: succeed with warnings
 */

import * as core from '@actions/core';
import { parseInputs, setOutputs } from './inputs';
import { createLLMClient, buildLLMConfig } from './llm/index';
import type { LLMClient } from './llm/types';
import { GitHubClient } from './github/client';
import { analyzeFiles, type AnalysisContext } from './orchestrator';
import { postResults } from './output';
import { getRepoContext, getPRNumber } from './utils/context';
import { calculateStats } from './utils/stats';

/**
 * Main entry point for the GitHub Action.
 * 
 * This function:
 * 1. Parses and validates inputs
 * 2. Resolves PR context
 * 3. Initializes clients (GitHub, LLM)
 * 4. Runs the analysis workflow
 * 5. Posts results
 * 6. Sets outputs
 * 7. Handles failures appropriately
 * 
 * **Error handling strategy:**
 * - Top-level try/catch for unexpected errors
 * - Config validation fails fast
 * - Batch failures are logged but don't stop processing
 * - Final failure depends on fail-on-issues setting
 * 
 * @see orchestrator.ts - Analysis workflow
 * @see output.ts - Result posting
 */
export async function run(): Promise<void> {
  try {
    // -----------------------------------------------------------------------
    // Step 1: Parse and validate inputs
    // -----------------------------------------------------------------------
    const config = parseInputs();
    core.info(`Starting accessibility review with ${config.llmProvider} provider`);

    // -----------------------------------------------------------------------
    // Step 2: Resolve PR context
    // -----------------------------------------------------------------------
    const { owner, repo } = getRepoContext();
    const prNumber = getPRNumber();

    if (!prNumber) {
      core.setFailed('Could not determine PR number from context');
      return;
    }

    core.info(`Analyzing PR #${prNumber} in ${owner}/${repo}`);

    // -----------------------------------------------------------------------
    // Step 3: Initialize GitHub client
    // -----------------------------------------------------------------------
    const github = new GitHubClient(config.githubToken, owner, repo);

    // Get PR metadata
    const prInfo = await github.getPRInfo(prNumber);
    core.info(`PR "${prInfo.title}" by ${prInfo.author}`);

    // Skip draft PRs if configured
    if (config.skipDrafts && prInfo.isDraft) {
      core.info('Skipping draft PR - analysis skipped by configuration');
      await github.createReview(prNumber, prInfo.headSha, [], 
        '<!-- ax-review -->\n## Accessibility Review Skipped\n\n' +
        'This PR is marked as a draft. Analysis will run when marked ready for review.\n\n' +
        'To analyze draft PRs, set `skip-drafts: false` in the workflow.'
      );
      setOutputs({ issuesFound: 0, violations: 0, goodPractices: 0 });
      return;
    }

    // -----------------------------------------------------------------------
    // Step 4: Initialize LLM client
    // -----------------------------------------------------------------------
    const llmConfig = buildLLMConfig(
      config.llmProvider,
      config.apiKey ?? undefined,
      config.model ?? undefined,
      config.ollamaUrl
    );
    
    const llm: LLMClient = createLLMClient(config.llmProvider, llmConfig);
    core.info(`${config.llmProvider} client initialized${config.model ? ` with model ${config.model}` : ''}`);

    // -----------------------------------------------------------------------
    // Step 5: Run analysis
    // -----------------------------------------------------------------------
    const context: AnalysisContext = {
      github,
      llm,
      config,
      owner,
      repo,
      prNumber,
      headSha: prInfo.headSha,
    };

    const result = await analyzeFiles(context);
    core.info(`Analysis complete: ${result.issues.length} issues found`);

    // Report any batch failures
    if (result.failedBatches.length > 0) {
      core.warning(
        `${result.failedBatches.length}/${result.totalBatches} batches failed to process. ` +
        'Some files may not have been analyzed.'
      );
      
      for (const failed of result.failedBatches) {
        core.warning(`Batch ${failed.batchIndex + 1}: ${failed.error}`);
        core.debug(`Files: ${failed.files.join(', ')}`);
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Post results
    // -----------------------------------------------------------------------
    await postResults(
      github,
      prNumber,
      prInfo.headSha,
      result.issues,
      result.failedBatches,
      config.outputMode
    );

    // -----------------------------------------------------------------------
    // Step 7: Set outputs
    // -----------------------------------------------------------------------
    const stats = calculateStats(result.issues);
    setOutputs({
      issuesFound: stats.total,
      violations: stats.violations,
      goodPractices: stats.goodPractices,
    });

    // -----------------------------------------------------------------------
    // Step 8: Handle failure conditions
    // -----------------------------------------------------------------------
    if (config.failOnIssues && stats.violations > 0) {
      const message = result.failedBatches.length > 0
        ? `Found ${stats.violations} accessibility violations (${result.failedBatches.length} batches had processing errors)`
        : `Found ${stats.violations} accessibility violations`;
      core.setFailed(message);
    } else if (result.failedBatches.length > 0 && result.successfulBatches === 0) {
      // All batches failed - this is a problem
      core.setFailed('All analysis batches failed. No files were processed.');
    }

  } catch (error) {
    // Handle unexpected errors
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Unexpected error: ${message}`);
    
    // Log full stack trace for debugging
    if (error instanceof Error && error.stack) {
      core.debug(`Stack trace: ${error.stack}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Run the action
// ---------------------------------------------------------------------------
run();