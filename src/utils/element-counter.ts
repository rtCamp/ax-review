/**
 * Element counting utilities for completeness verification.
 * 
 * This module counts accessibility-relevant elements in diffs to verify
 * the LLM didn't miss any issues. This is a local operation (no LLM call)
 * so it's essentially free in terms of API costs.
 * 
 * @module utils/element-counter
 */

import type { FilePatch } from '../types';

/**
 * Counts of accessibility-relevant elements found in diffs.
 */
export interface ElementCounts {
  /** <img> elements */
  images: number;
  /** <input> elements (all types) */
  inputs: number;
  /** <button> elements */
  buttons: number;
  /** <a> elements */
  links: number;
  /** <svg> elements */
  svgs: number;
  /** Elements with onClick (potential keyboard issues) */
  onClickHandlers: number;
  /** Elements with role attribute */
  roleAttributes: number;
  /** <label> elements */
  labels: number;
  /** aria-label attributes */
  ariaLabels: number;
}

/**
 * Element counting result with details.
 */
export interface CountResult {
  /** Total counts across all files */
  counts: ElementCounts;
  /** Per-file breakdown for debugging */
  byFile: Map<string, ElementCounts>;
}

/**
 * Comparison between reported issues and actual elements.
 */
export interface VerificationResult {
  /** Potential missing issues (element exists but no issue reported) */
  potentialGaps: string[];
  /** Files that might need re-analysis */
  filesWithGaps: string[];
  /** Whether verification passed (no gaps detected) */
  passed: boolean;
}

/**
 * Count accessibility-relevant elements in a file diff.
 * 
 * This function parses the diff content and counts elements that
 * commonly have accessibility issues. It only counts ADDED lines
 * (lines starting with '+'), not deleted or context lines.
 * 
 * **Why this is cost-effective:**
 * - Uses simple regex matching - no LLM call needed
 * - Runs locally in milliseconds
 * - Helps detect when LLM missed elements
 * 
 * @param patch - The git diff patch content
 * @returns Counts of accessibility-relevant elements
 */
export function countElementsInDiff(patch: string): ElementCounts {
  const counts: ElementCounts = {
    images: 0,
    inputs: 0,
    buttons: 0,
    links: 0,
    svgs: 0,
    onClickHandlers: 0,
    roleAttributes: 0,
    labels: 0,
    ariaLabels: 0,
  };

  const lines = patch.split('\n');

  for (const line of lines) {
    // Only count ADDED lines (not deleted or context)
    if (!line.startsWith('+') || line.startsWith('+++')) {
      continue;
    }

    // Remove the leading '+' for cleaner matching
    const code = line.slice(1);

    // Count elements using regex
    // Note: These patterns intentionally over-match to be conservative
    // Example: <img> might be in a comment, but we count it anyway

    // Images: <img ...>, <Image ...> (React)
    if (/<img[\s>]/i.test(code) || /<Image[\s>]/i.test(code)) {
      counts.images++;
    }

    // Inputs: <input ...>, <input .../> (all variations)
    if (/<input[\s/>]/i.test(code)) {
      counts.inputs++;
    }

    // Buttons: <button ...>, <Button ...> (React)
    if (/<button[\s>]/i.test(code) || /<Button[\s>]/i.test(code)) {
      counts.buttons++;
    }

    // Links: <a href...>, <Link ...> (React Router)
    if (/<a[\s][^>]*href/i.test(code) || /<Link[\s>]/i.test(code)) {
      counts.links++;
    }

    // SVGs: <svg ...>
    if (/<svg[\s>]/i.test(code)) {
      counts.svgs++;
    }

    // onClick handlers (potential keyboard issues)
    if (/onClick\s*[=:]/i.test(code)) {
      counts.onClickHandlers++;
    }

    // Elements with role attribute
    if (/role\s*=\s*["'][^"']+["']/i.test(code)) {
      counts.roleAttributes++;
    }

    // Labels: <label ...>, <Label ...> (React)
    if (/<label[\s>]/i.test(code) || /<Label[\s>]/i.test(code)) {
      counts.labels++;
    }

    // aria-label attributes
    if (/aria-label\s*=/i.test(code)) {
      counts.ariaLabels++;
    }
  }

  return counts;
}

/**
 * Count elements across multiple file patches.
 * 
 * @param files - Array of file patches
 * @returns Aggregate counts and per-file breakdown
 */
export function countElementsInFiles(files: FilePatch[]): CountResult {
  const byFile = new Map<string, ElementCounts>();
  const totals: ElementCounts = {
    images: 0,
    inputs: 0,
    buttons: 0,
    links: 0,
    svgs: 0,
    onClickHandlers: 0,
    roleAttributes: 0,
    labels: 0,
    ariaLabels: 0,
  };

  for (const file of files) {
    const counts = countElementsInDiff(file.patch);
    byFile.set(file.filename, counts);

    // Aggregate totals
    totals.images += counts.images;
    totals.inputs += counts.inputs;
    totals.buttons += counts.buttons;
    totals.links += counts.links;
    totals.svgs += counts.svgs;
    totals.onClickHandlers += counts.onClickHandlers;
    totals.roleAttributes += counts.roleAttributes;
    totals.labels += counts.labels;
    totals.ariaLabels += counts.ariaLabels;
  }

  return { counts: totals, byFile };
}

