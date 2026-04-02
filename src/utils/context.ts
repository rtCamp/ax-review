/**
 * GitHub Actions context utilities.
 * 
 * Provides helper functions to extract repository and PR information
 * from the GitHub Actions runtime context.
 * 
 * @module utils/context
 * 
 * @example
 * import { getRepoContext, getPRNumber } from './utils/context';
 * 
 * const { owner, repo } = getRepoContext();
 * const prNumber = getPRNumber();
 */

import { context } from '@actions/github';

/**
 * Get repository owner and name from GitHub Actions context.
 * 
 * @returns Object with owner and repo strings
 */
export function getRepoContext(): { owner: string; repo: string } {
  const { owner, repo } = context.repo;
  return { owner, repo };
}

/**
 * Get PR number from GitHub Actions context.
 * 
 * @returns PR number or null if not in a PR context
 */
export function getPRNumber(): number | null {
  if (context.payload.pull_request) {
    return context.payload.pull_request.number;
  }

  if (context.payload.issue && context.eventName === 'issue_comment') {
    if (context.payload.issue['pull_request']) {
      return context.payload.issue.number;
    }
  }

  return null;
}