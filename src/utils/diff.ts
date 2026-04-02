/**
 * Diff formatting utilities for LLM consumption.
 * Prepares diffs with position markers for analysis.
 * 
 * @module utils/diff
 */

import type { FilePatch } from '../types';

/**
 * Format a file patch for LLM analysis.
 * Adds position markers for line mapping.
 */
export function formatDiff(file: FilePatch): string {
  const lines = file.patch.split('\n');
  const formatted: string[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    // Diff headers
    if (line.startsWith('+++') || line.startsWith('---')) {
      formatted.push(line);
      continue;
    }

    // Hunk header
    if (line.startsWith('@@')) {
      formatted.push(line);
      const match = line.match(/\+(\d+)/);
      if (match && match[1]) {
        lineNumber = parseInt(match[1], 10);
      }
      continue;
    }

    // Added line
    if (line.startsWith('+')) {
      formatted.push(`[${lineNumber}] ${line}`);
      lineNumber++;
      continue;
    }

    // Removed line - skip
    if (line.startsWith('-')) {
      continue;
    }

    // Context line
    if (!line.startsWith('\\')) {
      formatted.push(`[${lineNumber}] ${line}`);
      lineNumber++;
    }
  }

  return formatted.join('\n');
}

/**
 * Format all files for LLM analysis.
 */
export function formatAllDiffs(files: FilePatch[]): string {
  const sections: string[] = [];

  for (const file of files) {
    sections.push(`[FILE] ${file.filename}`);
    sections.push(`[STATUS] ${file.status}`);
    sections.push('[DIFF]');
    sections.push(formatDiff(file));
    sections.push('[END DIFF]');
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Extract added lines from a patch.
 */
export function extractAddedLines(patch: string): Map<number, string> {
  const lines = new Map<number, string>();
  const patchLines = patch.split('\n');
  let lineNumber = 0;

  for (const line of patchLines) {
    // Hunk header
    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/);
      if (match && match[1]) {
        lineNumber = parseInt(match[1], 10);
      }
      continue;
    }

    // Added line
    if (line.startsWith('+') && !line.startsWith('+++')) {
      lines.set(lineNumber, line.substring(1)); // Remove '+' prefix
      lineNumber++;
      continue;
    }

    // Removed line - just track position
    if (line.startsWith('-') && !line.startsWith('---')) {
      continue;
    }

    // Context line
    if (!line.startsWith('\\')) {
      lineNumber++;
    }
  }

  return lines;
}

/**
 * Check if a line number is in the added lines.
 */
export function isAddedLineNumber(patch: string, lineNumber: number): boolean {
  const addedLines = extractAddedLines(patch);
  return addedLines.has(lineNumber);
}

/**
 * Count lines in a diff patch.
 */
export function countLines(patch: string): { added: number; removed: number; context: number } {
  const lines = patch.split('\n');
  let added = 0;
  let removed = 0;
  let context = 0;

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    } else if (!line.startsWith('\\') && !line.startsWith('@@')) {
      context++;
    }
  }

  return { added, removed, context };
}