/**
 * Count reported issues by type from LLM analysis result.
 * 
 * @param issues - Array of issues from LLM
 * @returns Counts of reported issues by category
 */
export function countReportedIssues(issues: Array<{ wcag_criterion: string; title: string }>): {
  altTextIssues: number;
  labelIssues: number;
  keyboardIssues: number;
  ariaIssues: number;
  linkIssues: number;
} {
  const counts = {
    altTextIssues: 0,
    labelIssues: 0,
    keyboardIssues: 0,
    ariaIssues: 0,
    linkIssues: 0,
  };

  for (const issue of issues) {
    const criterion = issue.wcag_criterion;
    const title = issue.title.toLowerCase();

    // Alt text issues (WCAG 1.1.1)
    if (criterion === '1.1.1' || title.includes('alt') || title.includes('image') || title.includes('svg')) {
      counts.altTextIssues++;
    }

    // Label issues (WCAG 3.3.2, 1.3.1)
    if (criterion === '3.3.2' || criterion === '1.3.1' || 
        title.includes('label') || title.includes('input') || title.includes('form')) {
      counts.labelIssues++;
    }

    // Keyboard issues (WCAG 2.1.1)
    if (criterion === '2.1.1' || title.includes('keyboard') || title.includes('focus')) {
      counts.keyboardIssues++;
    }

    // ARIA issues (WCAG 4.1.2)
    if (criterion === '4.1.2' || title.includes('aria') || title.includes('role')) {
      counts.ariaIssues++;
    }

    // Link issues (WCAG 2.4.4)
    if (criterion === '2.4.4' || title.includes('link') || title.includes('href')) {
      counts.linkIssues++;
    }
  }

  return counts;
}

/**
 * Verify completeness by comparing element counts to reported issues.
 * 
 * This is a heuristic check - it flags POTENTIAL gaps, not definitive
 * misses. The goal is to catch obvious under-reporting like:
 * - 5 <img> tags but only 1 alt text issue reported
 * - 4 <input> elements but only 1 label issue reported
 * 
 * **Heuristic thresholds:**
 * - If #elements > 2x #issues, flag as potential gap
 * - This accounts for: elements with proper attributes, similar issues grouped
 * 
 * **Cost considerations:**
 * - This verification is FREE (local computation)
 * - Re-analysis is only triggered if gaps detected
 * - Most PRs will pass verification with no issues
 * 
 * @param elementCounts - Counts from diff parsing
 * @param reportedIssues - Issues reported by LLM
 * @returns Verification result with potential gaps
 */
export function verifyCompleteness(
  elementCounts: ElementCounts,
  reportedIssues: Array<{ wcag_criterion: string; title: string }>
): VerificationResult {
  const reportedCounts = countReportedIssues(reportedIssues);
  const potentialGaps: string[] = [];

  // Check for potential image alt text gaps
  // Every <img> should have alt, so if we have more imgs than issues, flag it
  if (elementCounts.images > 0 && reportedCounts.altTextIssues < elementCounts.images) {
    const ratio = elementCounts.images / Math.max(reportedCounts.altTextIssues, 1);
    if (ratio > 1.5) {
      potentialGaps.push(
        `Found ${elementCounts.images} <img> elements but only ${reportedCounts.altTextIssues} alt text issues reported. ` +
        `Some images may be missing alt attributes.`
      );
    }
  }

  // Check for potential label gaps
  // Inputs need labels, so ratio > 2 is suspicious
  if (elementCounts.inputs > 0 && reportedCounts.labelIssues < elementCounts.inputs) {
    const ratio = elementCounts.inputs / Math.max(reportedCounts.labelIssues, 1);
    if (ratio > 2) {
      potentialGaps.push(
        `Found ${elementCounts.inputs} <input> elements but only ${reportedCounts.labelIssues} label issues reported. ` +
        `Some inputs may be missing labels.`
      );
    }
  }

  // Check for potential keyboard gaps
  // onClick handlers need keyboard equivalents
  if (elementCounts.onClickHandlers > 0 && reportedCounts.keyboardIssues < elementCounts.onClickHandlers) {
    const ratio = elementCounts.onClickHandlers / Math.max(reportedCounts.keyboardIssues, 1);
    if (ratio > 2) {
      potentialGaps.push(
        `Found ${elementCounts.onClickHandlers} onClick handlers but only ${reportedCounts.keyboardIssues} keyboard issues reported. ` +
        `Some interactive elements may lack keyboard support.`
      );
    }
  }

  return {
    potentialGaps,
    filesWithGaps: [],
    passed: potentialGaps.length === 0,
  };
}