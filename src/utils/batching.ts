/**
 * File batching utilities for processing large PRs.
 * Splits files into manageable batches for LLM requests.
 * 
 * @module utils/batching
 */

import * as core from '@actions/core';
import type { FilePatch, ActionConfig } from '../types';
import { LLM_LIMITS, PR_SIZE_OVERRIDE } from '../constants';

/**
 * Create batches of files for processing.
 * 
 * @param files - All files to process
 * @param batchSize - Number of files per batch (defaults to LLM_LIMITS.DEFAULT_BATCH_SIZE)
 * @param maxFiles - Maximum files to process (0 = unlimited)
 * @returns Array of file batches
 */
export function createBatches(
  files: FilePatch[],
  batchSize: number = LLM_LIMITS.DEFAULT_BATCH_SIZE,
  maxFiles: number = 0
): FilePatch[][] {
  // Apply max files limit if specified
  const filesToProcess = maxFiles > 0 ? files.slice(0, maxFiles) : files;

  // Create batches
  const batches: FilePatch[][] = [];
  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    batches.push(filesToProcess.slice(i, i + batchSize));
  }

  core.info(`Created ${batches.length} batches of up to ${batchSize} files each`);

  return batches;
}

/**
 * Estimate token count for a batch of files.
 * Rough estimation: ~4 characters per token.
 */
export function estimateTokens(files: FilePatch[]): number {
  const totalChars = files.reduce((sum, file) => sum + file.patch.length, 0);
  return Math.ceil(totalChars / 4);
}

/**
 * Check PR labels for an `a11y-<N>` override and return a config with
 * adjusted maxFiles and batchSize.
 */
export function applyPRSizeOverride(config: ActionConfig, labels: string[]): ActionConfig {
  let maxFiles = 0;
  let matchedLabel = '';

  for (const label of labels) {
    const match = label.match(PR_SIZE_OVERRIDE.LABEL_PATTERN);
    if (match) {
      const n = parseInt(match[1]!, 10);
      if (!isNaN(n) && n > maxFiles) {
        maxFiles = n;
        matchedLabel = label;
      }
    }
  }

  if (maxFiles === 0) return config;

  if (maxFiles > PR_SIZE_OVERRIDE.MAX_FILES_CAP) {
    core.warning(
      `PR label "${matchedLabel}" requests ${maxFiles} files, ` +
      `but the maximum allowed via label override is ${PR_SIZE_OVERRIDE.MAX_FILES_CAP}. ` +
      `Clamping to ${PR_SIZE_OVERRIDE.MAX_FILES_CAP}.`
    );
    maxFiles = PR_SIZE_OVERRIDE.MAX_FILES_CAP;
  }

  const batchSize =
    maxFiles <= 100 ? PR_SIZE_OVERRIDE.BATCH_SIZE_LG :
      maxFiles <= 500 ? PR_SIZE_OVERRIDE.BATCH_SIZE_XL :
        PR_SIZE_OVERRIDE.BATCH_SIZE_XXL;

  core.info(
    `PR label "${matchedLabel}" detected. Overriding max-files: ${maxFiles}, batch-size: ${batchSize}`
  );

  return { ...config, maxFiles, batchSize };
}