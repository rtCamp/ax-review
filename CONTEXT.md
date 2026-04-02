# A11y PR Review Action - LLM Context

## Overview

Automated WCAG 2.2 accessibility review GitHub Action that analyzes PR diffs using LLM (Gemini or Ollama) and posts findings as inline comments or Check Run annotations.

**Entry Point:** `action.yml` → `dist/index.js` (compiled from `src/index.ts`)

---

## Architecture Flow

```
PR Event → src/index.ts (orchestrator)
    ├── Input Validation (token, backend, api-key)
    ├── github/client.ts
    │   ├── getPRInfo() → fetch PR metadata (draft status, head SHA)
    │   └── getPRFiles() → paginate all PR files with patches
    ├── prompts/a11y-prompt.ts
    │   ├── buildPrompt() → user prompt with repo/PR context
    │   └── getSystemPrompt() → WCAG 2.2 expert system prompt
    ├── llm/batch.ts
    │   └── analyzeFilesInBatches() → chunk files (20/batch), call LLM
    │       ├── llm/gemini-client.ts → Google Generative AI with JSON schema
    │       └── llm/ollama-client.ts → Ollama API (local or cloud)
    └── Output (based on output-mode input)
        ├── "comments" → github/client.ts:createReview() + github/comments.ts
        └── "checks" → github/checks.ts:createAccessibilityCheckRun()
```

---

## Input/Output Contract (action.yml)

### Inputs
| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `github-token` | Yes | `${{ github.token }}` | GitHub API token |
| `llm-backend` | Yes | `gemini` | `"gemini"` or `"ollama"` |
| `api-key` | No* | - | API key (required for Gemini, optional for Ollama) |
| `model` | No | `gemini-2.0-flash` / `qwen2.5-coder:32b` | Model name |
| `ollama-url` | No | `http://localhost:11434` | Ollama API URL |
| `fail-on-issues` | No | `true` | Fail action on VIOLATION issues |
| `output-mode` | No | `comments` | `"comments"` or `"checks"` |

### Outputs
| Name | Description |
|------|-------------|
| `issues-found` | Total issues count |
| `violations` | VIOLATION severity count |
| `good-practices` | GOOD_PRACTICE severity count |

---

## Core Types (src/state/types.ts)

```typescript
interface A11yIssue {
  file: string;           // Relative file path
  line: number | null;    // Diff position (1-indexed)
  wcag_criterion: string; // e.g., "1.1.1"
  wcag_level: string;     // "A", "AA", or "AAA"
  severity: 'VIOLATION' | 'GOOD_PRACTICE';
  title: string;          // Short issue title
  description: string;    // Why it matters
  suggestion: string;     // EXACT code fix (not instructions)
}

interface FilePatch {
  filename: string;
  patch: string;          // Git diff patch
  status: 'added' | 'modified' | 'removed' | 'renamed';
}

const MAX_ISSUES = 100;   // Hard limit on returned issues
const BATCH_SIZE = 20;    // Files per LLM request
```

---

## LLM Integration

### Request Format
- System prompt: WCAG 2.2 expert auditor instructions
- User prompt: Repository context + formatted diff with position markers `[N]`
- Response: JSON with controlled schema

### Response Schema
```json
{
  "issues": [{
    "file": "path/to/file.tsx",
    "line": 42,
    "wcag_criterion": "1.1.1",
    "wcag_level": "A",
    "severity": "VIOLATION",
    "title": "Image missing alternative text",
    "description": "Screen readers cannot understand image content",
    "suggestion": "<img src='x.jpg' alt='Description' />"
  }],
  "summary": "N issues found"
}
```

### Client Differences
| Aspect | GeminiClient | OllamaClient |
|--------|--------------|--------------|
| Auth | API key (required) | Bearer token (optional) |
| JSON | SchemaType validation | `format: 'json'` |
| Context | Default model limit | `num_ctx: 32768` |
| Temperature | 0.1 | 0.1 |

### Batch Processing (llm/batch.ts)
- Splits files into 20-file batches
- Formats diff with position markers: `[N] +code`
- Removes deleted lines (`-`), keeps context/added
- 1-second delay between batches
- Aggregates results, caps at MAX_ISSUES

---

## Prompt Engineering (src/prompts/a11y-prompt.ts)

### System Prompt Highlights
- **Severity Classification:**
  - `VIOLATION`: WCAG 2.2 A/AA failures (must fix)
  - `GOOD_PRACTICE`: Enhancements beyond minimum (recommended)
