# ax-review Implementation Plan

A simplified GitHub Action for automated WCAG 2.2 accessibility review of PR diffs using LLMs.

## Overview

**Goal**: Build a maintainable GitHub Action where a new developer can understand the entire codebase in under 4 hours.

**Key Principles**:
1. Flat, minimal directory structure
2. Clear separation of concerns
3. Well-documented TypeScript with explicit types
4. Provider abstraction for easy LLM switching
5. Comprehensive inline comments explaining business logic

---

## Project Structure

```
ax-review/
├── action.yml                    # GitHub Action inputs/outputs
├── package.json                  # Dependencies (Bun-first)
├── tsconfig.json                 # TypeScript config
├── bunfig.toml                   # Bun configuration
├── src/
│   ├── index.ts                  # Entry point - orchestrates flow
│   ├── types.ts                  # All shared TypeScript interfaces
│   ├── inputs.ts                 # Parse and validate action.yml inputs
│   │
│   ├── llm/
│   │   ├── index.ts              # LLM client factory (hot-swap logic)
│   │   ├── types.ts              # LLMClient interface + response types
│   │   ├── gemini.ts             # Gemini API client implementation
│   │   └── ollama.ts             # Ollama API client implementation
│   │
│   ├── github/
│   │   ├── client.ts             # GitHub API client (Octokit wrapper)
│   │   ├── pr.ts                 # PR file fetching with pagination
│   │   ├── comments.ts           # PR review comments formatting/posting
│   │   └── checks.ts             # Check Run creation & annotations
│   │
│   ├── prompts/
│   │   └── a11y-prompt.ts        # WCAG 2.2 system & user prompt building
│   │
│   ├── security/
│   │   └── gitleaks.ts           # Gitleaks integration for secret detection/redaction
│   │
│   └── utils/
│       ├── diff.ts               # Diff formatting for LLM consumption
│       └── batching.ts           # File batching logic
│
├── dist/                         # Compiled action (auto-generated)
│   └── index.js
│
└── .github/
    └── workflows/
        └── test.yml              # Self-test workflow
```

**Why this structure?**
- Maximum 3 levels deep
- Each folder has clear purpose
- `src/llm/` contains all LLM logic (easy to add new providers)
- `src/github/` isolates all GitHub API interactions
- `src/prompts/` keeps prompt engineering separate
- `src/security/` dedicated to secret handling

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PR Event Triggered                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          1. VALIDATION (index.ts)                            │
│  • Parse action.yml inputs                                                   │
│  • Validate required fields (token, provider, api-key for Gemini)           │
│  • Skip draft PRs if configured                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     2. FETCH PR DATA (github/pr.ts)                          │
│  • Get PR metadata (head SHA, author, title)                                │
│  • Fetch all changed files with patches (paginated, 100/page)               │
│  • Filter: keep added/modified, skip removed files                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    3. SECRET DETECTION (security/gitleaks.ts)                │
│  • Run gitleaks on diff content                                             │
│  • Scan all file diffs for potential secrets                                 │
│  • REDACT secrets, continue processing remaining content                    │
│  • Log redacted secrets (count only, not the actual secret)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     4. BATCH FILES (utils/batching.ts)                       │
│  • Group files into batches of configurable size (default: 20)              │
│  • Enforce configurable max files limit (default: 100)                      │
│  • Respect token limits per provider                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     5. LLM ANALYSIS (llm/index.ts)                           │
│  • Select provider based on input (gemini | ollama)                         │
│  • Build prompt with WCAG 2.2 system prompt + diff context                  │
│  • Call LLM API with JSON schema response format                             │
│  • Parse response into A11yIssue[]                                          │
│  • Aggregate results across batches                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      6. POST RESULTS (github/comments.ts)                     │
│  • Enforce GitHub limits (max 50 annotations for checks)                    │
│  • If output-mode = "comments":                                              │
│      - Create PR review with inline comments (violations only)               │
│      - Post summary comment with all issues                                  │
│  • If output-mode = "checks":                                                │
│      - Create Check Run with annotations                                     │
│      - Violations = failure level, good practices = notice level            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         7. SET OUTPUTS (index.ts)                            │
│  • issues-found: total count                                                 │
│  • violations: VIOLATION severity count                                      │
│  • good-practices: GOOD_PRACTICE severity count                              │
│  • Exit with code 1 if fail-on-issues=true and violations > 0               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Input/Output Contract

