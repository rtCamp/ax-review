/**
 * Output handling for accessibility review results.
 * 
 * This module handles posting results to GitHub:
 * - PR review comments with inline feedback
 * - Check runs with annotations
 * - Summary comments with issue breakdown
 * 
 * Separated from orchestrator.ts to:
 * - Keep output formatting logic in one place
 * - Enable testing of output formatting independently
 * - Make it easy to add new output modes (e.g., Slack notifications)
 * 
 * @module output
 */

import * as core from '@actions/core';
import type { A11yIssue, FailedBatch } from './types';
import type { GitHubClient } from './github/client';
import {
  formatIssueComment,
  formatCheckSummary,
  groupByFile,
  formatFirstRunSummary,
  formatDeltaSummary
} from './utils/formatting';
import { GITHUB_LIMITS } from './constants';
import { extractAddedLines } from './utils/diff';

/**
 * Check if an issue is a violation (CRITICAL, SERIOUS, or MODERATE).
 */
function isViolation(issue: A11yIssue): boolean {
  return issue.severity === 'CRITICAL' || issue.severity === 'SERIOUS' || issue.severity === 'MODERATE';
}

/**
 * Post results as PR review comments.
 * 
 * PR reviews with inline comments are shown directly on the diff,
 * making them highly visible to developers.
 * 
 * **Review behavior:**
 * - Only violations (CRITICAL, SERIOUS, MODERATE) get inline comments
 * - Good practices (MINOR) are included in the summary only
 * - PRs with no violations only receive the summary comment
 * 
 * **Comment limits:**
 * - GitHub limits reviews to ~50 comments per batch
 * - We break into multiple reviews if needed
 * 
 * @param github - GitHub API client
 * @param prNumber - PR number to comment on
 * @param headSha - HEAD commit SHA for review
 * @param issues - All issues found
 * @param failedBatches - Batches that failed processing (for warning)
 */
async function postReview(
  github: GitHubClient,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[]
): Promise<void> {
  const existing = await github.findSummaryComment(prNumber);

  if (!existing) {
    // First run: post the full dashboard
    const body = formatFirstRunSummary(issues, failedBatches);
    await github.createIssueComment(prNumber, body);
  } else {
    // Subsequent push: update in place with minimal delta
    const body = formatDeltaSummary(issues, failedBatches, headSha, existing.body);
    await github.updateIssueComment(existing.id, body);
  }

  const violations = issues.filter(isViolation);
  if (violations.length === 0) return;

  const violationsByFile = groupByFile(violations);
  const filePatches = await github.getPRFiles(prNumber);
  const patchMap = new Map(filePatches.map(f => [f.filename, f.patch]));

  const comments = await buildInlineComments(violationsByFile, patchMap);
  if (comments.length === 0) return;

  // Post review with inline comments but no body.
  await github.createReview(prNumber, headSha, comments, '');
}

/**
 * Post results as Check Run with annotations.
 * 
 * Check Runs are shown in the PR's "Checks" tab and can
 * block merging if configured as required status checks.
 * 
 * **Annotation limits:**
 * - GitHub limits check runs to 50 annotations
 * - We prioritize CRITICAL and SERIOUS issues
 * - Remaining slots go to MODERATE, then MINOR
 * 
 * **Check run conclusion:**
 * - 'failure' if any CRITICAL or SERIOUS issues
 * - 'neutral' if only MODERATE or MINOR issues
 * - 'success' if no issues
 * 
 * @param github - GitHub API client
 * @param headSha - HEAD commit SHA for check run
 * @param issues - All issues found
 * @param failedBatches - Batches that failed
 */
async function postCheckRun(
  github: GitHubClient,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[]
): Promise<void> {
  // Count by severity
  const violations = issues.filter(isViolation).length;
  const goodPractices = issues.filter(i => i.severity === 'MINOR').length;

  // Build annotations (limited to 50)
  const annotations = buildAnnotations(issues);

  // Build summary text
  const summary = formatCheckSummary(issues, failedBatches);

  // Create the check run
  await github.createCheckRun(headSha, violations, goodPractices, summary, annotations);

  // Warn if we hit the annotation limit
  if (issues.length > GITHUB_LIMITS.MAX_ANNOTATIONS) {
    core.warning(
      `Found ${issues.length} issues but only ${GITHUB_LIMITS.MAX_ANNOTATIONS} ` +
      `can be displayed as annotations. All issues are included in the summary.`
    );
  }
}

