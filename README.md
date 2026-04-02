# ax-review

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-org/ax-review)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

Automated WCAG 2.2 accessibility review for pull requests using LLMs (Gemini or Ollama Cloud).

## Why ax-review?

- **Catches Accessibility Issues Early** — Reviews PR diffs for WCAG 2.2 A/AA violations before merge
- **Context-Aware Analysis** — Hybrid file detection analyzes React, Vue, Django, WordPress, and more
- **Actionable Feedback** — Provides exact code fixes, not just problem descriptions
- **Developer-Friendly** — Integrates directly into GitHub PR workflow
- **Flexible Deployment** — Use Gemini or Ollama Cloud APIs with self-hosted options
- **Security-First** — Built-in secret detection with Gitleaks prevents leaking credentials

## Overview

ax-review is a GitHub Action that:

1. Triggers on pull request events (opened, synchronized, reopened)
2. Fetches PR file diffs
3. Detects and redacts secrets using Gitleaks
4. Filters for web-relevant files (HTML, CSS, JSX, TSX, Vue, PHP, etc.)
5. Analyzes code with your chosen LLM for WCAG 2.2 compliance
6. Posts results as Check Runs (recommended) or PR comments
7. Optionally fails the workflow on violations

## How It Works

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           GitHub Actions Runtime                             │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         Trigger: PR Event                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     1. Input Validation                              │   │
│  │                        - Token/Provider/API Key                      │   │
│  │                        - Configuration Options                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    2. Fetch PR Metadata                               │   │
│  │                        - Draft Status → Skip?                         │   │
│  │                        - Head SHA for Reviews                        │   │
│  │                        - Pagination (100/page)                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   3. Secret Detection (Gitleaks)                      │   │
│  │                        - Scan All Diffs                              │   │
│  │                        - Redact Secrets → [REDACTED]                  │   │
│  │                        - Block on Leak Detection                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │               4. Hybrid File Detection                               │   │
│  │       ┌─────────────────────────────────────────────────┐            │   │
│  │       │  Markup Extensions (Always Analyze)            │            │   │
│  │       │  html, jsx, tsx, vue, svelte, astro            │            │   │
│  │       │  css, scss, sass, php, blade, erb, mdx         │            │   │
│  │       └─────────────────────────────────────────────────┘            │   │
│  │       ┌─────────────────────────────────────────────────┐            │   │
│  │       │  Ambiguous Extensions (Content Scan)           │            │   │
│  │       │  js, ts, mjs, cjs, py, rb, java                │            │   │
│  │       │  → Check for JSX, templates, inline styles     │            │   │
│  │       └─────────────────────────────────────────────────┘            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    5. Batch Processing                               │   │
│  │                        - Split into 20-file batches                   │   │
│  │                        - Add [N] position markers                    │   │
│  │                        - Estimate tokens (chars/4)                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     6. LLM Analysis                                  │   │
│  │        ┌─────────────────────┬─────────────────────┐                │   │
│  │        │      Gemini         │      Ollama         │                │   │
│  │        │  - JSON Schema      │  - Bearer Token     │                │   │
│  │        │  - 0.1 Temperature  │  - format: 'json'   │                │   │
│  │        │  - Safety Filters   │  - num_ctx: 32768   │                │   │
│  │        └─────────────────────┴─────────────────────┘                │   │
│  │                        - WCAG 2.2 System Prompt                     │   │
│  │                        - JSON Response Validation                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                 7. Completeness Verification                         │   │
│  │                        - Count <img>, <input>, <button>            │   │
│  │                        - Check against reported issues              │   │
│  │                        - Log warnings for gaps                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    8. Post Results                                   │   │
│  │        ┌─────────────────────┬─────────────────────┐                │   │
│  │        │   Check Runs        │   PR Comments       │                │   │
│  │        │   (Recommended)     │   (Alternative)     │                │   │
│  │        │   - Max 50 annot.   │   - Inline reviews  │                │   │
│  │        │   - Branch status   │   - Files Changed   │                │   │
│  │        │   - Clean UI        │   - Direct feedback │                │   │
│  │        └─────────────────────┴─────────────────────┘                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   9. Set Outputs                                     │   │
│  │                        - issues-found: Total count                  │   │
│  │                        - violations: CRITICAL + SERIOUS             │   │
│  │                        - good-practices: MODERATE + MINOR            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │             10. Workflow Result (if fail-on-issues: true)            │   │
│  │                        - Fail if violations > 0                      │   │
│  │                        - Pass if only good practices                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Add Secrets