### Action Inputs (action.yml)

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | `${{ github.token }}` | GitHub API token |
| `llm-provider` | Yes | `gemini` | `"gemini"` or `"ollama"` |
| `api-key` | Conditional | - | API key (required for Gemini, optional for Ollama) |
| `model` | No | Provider-specific default | Model name to use |
| `ollama-url` | No | `http://localhost:11434` | Ollama server URL |
| `output-mode` | No | `comments` | `"comments"` or `"checks"` |
| `fail-on-issues` | No | `true` | Fail action on VIOLATION issues |
| `max-files` | No | `100` | Maximum files to analyze |
| `batch-size` | No | `20` | Files per LLM request |
| `skip-drafts` | No | `true` | Skip draft PRs |

### Action Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Total issues count |
| `violations` | VIOLATION severity count |
| `good-practices` | GOOD_PRACTICE severity count |

---

## Core Types

```typescript
// src/types.ts

/**
 * Represents a single accessibility issue found in the PR diff.
 */
export interface A11yIssue {
  /** Relative file path from repo root */
  file: string;
  
  /** Line number in the NEW file (1-indexed), null if not line-specific */
  line: number | null;
  
  /** WCAG 2.2 criterion number (e.g., "1.1.1", "2.4.4") */
  wcag_criterion: string;
  
  /** WCAG conformance level: "A", "AA", or "AAA" */
  wcag_level: 'A' | 'AA' | 'AAA';
  
  /** Issue severity - VIOLATION is must-fix, GOOD_PRACTICE is recommended */
  severity: 'VIOLATION' | 'GOOD_PRACTICE';
  
  /** Short, actionable title for the issue */
  title: string;
  
  /** Explanation of why this is an accessibility problem */
  description: string;
  
  /** EXACT code fix (not instructions). Must be copy-paste ready. */
  suggestion: string;
}

/**
 * A file changed in the PR with its diff patch.
 */
export interface FilePatch {
  /** Relative file path */
  filename: string;
  
  /** Git diff patch content */
  patch: string;
  
  /** Git status of the file */
  status: 'added' | 'modified' | 'removed' | 'renamed';
}

/**
 * LLM provider options - hot-swappable via config.
 */
export type LLMProvider = 'gemini' | 'ollama';

/**
 * Output mode for posting results.
 */
export type OutputMode = 'comments' | 'checks';

/**
 * Result from LLM analysis.
 */
export interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

/**
 * Secret detected by Gitleaks (redacted before LLM processing).
 */
export interface SecretFinding {
  file: string;
  line: number;
  ruleId: string;
  redacted: string; // REDACTED placeholder
}
```

---

## LLM Client Interface

```typescript
// src/llm/types.ts

/**
 * Abstract interface for LLM providers.
 * Implement this interface to add a new provider.
 * 
 * Hot-swap is achieved by:
 * 1. Implement this interface
 * 2. Add provider name to LLMProvider type
 * 3. Register in src/llm/index.ts factory
 */
export interface LLMClient {
  /**
   * The provider name (e.g., "gemini", "ollama").
   */
  readonly provider: string;
  
  /**
   * Analyze diff content for accessibility issues.
   * 
   * @param systemPrompt - WCAG 2.2 expert system prompt
   * @param userPrompt - Formatted diff with repository context
   * @returns Promise<AnalysisResult> - Parsed issues and summary
   * @throws {LLMError} - On API failure or invalid response
   */
  analyze(
    systemPrompt: string,
    userPrompt: string
  ): Promise<AnalysisResult>;
  
  /**
   * Check if the client is properly configured.
   * Call this during validation to fail early.
   */
  validateConfig(): Promise<boolean>;
}

/**
 * Configuration for a specific LLM provider.
 * Each provider has its own config schema.
 */
export interface GeminiConfig {
  apiKey: string;
  model: string; // Default: "gemini-2.0-flash"
}

export interface OllamaConfig {
  baseUrl: string;
  model: string; // Default: "llama3.2"
  apiKey?: string; // Optional for bearer token auth
}
```

---

## Implementation Details

### 1. Gitleaks Integration (Secret Redaction)

