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

import type { A11yIssue, Severity, FailedBatch, WcagLevel } from '../types';

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
export const SUMMARY_MARKER = '<!-- ax-review-summary -->';
export const VIOLATION_COUNT_REGEX = /<!-- ax-violations:(\d+) -->/;
export const SHA_MARKER_REGEX = /<!-- ax-last-sha:([a-f0-9]+) -->/;

/**
 * Extract the last-analyzed commit SHA from an existing comment body.
 */
export function extractLastSha(body: string): string | null {
  return body.match(SHA_MARKER_REGEX)?.[1] ?? null;
}

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
    `${icon} **${escapeHtml(issue.title)}**`,
    '',
    `**WCAG ${issue.wcag_criterion}** (${wcagLevel})  `,
    `**Severity:** ${issue.severity}  `,
    `**Confidence:** ${issue.confidence}`,
    '',
    escapeHtml(issue.description),
    '',
    `**Impact:** ${escapeHtml(issue.impact)}`,
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
 * // Returns: "- 🟠 **Missing alt text** (WCAG 1.1.1) — `src/Card.tsx` (line 14)"
 * formatIssueListItem(issue);
 */
export function formatIssueListItem(issue: A11yIssue): string {
  const line = issue.line ? ` (line ${issue.line})` : '';
  const title = escapeHtml(issue.title);
  const icon = SEVERITY_ICONS[issue.severity];
  return `- ${icon} **${title}** (WCAG ${issue.wcag_criterion}) — \`${issue.file}\`${line}`;
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

/**
 * Format the first-run detailed summary dashboard.
 * Posted when no previous summary comment exists on the PR.
 */
export function formatFirstRunSummary(
  issues: A11yIssue[],
  failedBatches: FailedBatch[],
  headSha: string,
  wcagLevels: WcagLevel[] = ['A', 'AA', 'AAA']
): string {
  const violations = issues.filter(i => i.severity !== 'MINOR');
  const goodPractices = issues.filter(i => i.severity === 'MINOR');
  const violationCount = violations.length;
  const status = violationCount > 0 ? '🔴 Failed' : '🟢 Passed';

  const lines = [
    SUMMARY_MARKER,
    `<!-- ax-violations:${violationCount} -->`,
    `<!-- ax-last-sha:${headSha} -->`,
    '',
    `## Accessibility Review — ${status}`,
    '',
    '| Metric | Count |',
    '|--------|-------|',
    `| Violations (CRITICAL + SERIOUS + MODERATE) | **${violationCount}** |`,
    `| Suggestions (MINOR) | **${goodPractices.length}** |`,
    `| Total issues | **${issues.length}** |`,
    ''
  ];

  lines.push(...formatWcagBreakdownTable(issues, wcagLevels));
  lines.push(...formatIssuesByLevel(issues));

  if (failedBatches.length > 0) {
    lines.push(
      '',
      `⚠️ ${failedBatches.length} batch(es) failed to process. Some files may not have been analyzed.`
    );
  }

  return lines.join('\n');
}

/**
 * Format the incremental update for subsequent pushes.
 *
 * Shows only what was found in commits between baseSha and headSha.
 */
export function formatDeltaSummary(
  issues: A11yIssue[],
  failedBatches: FailedBatch[],
  baseSha: string,
  headSha: string,
  wcagLevels: WcagLevel[] = ['A', 'AA', 'AAA']
): string {
  const violations = issues.filter(i => i.severity !== 'MINOR').length;
  const goodPractices = issues.filter(i => i.severity === 'MINOR');
  const status = violations > 0 ? '🔴 Failed' : '🟢 Passed';

  const lines = [
    SUMMARY_MARKER,
    `<!-- ax-violations:${violations} -->`,
    `<!-- ax-last-sha:${headSha} -->`,
    '',
    `## Accessibility Review — ${status}`,
    '',
    '| Metric | Count |',
    '|--------|-------|',
    `| Violations (new commits) | **${violations}** |`,
    `| Suggestions (new commits) | **${goodPractices.length}** |`,
    '',
  ];

  lines.push(...formatWcagBreakdownTable(issues, wcagLevels));
  lines.push(...formatIssuesByLevel(issues));

  if (failedBatches.length > 0) {
    lines.push(
      '',
      `⚠️ ${failedBatches.length} batch(es) failed to process. Some files may not have been analyzed.`
    );
  }

  lines.push(
    `> Analyzed new commits \`${baseSha.slice(0, 7)}\` -> \`${headSha.slice(0, 7)}\``,
    '',
    '> _This comment updates automatically on each push._'
  );

  return lines.join('\n');
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
  failedBatches: FailedBatch[] = [],
  wcagLevels: WcagLevel[] = ['A', 'AA', 'AAA']
): string {
  const grouped = groupBySeverity(issues);
  const byLevel = groupByWcagLevel(issues);
  const activeLabel = wcagLevels.length === 3 ? 'A, AA, AAA' : wcagLevels.join(', ');

  const parts: string[] = [
    `**Total issues:** ${issues.length}  _(WCAG levels: ${activeLabel})_`,
    '',
  ];

  // Severity counts
  if (grouped.CRITICAL.length > 0) parts.push(`🔴 **Critical:** ${grouped.CRITICAL.length}`);
  if (grouped.SERIOUS.length > 0) parts.push(`🟠 **Serious:** ${grouped.SERIOUS.length}`);
  if (grouped.MODERATE.length > 0) parts.push(`🟡 **Moderate:** ${grouped.MODERATE.length}`);
  if (grouped.MINOR.length > 0) parts.push(`🔵 **Good practices:** ${grouped.MINOR.length}`);

  // WCAG level breakdown
  parts.push('');
  parts.push('**By WCAG Level:**');
  const levelMeta: Record<WcagLevel, string> = {
    A: 'Critical blockers',
    AA: 'Standard legal baseline',
    AAA: 'Enhanced / specialized',
  };
  for (const level of (['A', 'AA', 'AAA'] as WcagLevel[])) {
    const active = wcagLevels.includes(level);
    const count = byLevel[level].length;
    if (active) {
      parts.push(`- Level ${level} (${levelMeta[level]}): **${count}**`);
    }
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
 * Group issues by WCAG conformance level.
 */
export function groupByWcagLevel(issues: A11yIssue[]): Record<WcagLevel, A11yIssue[]> {
  const grouped: Record<WcagLevel, A11yIssue[]> = { A: [], AA: [], AAA: [] };
  for (const issue of issues) {
    grouped[issue.wcag_level].push(issue);
  }
  return grouped;
}

/**
 * Filter issues to only those matching the configured WCAG conformance levels.
 *
 * @param issues     - Full issue list from the LLM
 * @param wcagLevels - Active levels; defaults to all three
 * @returns Filtered array (may be the same reference when nothing is excluded)
 */
export function filterByWcagLevels(
  issues: A11yIssue[],
  wcagLevels: WcagLevel[] = ['A', 'AA', 'AAA']
): A11yIssue[] {
  return wcagLevels.length === 3
    ? issues
    : issues.filter(i => wcagLevels.includes(i.wcag_level));
}

/**
 * Render issues grouped by WCAG level (A -> AA -> AAA) with severity icon inline.
 *
 * Violations (CRITICAL / SERIOUS / MODERATE) are listed under their WCAG level
 * heading. MINOR issues (good practices) are appended as a final section.
 * If there are no issues at all, a pass message is returned instead.
 *
 * @param issues - All issues (violations + good practices)
 * @returns Array of markdown lines ready to spread into a lines array
 */
export function formatIssuesByLevel(issues: A11yIssue[]): string[] {
  const violations = issues.filter(i => i.severity !== 'MINOR');
  const goodPractices = issues.filter(i => i.severity === 'MINOR');

  if (violations.length === 0 && goodPractices.length === 0) {
    return ['**No WCAG 2.2 AA violations found.** 🎉', ''];
  }

  const lines: string[] = [];
  const byLevel = groupByWcagLevel(violations);
  const levelMeta: Record<WcagLevel, string> = {
    A: 'Critical Blockers',
    AA: 'Standard Legal Baseline',
    AAA: 'Enhanced / Specialized',
  };

  for (const level of (['A', 'AA', 'AAA'] as WcagLevel[])) {
    const levelIssues = byLevel[level];
    if (levelIssues.length === 0) continue;

    lines.push(`### Level ${level} — ${levelMeta[level]} (${levelIssues.length})`);
    lines.push('');
    for (const issue of levelIssues) {
      lines.push(formatIssueListItem(issue));
    }
    lines.push('');
  }

  if (goodPractices.length > 0) {
    lines.push(`### 🔵 Good Practices (${goodPractices.length})`);
    lines.push('');
    lines.push('These are not violations but represent accessibility best practices:');
    lines.push('');
    for (const issue of goodPractices) {
      lines.push(formatIssueListItem(issue));
    }
    lines.push('');
  }

  return lines;
}

/**
 * Build the WCAG Level Breakdown markdown table lines.
 *
 * @param issues     - Issues to summarise (already filtered to active levels)
 * @param wcagLevels - Active WCAG levels; suppressed levels are struck-through
 * @returns Array of markdown lines (ready to spread into a lines array)
 */
export function formatWcagBreakdownTable(
  issues: A11yIssue[],
  wcagLevels: WcagLevel[] = ['A', 'AA', 'AAA']
): string[] {
  const byLevel = groupByWcagLevel(issues);
  const activeLabel = wcagLevels.length === 3 ? 'A, AA, AAA' : wcagLevels.join(', ');
  const levelMeta: Record<WcagLevel, string> = {
    A: 'Critical blockers',
    AA: 'Standard legal baseline',
    AAA: 'Enhanced / specialized',
  };

  const rows = (['A', 'AA', 'AAA'] as WcagLevel[]).map(level => {
    const count = byLevel[level].length;
    const active = wcagLevels.includes(level);
    const cell = active ? `**${level}**` : `~~${level}~~`;
    return `| ${cell} | ${levelMeta[level]} | ${active ? count : '—'} |`;
  });

  return [
    `### WCAG Level Breakdown _(reporting: ${activeLabel})_`,
    '',
    '| Level | Description | Issues |',
    '|-------|-------------|--------|',
    ...rows,
    '',
  ];
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

/**
 * Escape HTML characters so they render as literal text in markdown.
 */
export function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