Add your API key to repository secrets:

- **Gemini**: `GEMINI_API_KEY` (Get from [Google AI Studio](https://aistudio.google.com/app/apikey))
- **Ollama**: `OLLAMA_API_KEY` (Get from [Ollama Cloud Settings](https://ollama.com/settings/keys))

### 2. Create Workflow

Create `.github/workflows/a11y-review.yml`:

```yaml
name: Accessibility Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install Gitleaks
        run: |
          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz
          sudo mv gitleaks /usr/local/bin/gitleaks
          gitleaks version

      - name: Run Accessibility Review
        uses: your-org/ax-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-provider: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

### 3. Open a PR

The action automatically runs when you create or update a pull request.

## Installation

### Prerequisites

- GitHub repository with Actions enabled
- API key for your chosen LLM provider

### Step-by-Step Setup

#### 1. Add API Key to Secrets

Navigate to: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

**For Gemini:**
- Name: `GEMINI_API_KEY`
- Value: Your API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

**For Ollama:**
- Name: `OLLAMA_API_KEY`
- Value: Your API key from [Ollama Cloud Settings](https://ollama.com/settings/keys)

#### 2. Create Workflow File

Create `.github/workflows/a11y-review.yml` with your preferred configuration (see [Usage Examples](#usage-examples)).

#### 3. Grant Permissions

The workflow needs these permissions:

```yaml
permissions:
  contents: read        # Read repository files
  pull-requests: write  # Post PR comments
  checks: write         # Create Check Runs
```

#### 4. Configure Branch Protection (Optional)

To require the review to pass:

1. Go to `Settings` → `Branches` → `Branch protection rules`
2. Add rule for your main branch
3. Enable "Require status checks to pass before merging"
4. Select "Accessibility Review" check

### Self-Hosted Ollama Setup

If you're running your own Ollama server:

```yaml
- name: Run Accessibility Review
  uses: your-org/ax-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    llm-provider: ollama
    api-key: ${{ secrets.OLLAMA_API_KEY }}
    ollama-url: ${{ secrets.OLLAMA_SERVER_URL }}
```

## Configuration

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | Yes | `${{ github.token }}` | GitHub API token for PR operations |
| `llm-provider` | Yes | `gemini` | LLM provider: `gemini` or `ollama` |
| `api-key` | Yes* | — | API key for LLM provider (**Required for both Gemini and Ollama**) |
| `model` | No | Provider default | Model name (e.g., `gemini-2.0-flash`, `llama3.2`) |
| `ollama-url` | No | `https://ollama.com` | Ollama Cloud or self-hosted server URL |
| `output-mode` | No | `checks` | Output format: `checks` (recommended) or `comments` |
| `fail-on-issues` | No | `true` | Fail workflow on VIOLATION issues |
| `max-files` | No | `100` | Maximum files to analyze (`0` for unlimited) |
| `batch-size` | No | `20` | Files per LLM request |
| `skip-drafts` | No | `true` | Skip analysis for draft PRs |

\* **Note:** `api-key` is required for both Gemini and Ollama Cloud. The Ollama free tier no longer supports anonymous access.

### Default Models

| Provider | Default Model | Recommended Alternatives |
|----------|---------------|-------------------------|
| Gemini | `gemini-2.0-flash` | `gemini-2.0-pro`, `gemini-2.0-flash-lite` |
| Ollama | `llama3.2` | `llama3.1`, `qwen2.5-coder:32b`, `mistral` |

### Outputs

| Output | Description |
|--------|-------------|
| `issues-found` | Total number of issues detected |
| `violations` | Count of CRITICAL + SERIOUS issues (WCAG failures) |
| `good-practices` | Count of MODERATE + MINOR issues (recommendations) |

## Usage Examples

The `examples/` directory contains ready-to-use workflow configurations:

| File | Use Case |
|------|----------|
| [`examples/minimal-gemini.yml`](examples/minimal-gemini.yml) | Quick start with Gemini defaults |
| [`examples/minimal-ollama.yml`](examples/minimal-ollama.yml) | Quick start with Ollama Cloud |
| [`examples/production-checks.yml`](examples/production-checks.yml) | Check Runs (recommended for production) |
| [`examples/production-comments.yml`](examples/production-comments.yml) | PR Comments (alternative for direct feedback) |
| [`examples/comprehensive.yml`](examples/comprehensive.yml) | All configuration options documented |
| [`examples/large-repo.yml`](examples/large-repo.yml) | Optimized for large PRs (200+ files) |
| [`examples/monorepo.yml`](examples/monorepo.yml) | Monorepo setups with multiple apps |
| [`examples/self-hosted-ollama.yml`](examples/self-hosted-ollama.yml) | Self-hosted Ollama server |

### Minimal Setup (Gemini)

```yaml
name: Accessibility Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  a11y-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
    
    steps:
      - uses: actions/checkout@v4
      - name: Install Gitleaks
        run: |
          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz
          sudo mv gitleaks /usr/local/bin/gitleaks
      - uses: your-org/ax-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-provider: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

### Production Setup (Check Runs)

Check Runs provide cleaner UI integration and work with branch protection rules:

```yaml
- uses: your-org/ax-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    llm-provider: gemini
    api-key: ${{ secrets.GEMINI_API_KEY }}
    model: gemini-2.0-flash
    output-mode: checks
    fail-on-issues: true
    max-files: 100
    batch-size: 20
```

### Large Repository Setup

For repos with many files per PR:

```yaml
- uses: your-org/ax-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    llm-provider: gemini
    api-key: ${{ secrets.GEMINI_API_KEY }}
    max-files: 200      # Higher limit
    batch-size: 30      # Larger batches
```

## Output Modes

### Check Runs (Recommended)

Creates Check Run annotations visible in the "Checks" tab:

```yaml
output-mode: checks
```

**Advantages:**
- Cleaner PR interface
- Works with branch protection rules
- Grouped by file
- Supports `failure` and `notice` severity levels
- Max 50 annotations per run

**Best for:** Production repositories, team workflows, branch protection enforcement.

### PR Comments

Posts inline review comments on the "Files Changed" tab:

```yaml
output-mode: comments
```

**Advantages:**
- Direct visibility on changed lines
- No limit on comment count (besides API limits)
- Conversations can be threaded
- Suggested fixes shown inline

**Best for:** Smaller teams, quick iteration, direct code discussion.

## WCAG Criteria

ax-review analyzes code for WCAG 2.2 A/AA compliance across these criteria:

### Perceivable (1.x)

| Criterion | Level | What We Check | Learn More |
|-----------|-------|---------------|------------|
| **1.1.1** Non-text Content | A | Missing `alt` on images, ARIA labels on icons | [WCAG 1.1.1](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html) |
| **1.3.1** Info and Relationships | A | Semantic HTML, headings, landmarks, lists | [WCAG 1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html) |
| **1.4.3** Contrast (Minimum) | AA | 4.5:1 for normal text, 3:1 for large text | [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| **1.4.11** Non-text Contrast | AA | 3:1 contrast for UI components | [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |

### Operable (2.x)

| Criterion | Level | What We Check | Learn More |
|-----------|-------|---------------|------------|
| **2.1.1** Keyboard | A | All interactive elements reachable by keyboard | [WCAG 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) |
| **2.4.4** Link Purpose | A | Descriptive link text, `aria-label` on links | [WCAG 2.4.4](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html) |
| **2.4.7** Focus Visible | AA | Visible focus indicators, focus styles | [WCAG 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) |

### Understandable (3.x)

| Criterion | Level | What We Check | Learn More |
|-----------|-------|---------------|------------|
| **3.3.2** Labels or Instructions | A | Form labels, input descriptions, error messages | [WCAG 3.3.2](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html) |

### Robust (4.x)

| Criterion | Level | What We Check | Learn More |
|-----------|-------|---------------|------------|
| **4.1.2** Name, Role, Value | A | ARIA attributes, custom component accessibility | [WCAG 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html) |

## Severity Levels

Issues are classified by impact on users:

| Level | Impact | Description | Examples |
|-------|--------|-------------|----------|
| **CRITICAL** | Blocks Access | User cannot complete the task at all | Missing `alt` on critical image, form without submit button, keyboard trap |
| **SERIOUS** | Significant Barrier | Task is possible but very difficult | 3:1 contrast ratio (should be 4.5:1), missing focus indicator, generic link text ("click here") |
| **MODERATE** | Frustrating | Works but confusing | Skipped heading level, missing field descriptions, placeholder-only labels |
| **MINOR** | Enhancement | Beyond WCAG minimum | Enhanced focus styles, skip links, additional ARIA labels |

### Failure Behavior

Only **CRITICAL** and **SERIOUS** issues cause workflow failure when `fail-on-issues: true`.

**MODERATE** and **MINOR** issues are posted as recommendations but won't block your PR.

## Architecture

### Project Structure

```
ax-review/
├── action.yml                 # GitHub Action definition
├── package.json              # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── src/
│   ├── index.ts              # Entry point
│   ├── orchestrator.ts       # Workflow coordination
│   ├── types.ts              # Core type definitions
│   ├── constants.ts          # Configuration constants
│   ├── inputs.ts             # Input parsing and validation
│   ├── llm/
│   │   ├── index.ts          # Client factory
│   │   ├── types.ts          # LLM interfaces
│   │   ├── base.ts           # Abstract client with retry logic
│   │   ├── gemini.ts         # Google Gemini client
│   │   └── ollama.ts         # Ollama Cloud client
│   ├── github/
│   │   ├── client.ts         # GitHub API wrapper
│   │   ├── pr.ts             # PR file fetching
│   │   ├── comments.ts       # Review comment formatting
│   │   └── checks.ts         # Check Run creation
│   ├── prompts/
│   │   └── a11y-prompt.ts    # WCAG 2.2 system/user prompts
│   ├── security/
│   │   └── gitleaks.ts       # Secret detection and redaction
│   ├── utils/
│   │   ├── batching.ts       # File batch creation
│   │   ├── file-utils.ts     # Hybrid file detection
│   │   ├── validation.ts     # Input validation (SSRF, injection)
│   │   ├── element-counter.ts # Completeness verification
│   │   └── context.ts        # GitHub context extraction
│   └── output.ts             # Result posting logic
├── dist/
│   └── index.js              # Compiled action (esbuild)
└── examples/                  # Workflow examples
```

### Key Modules

| Module | Responsibility |
|--------|----------------|
| `orchestrator.ts` | Coordinates analysis workflow across all modules |
| `llm/base.ts` | Shared retry logic, JSON parsing, error handling for all providers |
| `prompts/a11y-prompt.ts` | WCAG 2.2 expert system prompt, injection detection, escaping |
| `security/gitleaks.ts` | Secret detection, redaction, process cleanup |
| `utils/file-utils.ts` | Hybrid detection (markup always, ambiguous content scan) |

### Hybrid File Detection

ax-review uses a two-tier file detection system:

**Tier 1: Always Analyze**
Files with markup extensions are always processed:
- HTML: `.html`, `.htm`, `.xhtml`
- React: `.jsx`, `.tsx`
- Vue: `.vue`
- Svelte: `.svelte`
- Astro: `.astro`
- CSS: `.css`, `.scss`, `.sass`, `.less`, `.styl`
- Templates: `.php`, `.blade.php`, `.erb`, `.ejs`, `.hbs`, `.twig`, `.liquid`
- Docs: `.md`, `.mdx`

**Tier 2: Content Scan**
Files with ambiguous extensions (`.js`, `.ts`, `.mjs`, `.cjs`, `.py`, `.rb`, `.java`) are scanned for:
- JSX components (`<Button`, `<div`, React patterns)
- Vue directives (`v-if`, `v-for`)
- Angular directives (`ng-if`, `ng-for`)
- Template tags (`{{ }}`, `{% %}`, `<?php`)
- Inline styles (`style={}`)

This ensures React components in `.js` files and Django templates in `.py` files are analyzed.

### LLM Client Architecture

```
BaseLLMClient (abstract)
├── executeWithRetry()      // Exponential backoff (3 retries)
├── parseJsonResponse()    // JSON extraction and validation
└── sleep()               // Utility
    │
    ├── GeminiClient
    │   ├── analyze()      // Google Generative AI SDK
    │   ├── validateConfig()
    │   └── isRateLimitError()
    │
    └── OllamaClient
        ├── analyze()      // Ollama SDK (format: 'json')
        ├── validateConfig()
        └── handleError()
```

**Adding a new provider:**

1. Create `src/llm/new-provider.ts` implementing `LLMClient`
2. Add to `src/llm/index.ts` factory
3. Add type to `LLMProvider` in `src/types.ts`

### Security Model

| Layer | Protection |
|-------|------------|
| **Input Validation** | SSRF protection (no private IPs), command injection prevention, length limits |
| **Secret Detection** | Gitleaks scans all diffs, redacts secrets to `[REDACTED]`, blocks on detection |
| **Prompt Injection** | Pattern detection for malicious prompts, escaping of special characters |
| **API Keys** | Never logged, passed via GitHub secrets only |

## Development

### Prerequisites

- Node.js 20+
- npm or yarn

### Setup

```bash
git clone https://github.com/your-org/ax-review
cd ax-review
npm install
```

### Commands

```bash
# Build for production
npm run build

# Type checking
npm run typecheck

# Run tests
npm test

# Local development
npm run dev
```

### Project Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | GitHub Actions input/output, logging |
| `@actions/github` | Octokit wrapper for GitHub API |
| `@google/generative-ai` | Gemini API client |
| `ollama` | Ollama Cloud API client |

### Testing

The test suite covers:

- Input validation (SSRF, injection, length)
- File filtering (markup, ambiguous)
- LLM response parsing (JSON extraction, schema validation)
- Diff position mapping
- Secret redaction

```bash
npm test

# Run specific test file
npm test -- --testPathPattern=validation

# Coverage report
npm test -- --coverage
```

## Security

### Secret Detection

ax-review integrates [Gitleaks](https://github.com/gitleaks/gitleaks) to prevent sensitive data from being sent to LLM APIs:

```bash
# Install Gitleaks in your workflow
- name: Install Gitleaks
  run: |
    curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz
    sudo mv gitleaks /usr/local/bin/gitleaks
    gitleaks version
```

**How it works:**
1. Scans all PR file diffs before sending to LLM
2. Detects 200+ secret types (API keys, tokens, passwords)
3. Redacts secrets to `[REDACTED]` in the analysis
4. Blocks workflow if secrets cannot be safely redacted

### API Key Handling

- **Never commit API keys** to the repository
- Use GitHub repository secrets for all credentials
- Keys are loaded at runtime via `${{ secrets.* }}`
- Not logged or included in error messages

### Minimal Permissions

The action uses the default `GITHUB_TOKEN` with minimal scope:

```yaml
permissions:
  contents: read        # Read repository files (checkout)
  pull-requests: write  # Create PR reviews/comments
  checks: write         # Create Check Runs
```

### Input Validation

All inputs are validated to prevent injection attacks:

- `ollama-url`: HTTP/HTTPS only, blocks private IPs (SSRF)
- `model`: Alphanumeric characters, dots, dashes, underscores, colons only
- `api-key`: Length validation, control character detection
- File paths: Path traversal prevention, character sanitization

## Troubleshooting

### Common Issues

#### "API key is required" Error

**Problem:** Both Gemini and Ollama Cloud now require API keys.

**Solution:** Ensure `api-key` input is provided:

```yaml
api-key: ${{ secrets.GEMINI_API_KEY }}  # or
api-key: ${{ secrets.OLLAMA_API_KEY }}
```

For Ollama Cloud, get your key from [ollama.com/settings/keys](https://ollama.com/settings/keys).

#### Gitleaks Not Found

**Problem:** `gitleaks: command not found`

**Solution:** Install Gitleaks in your workflow:

```yaml
- name: Install Gitleaks
  run: |
    curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz
    sudo mv gitleaks /usr/local/bin/gitleaks
    gitleaks version
```

#### Check Run Not Created

**Problem:** Action runs but no Check Run appears.

**Solution:** Ensure the workflow has `checks: write` permission:

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write  # Required for Check Runs
```

#### No Issues Found But You Expected Some

**Problem:** Action completes with "0 issues found" but you know there are a11y problems.

**Possible causes:**
1. **File extension not detected** — `.js` files with JSX need content scanning
2. **Issue on unchanged lines** — Only added lines (+ prefix) are analyzed
3. **Draft PR skipped** — Set `skip-drafts: false` to analyze drafts

**Solution:** Check the action logs for file detection details.

#### Rate Limit Errors (Gemini)

**Problem:** `429 Resource Exhausted` or quota errors.

**Solution:**
1. Reduce `batch-size` to process fewer files per request
2. Wait and retry (action has automatic retry with backoff)
3. Upgrade your Gemini API quota

#### Self-Hosted Ollama Connection Failed

**Problem:** Cannot connect to self-hosted Ollama server.

**Solution:**
1. Verify the server URL is accessible from GitHub Actions runners
2. Ensure the URL scheme is `http://` or `https://`
3. Check firewall rules for the server

```yaml
ollama-url: ${{ secrets.OLLAMA_SERVER_URL }}
```

#### No Files to Analyze

**Problem:** "Found 0 files to analyze" in logs.

**Possible causes:**
1. All files filtered by `shouldSkipFile` (node_modules, minified files)
2. `max-files` limit too low
3. No web-relevant files in the PR

**Solution:** Check what file patterns are being skipped in the logs.

### Debugging

Enable verbose logging in GitHub Actions:

```yaml
- name: Run Accessibility Review
  uses: your-org/ax-review@v1
  env:
    ACTIONS_STEP_DEBUG: true
  with:
    # ... your config
```

This shows:
- File filtering decisions
- LLM request/response (without secrets)
- Batch processing details
- Position mapping for comments

### Getting Help

1. Check this troubleshooting section
2. Review [GitHub Issues](https://github.com/your-org/ax-review/issues) for similar problems
3. Open a new issue with:
   - Workflow YAML (redact secrets)
   - Full action logs
   - PR file types being analyzed

## License

MIT License

```
Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/ax-review`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/my-feature`

### Making Changes

1. **Code Style**: Follow existing TypeScript conventions
2. **Tests**: Add tests for new functionality
3. **Documentation**: Update README.md and TECHNICAL_SPEC.md
4. **Commits**: Use conventional commit messages

### Running Tests

```bash
# Run all tests
npm test

# Type checking
npm run typecheck

# Build
npm run build
```

### Pull Request Process

1. Ensure all tests pass: `npm test && npm run typecheck`
2. Update documentation for changed behavior
3. Add entries to CHANGELOG.md
4. Submit PR with description of changes

### Reporting Issues

Use [GitHub Issues](https://github.com/your-org/ax-review/issues) for:

- Bug reports
- Feature requests
- Documentation improvements

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Workflow YAML (redact secrets)
- Action logs

---

Built with ❤️ for accessible web development.