**Why**: Prevent accidental exposure of secrets to third-party LLM APIs.

**How it works**:
1. Collect all file diffs into a single string
2. Write to a temporary file
3. Run `gitleaks detect --source <tempfile> --report-format json --report-path <output.json>`
4. Parse findings and replace secrets in diffs with `[REDACTED]`
5. Continue with redacted content

```typescript
// src/security/gitleaks.ts

export async function redactSecrets(
  files: FilePatch[]
): Promise<{ files: FilePatch[]; secretsFound: number }> {
  // Implementation steps:
  // 1. Install gitleaks binary or use Docker image in action
  // 2. Create temp directory with file contents
  // 3. Run gitleaks scan
  // 4. For each finding, replace secret with "[REDACTED]"
  // 5. Return cleaned files
}
```

### 2. Diff Formatting for LLM

**Why**: LLMs need clear, structured input to produce accurate results.

**Format**:
```
[FILE] src/components/Button.tsx
[DIFF]
[1] import React from 'react';
[2] +import { useState } from 'react';
[3] 
[4] -export const Button = ({ label }) => {
[4] +export const Button = ({ label, ariaLabel }) => {
[5] +  // Missing: aria-label should be passed to button
[6]   return (
[7]     <button>{label}</button>
[8]   );
[9] };
[END DIFF]

[FILE] src/components/Modal.tsx
[DIFF]
...
```

**Rules**:
- `[N]` = position marker for diff line mapping
- `+` prefix = added line (eligible for issue reporting)
- `-` prefix = removed line (not analyzed, just context)
- No prefix = context line

### 3. Batch Processing

**Why**: 
- LLM APIs have token limits
- Large PRs need chunked processing
- Rate limiting considerations

```typescript
// src/utils/batching.ts

export function createBatches(
  files: FilePatch[],
  batchSize: number,
  maxFiles: number
): FilePatch[][] {
  // 1. Filter files: skip 'removed' status
  // 2. Truncate to maxFiles if configured
  // 3. Split into batches of batchSize
  // 4. Log warning if truncated
}
```

### 4. Line Position Mapping

**Why**: GitHub review comments require diff position, not file line number.

