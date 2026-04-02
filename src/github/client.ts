/**
 * GitHub API client using Octokit.
 * Wraps the GitHub API for PR operations.
 * 
 * @module github/client
 */

import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import type { FilePatch, PRInfo, FileStatus, CheckAnnotation } from '../types';
import { GITHUB_LIMITS } from '../constants';

/**
 * Valid file status values from GitHub API.
 */
const VALID_FILE_STATUSES: ReadonlySet<string> = new Set(['added', 'modified', 'removed', 'renamed']);

/**
 * Validates and casts a file status to FileStatus type.
 * Throws on invalid status values for safer runtime validation.
 */
function validateFileStatus(status: string): FileStatus {
  if (!VALID_FILE_STATUSES.has(status)) {
    throw new Error(
      `Invalid file status '${status}'. Expected one of: added, modified, removed, renamed. ` +
      `This may indicate an unsupported file change type or GitHub API change.`
    );
  }
  return status as FileStatus;
}

/**
 * GitHub client for PR operations.
 */
export class GitHubClient {
  private readonly octokit: ReturnType<typeof getOctokit>;
  private readonly owner: string;
  private readonly repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = getOctokit(token);
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Fetch PR metadata.
   */
  async getPRInfo(prNumber: number): Promise<PRInfo> {
    const { data: pr } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? null,
      headSha: pr.head.sha,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      isDraft: pr.draft ?? false,
      author: pr.user?.login ?? 'unknown',
      owner: this.owner,
      repo: this.repo,
    };
  }

  /**
   * Fetch all files in a PR with pagination.
   */
  async getPRFiles(prNumber: number): Promise<FilePatch[]> {
    try {
      const files: FilePatch[] = [];
      let page = 1;

      while (true) {
        const response = await this.octokit.rest.pulls.listFiles({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          per_page: GITHUB_LIMITS.PER_PAGE,
          page,
        });

        for (const file of response.data) {
          // Skip removed files
          if (file.status === 'removed') {
            continue;
          }

          // Skip files without patch (binary files, large files)
          if (!file.patch) {
            core.debug(`Skipping ${file.filename} - no patch available`);
            continue;
          }

          // Validate file status
          const status = validateFileStatus(file.status);
          
          files.push({
            filename: file.filename,
            patch: file.patch,
            status,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
          });
        }

        // Check if we need to paginate
        if (response.data.length < GITHUB_LIMITS.PER_PAGE) {
          break;
        }
        page++;
      }

      return files;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch PR files: ${message}. ` +
        `Please ensure the PR exists and you have read access to the repository.`
      );
    }
  }

  /**
   * Create a PR review with inline comments.
   */
  async createReview(
    prNumber: number,
    headSha: string,
    comments: Array<{ path: string; position: number; body: string }>,
    body: string
  ): Promise<number> {
    const { data: review } = await this.octokit.rest.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: comments.length > 0 ? 'COMMENT' : 'COMMENT',
      body,
      comments: comments.slice(0, GITHUB_LIMITS.MAX_REVIEW_COMMENTS),
    });

    core.info(`Created review ${review.id} with ${comments.length} comments`);
    return review.id;
  }

  /**
   * Create a Check Run with annotations.
   */
  async createCheckRun(
    headSha: string,
    violations: number,
    goodPractices: number,
    summary: string,
    annotations: CheckAnnotation[]
  ): Promise<number> {
    const conclusion = violations > 0 ? 'failure' : 'success';
    const title = violations > 0 
      ? `Accessibility Review: ${violations} violations, ${goodPractices} suggestions`
      : `Accessibility Review: Passed with ${goodPractices} suggestions`;

    const { data: checkRun } = await this.octokit.rest.checks.create({
      owner: this.owner,
      repo: this.repo,
      name: 'Accessibility Review',
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title,
        summary,
        annotations: annotations.slice(0, GITHUB_LIMITS.MAX_ANNOTATIONS),
      },
    });

    core.info(`Created check run ${checkRun.id} with ${annotations.length} annotations`);
    return checkRun.id;
  }

  /**
   * Build a map from line number to diff position.
   * GitHub's review API uses diff position (not file line number).
   */
  buildLineToPositionMap(patch: string): Map<number, number> {
    const map = new Map<number, number>();
    const lines = patch.split('\n');
    
    let position = 0;
    let newFileLine = 0;

    for (const line of lines) {
      // Parse hunk header: @@ -a,b +start,count @@
      if (line.startsWith('@@')) {
        const match = line.match(/\+(\d+)/);
        if (match && match[1]) {
          newFileLine = parseInt(match[1], 10);
        }
        continue;
      }

      // Skip file headers
      if (line.startsWith('+++') || line.startsWith('---')) {
        continue;
      }

      // Added line
      if (line.startsWith('+') && !line.startsWith('+++')) {
        position++;
        map.set(newFileLine, position);
        newFileLine++;
        continue;
      }

      // Removed line
      if (line.startsWith('-') && !line.startsWith('---')) {
        position++;
        continue;
      }

      // Context line
      if (!line.startsWith('\\')) {
        position++;
        newFileLine++;
      }
    }

    return map;
  }
}