- **Critique Rules:**
  - Only report on `+` prefix lines (new code)
  - `line` must match `[N]` position marker
  - `suggestion` must be EXACT code, not instructions
- **WCAG Coverage:** 1.x (Perceivable), 2.x (Operable), 3.x (Understandable), 4.x (Robust)

### User Prompt Construction
```typescript
buildPrompt(owner, repo, prNumber): string
// Returns: Context + Task + Important rules
```

---

## GitHub Integration

### API Calls
| Function | API | Purpose |
|----------|-----|---------|
| `getPRInfo()` | `GET /repos/{owner}/{repo}/pulls/{number}` | Fetch PR metadata |
| `getPRFiles()` | `GET /repos/{owner}/{repo}/pulls/{number}/files` | Paginate files (100/page) |
| `createReview()` | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` | Post inline comments |
| `createOrUpdateComment()` | `GET/POST/PATCH /repos/{owner}/{repo}/issues/{number}/comments` | Manage summary comment |
| `createAccessibilityCheckRun()` | `POST /repos/{owner}/{repo}/check-runs` | Create Check Run |

### Line Position Mapping (github/client.ts)
- GitHub reviews use diff **position** (not line number)
- `buildLineToPositionMap()`: Parses `@@ -a,b +c,d @@` hunk headers
- Maps new file line numbers to diff position indices

### Output Modes

#### "comments" Mode
1. Create PR review with inline comments (violations only)
2. Review body = summary + unposted violations + good practices
3. Fallback: Single PR comment if review creation fails

#### "checks" Mode
1. Create Check Run with annotations (max 50)
2. Violations → `failure` level
3. Good practices → `notice` level
4. Fallback to comments if Check Run fails

---

## Comment Formatting Styles

### github/comments.ts
- `formatIssueComment()`: Full markdown with sections
- `formatNoIssuesComment()`: Success message
- `formatDraftSkipComment()`: Draft skip notice
- Uses HTML comment identifier: `<!-- a11y-review -->`

### github/checks.ts
- `formatCheckSummary()`: Condensed summary for Check Run
- `buildAnnotations()`: Creates annotation objects
- Max 50 annotations (GitHub limit)

### Inline Comment Format
```
🔴 **[Title]**
**WCAG X.X.X** (Level A)
[Description]

**Suggested fix:**
```suggestion
[exact code]
```
```

---

## Key Implementation Details

### Diff Processing (llm/batch.ts:41-58)
```typescript
// Format: [position] +code or [position] context
diffLines.push(`[${position}] ${line}`);
// Skips: '+++', '-', '\ No newline'
```

### Style Detection (github/client.ts:311-334)
- Checks for style-related keywords (contrast, color, padding, etc.)
- Style issues not formatted as `suggestion` code blocks

### Code Detection (github/client.ts:336-354)
- Checks if suggestion is actual code
- Indicators: `<`, `>`, `{`, `aria-`, `class=`, etc.

### Error Handling
- LLM errors: Logged, batch skipped
- Check Run failure: Falls back to comments
- Review creation failure: Falls back to PR comment
- Authentication errors: Specific guidance messages

---

## WCAG 2.2 Quick Reference

| Criterion | Level | Common Checks |
|-----------|-------|---------------|
| 1.1.1 Non-text Content | A | Image alt text |
| 1.3.1 Info & Relationships | A | Semantic HTML, landmarks |
| 1.4.3 Contrast (Minimum) | AA | 4.5:1 text, 3:1 large |
| 1.4.11 Non-text Contrast | AA | UI components 3:1 |
| 2.1.1 Keyboard | A | All functionality keyboard accessible |
| 2.4.4 Link Purpose | A | Descriptive link text |
| 2.4.7 Focus Visible | AA | Visible focus indicator |
| 3.3.2 Labels or Instructions | A | Form field labels |
| 4.1.2 Name, Role, Value | A | ARIA on custom components |

---

## Known Limitations

1. **Max 100 issues returned** (truncated)
2. **Max 50 annotations** in Check Run mode
3. **Draft PRs skipped** (posts notice comment)
4. **Removed files ignored** (no content to analyze)
5. **Position mapping** may fail if line not in diff hunk
6. **Inline comments** only for violations, not good practices

---

## Usage Example

```yaml
jobs:
  a11y-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: A11y Review
        uses: owner/a11y-pr-review-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-backend: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
          output-mode: comments
          fail-on-issues: true