**How it works**:
1. Parse `@@ -a,b +c,d @@` hunk headers from patch
2. Maintain counter starting at 1 (GitHub's diff position)
3. Map added line numbers to diff positions
4. Return map: `lineNumber -> diffPosition`

```typescript
// src/github/client.ts

export function buildLineToPositionMap(patch: string): Map<number, number> {
  const map = new Map<number, number>();
  let position = 0;
  let newFileLine = 0;
  
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -start,count +start,count @@
      const match = line.match(/\+(\d+)/);
      if (match) newFileLine = parseInt(match[1]);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      position++;
      newFileLine++;
      map.set(newFileLine, position);
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      position++;
      if (!line.startsWith('+')) newFileLine++;
    }
  }
  
  return map;
}
```

### 5. LLM Response Schema

**Why**: Ensure structured output for reliable parsing.

```json
{
  "type": "object",
  "properties": {
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string" },
          "line": { "type": ["integer", "null"] },
          "wcag_criterion": { "type": "string" },
          "wcag_level": { "type": "string", "enum": ["A", "AA", "AAA"] },
          "severity": { "type": "string", "enum": ["VIOLATION", "GOOD_PRACTICE"] },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "suggestion": { "type": "string" }
        },
        "required": ["file", "wcag_criterion", "wcag_level", "severity", "title", "description", "suggestion"]
      }
    },
    "summary": { "type": "string" }
  },
  "required": ["issues", "summary"]
}
```

### 6. Gemini Client Implementation

**Key Points**:
- Use `@google/generative-ai` SDK
- Set `responseMimeType: 'application/json'`
- Provide schema via `responseSchema`
- Temperature: 0.1 for deterministic output

```typescript
// src/llm/gemini.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMClient, AnalysisResult } from './types';

export class GeminiClient implements LLMClient {
  readonly provider = 'gemini';
  
  private client: GoogleGenerativeAI;
  private model: string;
  
  constructor(config: GeminiConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-2.0-flash';
  }
  
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: A11Y_ISSUE_SCHEMA,
      },
      systemInstruction: systemPrompt,
    });
    
    const result = await model.generateContent(userPrompt);
    const text = result.response.text();
    return JSON.parse(text);
  }
  
  async validateConfig(): Promise<boolean> {
    // Try a minimal request to validate API key
    // Return true if successful, false otherwise
  }
}
```

### 7. Ollama Client Implementation

**Key Points**:
- Use native `fetch` to Ollama API
- Set `format: 'json'` for JSON mode
- Set `stream: false` for non-streaming
- Temperature: 0.1 for deterministic output
- Set `num_ctx` to appropriate context window

```typescript
// src/llm/ollama.ts

import { LLMClient, AnalysisResult } from './types';

export class OllamaClient implements LLMClient {
  readonly provider = 'ollama';
  
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  
  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.model = config.model || 'llama3.2';
    this.apiKey = config.apiKey;
  }
  
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_ctx: 32768,
        },
      }),
    });
    
    const data = await response.json();
    return JSON.parse(data.message.content);
  }
  
  async validateConfig(): Promise<boolean> {
    // Check if Ollama server is reachable
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

### 8. Output Modes

#### Comments Mode (Default)

**Pros**:
- Inline comments directly on code lines
- More visible in PR review UI
- Easier for developers to address specific issues

**Implementation**:
1. Create PR review via `POST /repos/{owner}/{repo}/pulls/{number}/reviews`
2. Include inline comments for violations only
3. Put summary + good practices in review body
4. Fall back to PR comment if position mapping fails

#### Checks Mode

**Pros**:
- Creates Check Run in PR Checks tab
- Works even if code changes (no position mapping needed)
- Can mark PR as failing CI check

**Implementation**:
1. Create Check Run via `POST /repos/{owner}/{repo}/check-runs`
2. Add up to 50 annotations (GitHub limit)
3. Violations = `failure` level
4. Good practices = `notice` level

---

## Runtime & Build

### Bun Configuration

```toml
# bunfig.toml
[install]
production = false

[build]
target = "node"
minify = true
sourcemap = "external"
```

### package.json

```json
{
  "name": "ax-review",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "bun build src/index.ts --outfile dist/index.js --target node --minify",
    "dev": "bun run src/index.ts",
    "test": "bun test",
    "lint": "biome check src/",
    "format": "biome format src/ --write"
  },
  "dependencies": {
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0",
    "@google/generative-ai": "^0.21.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Error Handling

### Graceful Degradation

| Error | Recovery |
|-------|----------|
| Gitleaks not installed | Skip redaction, log warning, continue |
| LLM API rate limit | Retry with exponential backoff (max 3) |
| LLM invalid JSON response | Retry once, then skip batch |
| GitHub position mapping fails | Post as PR comment instead of inline |
| Check Run creation fails | Fall back to comments mode |

### Error Messages

```typescript
// User-friendly error messages
const ERROR_MESSAGES = {
  MISSING_API_KEY: 'Missing required input: api-key is required for Gemini provider',
  GITLEAKS_FAILED: 'Gitleaks scan failed, continuing without secret redaction',
  LLM_RATE_LIMIT: 'LLM API rate limited, retrying in {seconds}s...',
  LLM_INVALID_RESPONSE: 'LLM returned invalid JSON, skipping batch',
  GITHUB_POSITION_MAPPING: 'Could not map line to diff position, posting as comment',
};
```

---

## Testing Strategy

### Unit Tests

```typescript
// tests/llm/gemini.test.ts
describe('GeminiClient', () => {
  it('should parse valid JSON response', async () => {
    // Mock fetch, test response parsing
  });
  
  it('should retry on rate limit', async () => {
    // Mock 429 response, test retry logic
  });
});

// tests/github/client.test.ts
describe('buildLineToPositionMap', () => {
  it('should correctly map line numbers to diff positions', () => {
    // Test with sample diff
  });
});

// tests/security/gitleaks.test.ts
describe('redactSecrets', () => {
  it('should replace secrets with [REDACTED]', async () => {
    // Mock gitleaks output
  });
});
```

### Integration Tests

- Test with real GitHub API (using fixture PR)
- Test with mock LLM servers
- Test with actual Gitleaks binary

---

## Development Onboarding Guide

### Quick Start (< 30 minutes)

```bash
# 1. Clone and install
git clone <repo>
cd ax-review
bun install

# 2. Build
bun run build

# 3. Run locally (requires .env with API keys)
bun run dev

# 4. Run tests
bun test
```

### Understanding the Codebase (4 hours)

**Hour 1: Core Flow**
1. Read `src/index.ts` - the orchestrator
2. Read `src/types.ts` - understand data structures
3. Read `src/inputs.ts` - input parsing

**Hour 2: LLM Integration**
1. Read `src/llm/types.ts` - understand the interface
2. Read `src/llm/gemini.ts` - Gemini implementation
3. Read `src/llm/ollama.ts` - Ollama implementation
4. Read `src/llm/index.ts` - factory pattern for hot-swap

**Hour 3: GitHub Integration**
1. Read `src/github/client.ts` - Octokit wrapper
2. Read `src/github/pr.ts` - file fetching
3. Read `src/github/comments.ts` - comment formatting
4. Read `src/github/checks.ts` - Check Run creation

**Hour 4: Supporting Modules**
1. Read `src/prompts/a11y-prompt.ts` - prompt engineering
2. Read `src/security/gitleaks.ts` - secret redaction
3. Read `src/utils/diff.ts` - diff formatting
4. Read `src/utils/batching.ts` - batch logic

### Adding a New LLM Provider

1. Add provider name to `LLMProvider` type in `src/types.ts`
2. Create `src/llm/new-provider.ts` implementing `LLMClient`
3. Add config interface to `src/llm/types.ts`
4. Register in `src/llm/index.ts` factory
5. Add tests in `tests/llm/new-provider.test.ts`

---

## Implementation Checklist

### Phase 1: Foundation (Day 1)
- [ ] Initialize Bun project with TypeScript
- [ ] Set up `action.yml` with inputs/outputs
- [ ] Implement `src/types.ts` with all interfaces
- [ ] Implement `src/inputs.ts` for input parsing
- [ ] Set up ESLint/Biome for linting

### Phase 2: LLM Layer (Day 2)
- [ ] Implement `src/llm/types.ts` with LLMClient interface
- [ ] Implement `src/llm/gemini.ts` for Gemini
- [ ] Implement `src/llm/ollama.ts` for Ollama
- [ ] Implement `src/llm/index.ts` factory
- [ ] Add unit tests for LLM clients

### Phase 3: GitHub Layer (Day 3)
- [ ] Implement `src/github/client.ts` with Octokit
- [ ] Implement `src/github/pr.ts` for file fetching
- [ ] Implement `src/github/comments.ts` for formatting
- [ ] Implement `src/github/checks.ts` for Check Runs
- [ ] Implement position mapping for inline comments
- [ ] Add unit tests for GitHub client

### Phase 4: Security Layer (Day 4)
- [ ] Implement `src/security/gitleaks.ts`
- [ ] Add Gitleaks binary to Docker image (if using)
- [ ] Test secret detection and redaction
- [ ] Add unit tests for gitleaks module

### Phase 5: Prompts & Utils (Day 5)
- [ ] Implement `src/prompts/a11y-prompt.ts`
- [ ] Implement `src/utils/diff.ts`
- [ ] Implement `src/utils/batching.ts`
- [ ] Add unit tests for prompts and utils

### Phase 6: Orchestration (Day 6)
- [ ] Implement `src/index.ts` main flow
- [ ] Add error handling and recovery
- [ ] Add logging with `@actions/core`
- [ ] Integration tests

### Phase 7: Build & Publish (Day 7)
- [ ] Set up `bun run build` for compilation
- [ ] Create `dist/index.js` with sourcemap
- [ ] Create GitHub Action workflow for testing
- [ ] Document usage in README.md
- [ ] Publish to GitHub Marketplace

---

## Success Metrics

1. **Onboarding**: New developer can make a contribution within 4 hours
2. **Code Coverage**: >80% for core modules
3. **Performance**: <60 seconds for 100-file PR
4. **Reliability**: >99% success rate for valid inputs
5. **Maintainability**: <500 lines per file, <10 files per directory

---

## Dependencies

### Production
- `@actions/core` - GitHub Actions core library
- `@actions/github` - GitHub API client (Octokit)
- `@google/generative-ai` - Gemini SDK

### Development
- `bun` - Runtime and bundler
- `typescript` - Type checking
- `@biomejs/biome` - Linting and formatting

### External
- `gitleaks` - Secret detection (installed in action environment or Docker)

---

## Notes for Future Enhancements

1. **Caching**: Cache LLM responses for identical diffs
2. **Parallel Batching**: Process batches concurrently (with rate limiting)
3. **Custom Prompts**: Allow users to customize system prompt
4. **WCAG Version**: Support WCAG 2.1 vs 2.2 selection
5. **Severity Levels**: Add custom severity beyond VIOLATION/GOOD_PRACTICE
6. **Language Support**: Multi-language prompts for international teams
7. **AI Model Selection**: Auto-select best model based on PR size

---

## System Prompt Architecture

Based on research from [Community-Access/accessibility-agents](https://github.com/Community-Access/accessibility-agents), the system prompt should follow these principles.

### Core System Prompt Structure

```markdown
# Role Definition
You are an WCAG 2.2 AA accessibility expert auditing PR diffs. You identify violations and good practices in code changes.

# Authoritative Sources (Always Cite)
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WAI-ARIA 1.2: https://www.w3.org/TR/wai-aria-1.2/
- ARIA Authoring Practices: https://www.w3.org/WAI/ARIA/apg/

# Severity Classification
- CRITICAL: Blocks access - user cannot complete task
- SERIOUS: Degrades experience significantly
- MODERATE: Works but confusing/frustrating
- MINOR: Room for improvement

# WCAG Level Mapping
- Level A violations → Report as CRITICAL or SERIOUS
- Level AA violations → Report as SERIOUS or MODERATE
- Good practices beyond minimum → Report as MINOR

# First Rule of ARIA
Use native HTML elements BEFORE ARIA. A <button> is always better than <div role="button">. Only use ARIA when native HTML cannot express the semantics.
```

### Primary WCAG 2.2 Criteria Coverage

Based on the accessibility-agents research, prioritize these criteria (most common in PR diffs):

| Criterion | Level | Priority | Common Issues |
|-----------|-------|----------|---------------|
| 1.1.1 Non-text Content | A | HIGH | Missing alt, wrong alt type |
| 1.3.1 Info & Relationships | A | HIGH | Semantic HTML misuse |
| 1.4.3 Contrast (Minimum) | AA | MEDIUM | Insufficient text contrast |
| 1.4.11 Non-text Contrast | AA | MEDIUM | UI component contrast |
| 2.1.1 Keyboard | A | HIGH | Missing keyboard support |
| 2.4.4 Link Purpose | A | HIGH | Vague link text |
| 2.4.7 Focus Visible | AA | HIGH | Missing focus indicators |
| 3.3.2 Labels or Instructions | A | HIGH | Missing form labels |
| 4.1.2 Name, Role, Value | A | HIGH | ARIA misuse on custom components |

### ARIA Anti-Patterns to Flag

From the accessibility-agents ARIA specialist:

```markdown
# NEVER Add Redundant ARIA
- <header> already has landmark role - no role="banner" needed
- <nav> already has landmark role - no role="navigation" needed
- <main> already has landmark role - no role="main" needed
- <button> already has role="button" - never add it again
- <a href> already has role="link" - never add it again

# ARIA That HIDES Content
- aria-label on headings/buttons REPLACES descendant text
- Never use aria-label on content containers

# Common Patterns
- Dialog: role="dialog" + aria-modal="true" + aria-labelledby
- Tabs: role="tablist" + role="tab" + aria-selected + aria-controls
- Live regions: aria-live="polite" (not assertive) for normal updates
```

### Accessible Name Rules (Critical from APG)

```markdown
# Name Calculation Precedence (First Match Wins)
1. aria-labelledby (references visible elements - highest priority)
2. aria-label (hidden string attribute)
3. Native HTML (label, caption, legend, alt, title in SVG)
4. Child text content (for roles that allow naming)
5. title attribute (fallback - avoid)
6. placeholder (last resort - never rely on)

# Name Composition Rules
- Function, not form: "Submit" not "Green button"
- Distinguishing word first: "Delete account" not "Account deletion"
- Brief: 1-3 words when possible
- No role name: "Close" not "Close button"
- Unique: Differentiate same-name elements with different functions
```

### Structured Output Format (for JSON Schema)

```json
{
  "issues": [{
    "file": "path/to/file.tsx",
    "line": 42,
    "wcag_criterion": "1.1.1",
    "wcag_level": "A",
    "severity": "SERIOUS",
    "confidence": "high",
    "title": "Image missing alternative text",
    "description": "Screen readers cannot understand image content. Users with visual impairments will not know what the image conveys.",
    "impact": "Screen reader users will hear no information about this image.",
    "suggestion": "<img src=\"chart.png\" alt=\"Bar chart showing 40% increase in Q3 sales\" />"
  }],
  "summary": "3 issues found: 1 CRITICAL, 1 SERIOUS, 1 MINOR"
}
```

### Confidence Levels

```markdown
# Confidence Rules
- HIGH: Definitively wrong (missing required ARIA, invalid role, broken ID reference)
- MEDIUM: Likely wrong (unusual pattern, may need browser verification)
- LOW: Possibly wrong (context-dependent, may be intentional, flag for review)
```

### Diff Analysis Rules

```markdown
# What to Report
- ONLY report issues on lines with '+' prefix (added/modified code)
- Map line numbers using the [N] position markers in the diff
- Report issues for the NEW file (after changes), not the old state

# What to Skip
- Lines with '-' prefix (removed code)
- Context lines without '+' or '-'
- Files with only whitespace changes
- Generated files (node_modules, .min.js, vendor/)

# Suggestion Requirements
- Must be EXACT code ready to copy-paste
- Must match the file's indentation and style
- Must be a complete fix, not partial instructions
- If multiple fixes possible, choose the most accessible
```

### Framework-Specific Considerations

```markdown
# React/JSX
- Use aria-label prop (camelCase)
- Check for JSX-specific issues: conditional rendering, fragments
- Watch for dangerouslySetInnerHTML (usually inaccessible)

# Vue
- Use v-bind:aria-label or :aria-label
- Check slot content accessibility
- Watch for v-if/v-show affecting accessibility

# Angular
- Use [attr.aria-label] for attribute binding
- Check template accessibility

# Tailwind/Utility CSS
- Check all dynamic classes for sufficient contrast
- Focus:ring classes must have visible focus indicators
- sr-only class for screen reader only content
```

### Prompt File Implementation

```typescript
// src/prompts/a11y-prompt.ts

export function getSystemPrompt(): string {
  return `You are a WCAG 2.2 AA accessibility expert auditing PR diffs...

[Full system prompt as defined above]
  
# Output Format
Return JSON matching this schema:
${JSON.stringify(A11Y_SCHEMA, null, 2)}
`;
}

export function buildUserPrompt(
  owner: string,
  repo: string,
  prNumber: number,
  files: FilePatch[]
): string {
  const header = `## Repository Context
- Repository: ${owner}/${repo}
- PR: #${prNumber}
- Files changed: ${files.length}

## Task
Analyze the following diffs for WCAG 2.2 AA accessibility violations.
Report issues on NEW code only (lines with '+' prefix).
`;

  const formattedDiffs = files.map(formatFilePatch).join('\n\n');
  
  return `${header}
${formattedDiffs}`;
}

function formatFilePatch(file: FilePatch): string {
  const lines = file.patch.split('\n');
  const formatted = lines.map((line, i) => {
    const pos = i + 1;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return line; // Keep diff headers
    }
    if (line.startsWith('+')) {
      return `[${pos}] ${line}`; // Added line with position marker
    }
    if (line.startsWith('-')) {
      return null; // Remove deleted lines from analysis
    }
    return line; // Context line
  }).filter(Boolean).join('\n');
  
  return `[FILE] ${file.filename}
[DIFF]
${formatted}
[END DIFF]`;
}
```

### Quality Assurance Checklist

Before finalizing the prompt, ensure it covers:

- [ ] All WCAG 2.2 Level A and AA criteria (at minimum: 1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.1, 2.4.4, 2.4.7, 3.3.2, 4.1.2)
- [ ] First Rule of ARIA guidance
- [ ] Accessible name calculation rules
- [ ] Severity classification with impact descriptions
- [ ] Confidence level definitions
- [ ] Framework-specific patterns (React, Vue, Angular)
- [ ] Exact code suggestions requirement
- [ ] Only report on added lines ('+' prefix)
- [ ] Skip deleted lines and context
- [ ] Multiple output formats (JSON schema for structured output)