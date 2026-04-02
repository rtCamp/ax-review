/**
 * Statistics calculation utilities.
 * 
 * Provides functions for aggregating and calculating
 * statistics from accessibility analysis results.
 * 
 * @module utils/stats
 * 
 * @example
 * import { calculateStats } from './utils/stats';
 * 
 * const stats = calculateStats(issues);
 * console.log(`Violations: ${stats.violations}`);
 */

import type { A11yIssue } from '../types';

/**
 * Statistics from accessibility analysis.
 */
export interface IssueStats {
  total: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  violations: number;
  goodPractices: number;
}

/**
 * Calculate statistics from analysis issues.
 */
export function calculateStats(issues: A11yIssue[]): IssueStats {
  return {
    total: issues.length,
    critical: issues.filter(i => i.severity === 'CRITICAL').length,
    serious: issues.filter(i => i.severity === 'SERIOUS').length,
    moderate: issues.filter(i => i.severity === 'MODERATE').length,
    minor: issues.filter(i => i.severity === 'MINOR').length,
    violations: issues.filter(i => 
      i.severity === 'CRITICAL' || i.severity === 'SERIOUS' || i.severity === 'MODERATE'
    ).length,
    goodPractices: issues.filter(i => i.severity === 'MINOR').length,
  };
}