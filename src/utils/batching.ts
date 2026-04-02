/**
 * File batching utilities for processing large PRs.
 * Splits files into manageable batches for LLM requests.
 * 
 * @module utils/batching
 */

import * as core from '@actions/core';
import type { FilePatch } from '../types';
import { LLM_LIMITS } from '../constants';

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