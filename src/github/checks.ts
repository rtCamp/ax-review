/**
 * Check Run creation for GitHub Actions.
 * Creates annotations instead of review comments.
 * 
 * @module github/checks
 */

import * as core from '@actions/core';
import type { A11yIssue, CheckAnnotation, FailedBatch } from '../types';
import { GITHUB_LIMITS } from '../constants';
import { GitHubClient } from './client';
import { 
  formatCheckSummary, 
  SEVERITY_TITLES, 
  SEVERITY_ANNOTATION_LEVELS 
} from '../utils/formatting';

/**
 * Create a Check Run with annotations.
 */
export async function createCheckRun(
  github: GitHubClient,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[] = []
): Promise<void> {
  const violations = issues.filter(i => 
    i.severity === 'CRITICAL' || i.severity === 'SERIOUS' || i.severity === 'MODERATE'
  ).length;
  const goodPractices = issues.filter(i => i.severity === 'MINOR').length;

  const conclusion = violations > 0 || failedBatches.length > 0 
    ? 'failure' 
    : 'success';
  
  const summary = formatCheckSummary(issues, failedBatches);
  const annotations = buildAnnotations(issues);

  try {
    await github.createCheckRun(
      headSha,
      violations,
      goodPractices,
      summary,
      annotations.slice(0, GITHUB_LIMITS.MAX_ANNOTATIONS)
    );

    core.info(`Created check run with ${annotations.length} annotations`);

    if (issues.length > GITHUB_LIMITS.MAX_ANNOTATIONS) {
      core.warning(
        `Found ${issues.length} issues but only ${GITHUB_LIMITS.MAX_ANNOTATIONS} annotations can be displayed. ` +
        `All ${issues.length} issues are included in this action's output.`
      );
    }

    if (failedBatches.length > 0) {
      core.warning(
        `${failedBatches.length} batches failed to process. ` +
        `Some files may not have been analyzed.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to create check run: ${message}. Falling back to comments.`);
    throw error;
  }
}

/**
 * Build annotations from issues.
 */
function buildAnnotations(issues: A11yIssue[]): CheckAnnotation[] {
  return issues.map(issue => ({
    path: issue.file,
    start_line: issue.line ?? 1,
    end_line: issue.line ?? 1,
    annotation_level: SEVERITY_ANNOTATION_LEVELS[issue.severity],
    message: issue.description,
    title: `${SEVERITY_TITLES[issue.severity]}: ${issue.title} (WCAG ${issue.wcag_criterion})`,
    raw_details: issue.suggestion,
  }));
}