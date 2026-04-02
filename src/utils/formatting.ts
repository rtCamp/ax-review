/**
 * Formatting utilities for accessibility review output.
 * 
 * Consolidates all formatting functions used in:
 * - PR review comments
 * - Check Run annotations
 * - Summary messages
 * 
 * @module utils/formatting
 * 
 * @example
 * import { formatIssueComment, formatCheckSummary } from './utils/formatting';
 * 
 * const comment = formatIssueComment(issue);
 * const summary = formatCheckSummary(issues);
 */

import type { A11yIssue, Severity, FailedBatch } from '../types';

/**
 * Icons for severity levels in review comments.
 */
export const SEVERITY_ICONS: Record<Severity, string> = {
  CRITICAL: '🔴',
  SERIOUS: '🟠',
  MODERATE: '🟡',
  MINOR: '🔵',
};

/**
 * Display titles for severity levels.
 */
export const SEVERITY_TITLES: Record<Severity, string> = {
  CRITICAL: 'Critical',
  SERIOUS: 'Serious',
  MODERATE: 'Moderate',
  MINOR: 'Minor',
};

/**
 * Check run annotation levels for severity.
 */
export const SEVERITY_ANNOTATION_LEVELS: Record<Severity, 'failure' | 'warning' | 'notice'> = {
  CRITICAL: 'failure',
  SERIOUS: 'failure',
  MODERATE: 'warning',
  MINOR: 'notice',
};

/**
 * HTML comment identifier for finding/updating existing comments.
 */
export const COMMENT_IDENTIFIER = '<!-- a11y-review -->';

// =============================================================================
// Review Comment Formatting
// =============================================================================

/**
 * Format a single issue as an inline review comment.
 * 
 * Creates a formatted comment with:
 * - Severity icon
 * - WCAG criterion and level
 * - Description and impact
 * - Suggested fix in a suggestion code block
 * 
 * @param issue - The accessibility issue to format
 * @returns Formatted markdown string
 * 
 * @example
 * const comment = formatIssueComment({
 *   severity: 'SERIOUS',
 *   title: 'Image missing alt text',
 *   wcag_criterion: '1.1.1',
 *   wcag_level: 'A',
 *   confidence: 'high',
 *   description: 'Screen readers cannot understand image content',
 *   impact: 'Users with visual impairments will not know the image purpose',
 *   suggestion: '<img src="photo.jpg" alt="Product photo" />',
 *   file: 'src/components/ProductCard.tsx',
 *   line: 42
 * });
 */
export function formatIssueComment(issue: A11yIssue): string {
  const icon = SEVERITY_ICONS[issue.severity];
  const wcagLevel = formatWcagLevel(issue.wcag_level);

  const parts = [
    `${icon} **${issue.title}**`,
    '',
    `**WCAG ${issue.wcag_criterion}** (${wcagLevel})  `,
    `**Severity:** ${issue.severity}  `,
    `**Confidence:** ${issue.confidence}`,
    '',
    issue.description,
    '',
    `**Impact:** ${issue.impact}`,
    '',
    '**Suggested fix:**',
    '```suggestion',
    issue.suggestion,
    '```',
  ];

  return parts.join('\n');
}

/**
 * Format an issue as a list item for summary sections.
 * 
 * @param issue - The issue to format
 * @returns Markdown list item string
 * 
 * @example
 * // Returns: "- **src/App.tsx:42**: Missing alt text (WCAG 1.1.1)"
 * formatIssueListItem(issue);
 */
export function formatIssueListItem(issue: A11yIssue): string {
  const line = issue.line !== null ? `:${issue.line}` : '';
  return `- **${issue.file}${line}**: ${issue.title} (WCAG ${issue.wcag_criterion})`;
}

/**
 * Format a complete review summary body.
 * 
 * Groups issues by severity and provides a formatted summary
 * suitable for a PR review body or issue comment.
 * 
 * @param issues - All issues found
 * @returns Formatted markdown summary
 */
export function formatReviewSummary(issues: A11yIssue[]): string {
  const violations = issues.filter(i => 
    i.severity === 'CRITICAL' || i.severity === 'SERIOUS' || i.severity === 'MODERATE'
  );
  const goodPractices = issues.filter(i => i.severity === 'MINOR');

  const parts: string[] = [
    '## Accessibility Review Summary',
    '',
    `**Total issues:** ${issues.length}`,
    `**Violations:** ${violations.length}`,
    `**Good practices:** ${goodPractices.length}`,
    '',
  ];

  // Group by severity
  const grouped = groupBySeverity(issues);

  // Output by severity (most severe first)
  if (grouped.CRITICAL.length > 0) {
    parts.push('### 🔴 Critical Issues');
    parts.push('');
    for (const issue of grouped.CRITICAL) {
      parts.push(formatIssueListItem(issue));
    }
    parts.push('');
  }

  if (grouped.SERIOUS.length > 0) {
    parts.push('### 🟠 Serious Issues');
    parts.push('');
    for (const issue of grouped.SERIOUS) {
      parts.push(formatIssueListItem(issue));
    }
    parts.push('');
  }

  if (grouped.MODERATE.length > 0) {
    parts.push('### 🟡 Moderate Issues');
    parts.push('');
    for (const issue of grouped.MODERATE) {
      parts.push(formatIssueListItem(issue));
    }
    parts.push('');
  }

  // Good practices
  if (goodPractices.length > 0) {
    parts.push('### 🔵 Good Practices');
    parts.push('');
    parts.push('These are not violations but represent accessibility best practices:');
    parts.push('');
    for (const issue of goodPractices) {
      parts.push(formatIssueListItem(issue));
    }
    parts.push('');
  }

  return parts.join('\n');
}

