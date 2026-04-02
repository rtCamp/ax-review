/**
 * Gitleaks integration for secret detection and redaction.
 * Prevents leaking secrets to LLM APIs by scanning diffs.
 * 
 * @module security/gitleaks
 */

import * as core from '@actions/core';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { FilePatch, SecretFinding } from '../types';

/**
 * Result of gitleaks scan.
 */
interface GitleaksFinding {
  RuleID: string;
  File: string;
  Line: number;
  Secret: string;
  Match: string;
}

/**
 * Scan file patches for secrets and redact them.
 * 
 * @param files - File patches to scan
 * @param skipOnFailure - If true, skip analysis on gitleaks failure (default: false)
 * @returns Files with secrets redacted and count of secrets found
 */
export async function redactSecrets(
  files: FilePatch[],
  skipOnFailure: boolean = false
): Promise<{ files: FilePatch[]; secretsFound: number; skipped: boolean }> {
  // Check if gitleaks is available
  const gitleaksAvailable = await isGitleaksAvailable();
  
  if (!gitleaksAvailable) {
    core.warning('Gitleaks not found - skipping secret detection. Install gitleaks for enhanced security.');
    return { files, secretsFound: 0, skipped: false };
  }

  // Create temp file with all diffs
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'gitleaks-scan-'));
  const tempFile = path.join(tempDir, 'diffs.txt');
  
  try {
    // Write all patches to temp file
    const content = files
      .map(f => `=== ${f.filename} ===\n${f.patch}`)
      .join('\n\n');
    fs.writeFileSync(tempFile, content);

    // Run gitleaks safely using execFile (no shell interpolation)
    const result = await runGitleaks(tempFile, tempDir);
    
    if (result.error) {
      core.warning(`Gitleaks scan failed: ${result.error}`);
      if (skipOnFailure) {
        core.warning('Skipping analysis due to gitleaks failure and skip-on-failure setting.');
        return { files: [], secretsFound: 0, skipped: true };
      }
      // Return original files if gitleaks fails but we're not skipping
      return { files, secretsFound: 0, skipped: false };
    }
    
    // Redact secrets
    const redactedFiles = redactSecretsFromPatches(files, result.findings);
    
    core.info(`Gitleaks found ${result.findings.length} potential secrets - redacted from analysis`);
    
    return { 
      files: redactedFiles, 
      secretsFound: result.findings.length,
      skipped: false
    };
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if gitleaks is available in PATH.
 */
async function isGitleaksAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('gitleaks', ['version'], (error) => {
      resolve(!error);
    });
  });
}

/**
 * Run gitleaks on the diff file using execFile (safe from command injection).
 */
async function runGitleaks(
  filePath: string,
  reportDir: string
): Promise<{ findings: GitleaksFinding[]; error?: string }> {
  const reportPath = path.join(reportDir, 'report.json');
  
  return new Promise((resolve) => {
    // Use execFile with argument array - NO shell interpolation
    // This prevents command injection via filePath or reportDir
    const args = [
      'detect',
      `--source=${filePath}`,
      '--report-format=json',
      `--report-path=${reportPath}`,
      '--no-git',
      '--exit-code=0'
    ];
    
    execFile('gitleaks', args, { maxBuffer: 1024 * 1024 * 10 }, (error) => {
      // Gitleaks with --exit-code=0 should always succeed
      // but we handle errors gracefully
      
      try {
        if (fs.existsSync(reportPath)) {
          const content = fs.readFileSync(reportPath, 'utf-8');
          const findings = JSON.parse(content) as GitleaksFinding[];
          resolve({ findings });
        } else {
          resolve({ findings: [] });
        }
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown parse error';
        core.warning(`Failed to parse gitleaks report: ${errorMsg}`);
        resolve({ findings: [], error: errorMsg });
      }
    });
  });
}

/**
 * Redact secrets from file patches.
 */
function redactSecretsFromPatches(
  files: FilePatch[],
  findings: GitleaksFinding[]
): FilePatch[] {
  if (findings.length === 0) {
    return files;
  }

  return files.map(file => {
    let redactedPatch = file.patch;
    
    for (const finding of findings) {
      // Only redact if the finding is for this file
      if (finding.File === file.filename && finding.Secret) {
        // Replace the secret with [REDACTED]
        const secretPattern = escapeRegex(finding.Secret);
        const regex = new RegExp(secretPattern, 'g');
        redactedPatch = redactedPatch.replace(regex, '[REDACTED]');
      }
    }
    
    return {
      ...file,
      patch: redactedPatch,
    };
  });
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check for secrets in CI mode without file system operations.
 * Returns findings for logging purposes only (secrets already scanned).
 */
export function logSecretFindings(findings: SecretFinding[]): void {
  if (findings.length === 0) {
    core.info('No secrets detected in diffs');
    return;
  }

  core.warning(`Detected ${findings.length} potential secrets - they have been redacted before LLM analysis`);
  
  for (const finding of findings) {
    core.debug(`Secret found: ${finding.ruleId} in ${finding.file}:${finding.line}`);
  }
}