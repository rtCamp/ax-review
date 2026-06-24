/**
 * Reads pre-generated accessibility findings from a directory and
 * normalizes them into a single string for LLM prompt injection.
 *
 * Supports any file format - JSON reports, plain text, markdown.
 * Content is passed as-is; the LLM handles parsing.
 *
 * @module utils/findings
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';

/** Maximum characters to include from findings before truncating. */
const MAX_FINDINGS_CHARS = 24000;

/** File extensions to read. Everything else (binaries, images) is skipped. */
const READABLE_EXTENSIONS = new Set([
  '.json', '.txt', '.md', '.html', '.xml', '.csv', '.log',
]);

export interface FindingsResult {
  content: string;
  fileCount: number;
  truncated: boolean;
}

/**
 * Load accessibility findings from a file or directory.
 *
 * @param findingsDir - Path to the findings directory or report file.
 *
 * @returns Normalized findings results, or null when no readable findings exist.
 */
export function loadFindings(findingsDir: string): FindingsResult | null {
  const resolved = path.resolve(findingsDir);

  if (!fs.existsSync(resolved)) {
    core.warning(
      `a11y-findings-dir '${findingsDir}' does not exist. ` +
      `Running in AI-only mode.`
    );
    return null;
  }

  const stat = fs.statSync(resolved);

  const files: string[] = stat.isDirectory()
    ? fs.readdirSync(resolved)
      .filter(f => READABLE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map(f => path.join(resolved, f))
    : [resolved];

  if (files.length === 0) {
    core.info(`a11y-findings-dir '${findingsDir}' contains no readable files. Running in AI-only mode.`);
    return null;
  }

  const sections: string[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const file of files) {
    if (truncated) break;

    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) continue;

      const header = `=== ${path.basename(file)} ===`;
      const section = `${header}\n${raw}`;

      if (totalChars + section.length > MAX_FINDINGS_CHARS) {
        const remaining = MAX_FINDINGS_CHARS - totalChars - header.length - 1;
        if (remaining > 100) {
          sections.push(`${header}\n${raw.slice(0, remaining)}\n[...truncated]`);
        }
        truncated = true;
        break;
      }

      sections.push(section);
      totalChars += section.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.warning(`Could not read findings file '${file}': ${msg}`);
    }
  }

  if (sections.length === 0) return null;

  if (truncated) {
    core.warning(
      `Findings content exceeded ${MAX_FINDINGS_CHARS} characters and was truncated. ` +
      `Consider reducing the number of files in '${findingsDir}'.`
    );
  }

  core.info(
    `Loaded ${sections.length} findings file(s) from '${findingsDir}'` +
    (truncated ? ' (truncated)' : '')
  );

  return {
    content: sections.join('\n\n'),
    fileCount: sections.length,
    truncated,
  };
}