// =============================================================================
// Check Run Formatting
// =============================================================================

/**
 * Format a summary for a Check Run.
 * 
 * Provides a condensed summary suitable for GitHub's Check Run output.
 * 
 * @param issues - All issues found
 * @param failedBatches - Batches that failed to process
 * @returns Formatted markdown summary
 */
export function formatCheckSummary(
  issues: A11yIssue[],
  failedBatches: FailedBatch[] = []
): string {
  const grouped = groupBySeverity(issues);

  const parts: string[] = [
    `**Total issues:** ${issues.length}`,
    '',
  ];

  if (grouped.CRITICAL.length > 0) {
    parts.push(`🔴 **Critical:** ${grouped.CRITICAL.length}`);
  }
  if (grouped.SERIOUS.length > 0) {
    parts.push(`🟠 **Serious:** ${grouped.SERIOUS.length}`);
  }
  if (grouped.MODERATE.length > 0) {
    parts.push(`🟡 **Moderate:** ${grouped.MODERATE.length}`);
  }
  if (grouped.MINOR.length > 0) {
    parts.push(`🔵 **Good practices:** ${grouped.MINOR.length}`);
  }

  parts.push('');
  parts.push('---');
  parts.push('');

  // List all issues
  for (const issue of issues) {
    const line = issue.line !== null ? `:${issue.line}` : '';
    parts.push(`- **${issue.file}${line}**: ${issue.title}`);
    parts.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level})`);
  }

  // Report failed batches
  if (failedBatches.length > 0) {
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push(`⚠️ **Partial Processing Warning**`);
    parts.push('');
    parts.push(`${failedBatches.length} batch(es) failed to process:`);
    for (const failed of failedBatches) {
      parts.push(`- Batch ${failed.batchIndex + 1}: ${failed.error}`);
      parts.push(`  Files: ${failed.files.join(', ')}`);
    }
  }

  return parts.join('\n');
}

// =============================================================================
// Status Message Formatting
// =============================================================================

/**
 * Format a "no issues found" success message.
 */
export function formatNoIssuesComment(): string {
  return [
    COMMENT_IDENTIFIER,
    '## Accessibility Review ✅',
    '',
    'No WCAG 2.2 AA violations found in this PR!',
    '',
    'The changes pass accessibility requirements. Keep up the great work! 🎉',
  ].join('\n');
}

/**
 * Format a "draft PR skipped" message.
 */
export function formatDraftSkipComment(): string {
  return [
    COMMENT_IDENTIFIER,
    '## Accessibility Review Skipped',
    '',
    'This PR is marked as a draft. Accessibility review will run when the PR is marked ready for review.',
    '',
    'To trigger a review on this draft, add the `a11y-review-draft` label.',
  ].join('\n');
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a WCAG level for display.
 * 
 * @param level - 'A', 'AA', or 'AAA'
 * @returns Formatted string like "Level A"
 */
export function formatWcagLevel(level: 'A' | 'AA' | 'AAA'): string {
  return `Level ${level}`;
}

/**
 * Group issues by severity.
 * 
 * @param issues - Issues to group
 * @returns Object with arrays of issues by severity
 */
export function groupBySeverity(issues: A11yIssue[]): Record<Severity, A11yIssue[]> {
  const grouped: Record<Severity, A11yIssue[]> = {
    CRITICAL: [],
    SERIOUS: [],
    MODERATE: [],
    MINOR: [],
  };

  for (const issue of issues) {
    grouped[issue.severity].push(issue);
  }

  return grouped;
}

/**
 * Group issues by file.
 * 
 * @param issues - Issues to group
 * @returns Map of filename to issues array
 */
export function groupByFile(issues: A11yIssue[]): Map<string, A11yIssue[]> {
  const grouped = new Map<string, A11yIssue[]>();

  for (const issue of issues) {
    const existing = grouped.get(issue.file) || [];
    existing.push(issue);
    grouped.set(issue.file, existing);
  }

  return grouped;
}

/**
 * Wrap comment with identifier for future updates.
 */
export function wrapCommentWithIdentifier(body: string): string {
  return `${COMMENT_IDENTIFIER}\n${body}`;
}