/**
 * Build inline comments for GitHub review.
 * 
 * This function:
 * 1. Iterates through violations grouped by file
 * 2. Builds position map for each file's patch
 * 3. Converts line numbers to diff positions
 * 4. Formats comments with severity icon
 * 
 * **Why position mapping:**
 * GitHub review comments use "position" which is the line's
 * offset within the diff, not the file's line number.
 * 
 * For example, a file with:
 * ```diff
 * @@ -1,5 +1,6 @@
 *  line 1    (position 1)
 *  line 2    (position 2)
 * +line 3    (position 3) <- added line
 *  line 4    (position 4)
 * ```
 * 
 * The added line has line=3 but position=3. We must
 * convert line → position for each file.
 * 
 * @param issuesByFile - Issues grouped by file
 * @param patchMap - Map from filename to patch content
 * @param github - GitHub client for position mapping
 * @returns Array of review comments
 */
async function buildInlineComments(
  issuesByFile: Map<string, A11yIssue[]>,
  patchMap: Map<string, string>
): Promise<Array<{ path: string; line: number; side: 'RIGHT'; body: string }>> {
  const comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = [];

  for (const [file, fileIssues] of issuesByFile) {
    const patch = patchMap.get(file);
    if (!patch) {
      core.debug(`No patch found for ${file}, skipping inline comments`);
      continue;
    }

    // Build set of valid added line numbers for this file
    const validLines = extractAddedLines(patch);

    for (const issue of fileIssues) {
      // Skip issues without a specific line
      if (issue.line === null) {
        core.debug(`Issue "${issue.title}" has no line number, skipping`);
        continue;
      }

      if (!validLines.has(issue.line)) {
        core.debug(`Line ${issue.line} is not an added line in ${file}, skipping`);
        continue;
      }

      // Format the comment
      const body = formatIssueComment(issue);
      comments.push({
        path: file,
        line: issue.line,
        side: 'RIGHT',
        body,
      });

      // Respect GitHub's comment limit
      if (comments.length >= GITHUB_LIMITS.MAX_REVIEW_COMMENTS) {
        core.warning(`Reached GitHub limit of ${GITHUB_LIMITS.MAX_REVIEW_COMMENTS} comments`);
        return comments;
      }
    }
  }

  return comments;
}

/**
 * Build check run annotations from issues.
 * 
 * Annotations are different from review comments:
 * - Shown in "Checks" tab, not in "Files changed"
 * - Limited to 50 per check run
 * - Can't block specific lines, just show warnings
 * 
 * **Annotation levels:**
 * - 'failure': For CRITICAL and SERIOUS issues (blocks merge)
 * - 'warning': For MODERATE issues (shown but doesn't block)
 * - 'notice': For MINOR issues (informational)
 * 
 * @param issues - All issues
 * @returns Array of annotations (max 50)
 */
function buildAnnotations(issues: A11yIssue[]): Array<{
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
  title: string;
  raw_details?: string;
}> {
  // Severity to annotation level mapping
  const severityLevel: Record<string, 'failure' | 'warning' | 'notice'> = {
    CRITICAL: 'failure',
    SERIOUS: 'failure',
    MODERATE: 'warning',
    MINOR: 'notice',
  };

  return issues
    .slice(0, GITHUB_LIMITS.MAX_ANNOTATIONS)
    .map(issue => ({
      path: issue.file,
      start_line: issue.line ?? 1,
      end_line: issue.line ?? 1,
      annotation_level: severityLevel[issue.severity] ?? 'warning',
      message: issue.description,
      title: `${issue.severity}: ${issue.title} (WCAG ${issue.wcag_criterion})`,
      raw_details: issue.suggestion,
    }));
}

/**
 * Post results to GitHub based on output mode.
 */
export async function postResults(
  github: GitHubClient,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[],
  outputMode: 'comments' | 'checks'
): Promise<void> {
  if (outputMode === 'comments') {
    await postReview(github, prNumber, headSha, issues, failedBatches);
  } else {
    await postCheckRun(github, headSha, issues, failedBatches);
  }
}
