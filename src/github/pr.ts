/**
 * PR file fetching and processing.
 * Handles filtering and limiting of PR files.
 * 
 * @module github/pr
 */

import * as core from '@actions/core';
import type { FilePatch } from '../types';
import { GitHubClient } from './client';
import { 
  shouldSkipFile as shouldSkipFilePattern,
  filterFilesForAnalysis as filterFilesForAnalysisUtil 
} from '../utils/file-utils';

/**
 * Fetch and filter PR files.
 * Applies file limits and filters based on action configuration.
 */
export async function fetchPRFiles(
  client: GitHubClient,
  prNumber: number,
  maxFiles: number
): Promise<FilePatch[]> {
  const allFiles = await client.getPRFiles(prNumber);

  if (maxFiles > 0 && allFiles.length > maxFiles) {
    core.warning(
      `PR has ${allFiles.length} files, but limit is ${maxFiles}. ` +
      `Analyzing first ${maxFiles} files. ` +
      `Increase 'max-files' input to analyze more.`
    );
    return allFiles.slice(0, maxFiles);
  }

  core.info(`Found ${allFiles.length} files to analyze`);
  return allFiles;
}

/**
 * Check if a file should be skipped for analysis.
 * Uses the SKIP_PATTERNS blocklist.
 */
export function shouldSkipFile(file: FilePatch): boolean {
  return shouldSkipFilePattern(file);
}

/**
 * Filter files for accessibility analysis using hybrid approach.
 * 
 * This function uses:
 * 1. Blocklist (SKIP_PATTERNS) to exclude config, test, generated files
 * 2. Allowlist (DIRECT_MARKUP_EXTENSIONS) for markup files
 * 3. Content detection for ambiguous extensions (js, ts, py, rb)
 * 
 * Works for any project type: React, Vue, Svelte, WordPress, Frappe, Django, Rails, etc.
 * 
 * @param files - Files to filter
 * @returns Files that should be analyzed
 */
export function filterWebFiles(files: FilePatch[]): FilePatch[] {
  return filterFilesForAnalysisUtil(files);
}