# ax-review Technical Specification

**Version:** 2.0.0  
**Runtime:** Node.js 20+ (GitHub Actions environment)  
**Entry Point:** `dist/index.js` (compiled from `src/index.ts`)  
**Bundle Size:** ~632KB (esbuild minified)

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Execution Pipeline](#execution-pipeline)
3. [Module Documentation](#module-documentation)
4. [File Interdependencies](#file-interdependencies)
5. [Type System](#type-system)
6. [Security Implementation](#security-implementation)
7. [LLM Integration](#llm-integration)
8. [GitHub Integration](#github-integration)
9. [Output Modes](#output-modes)
10. [Error Handling](#error-handling)
11. [Configuration Reference](#configuration-reference)
12. [Development Guidelines](#development-guidelines)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GitHub Actions Runtime                             │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    src/index.ts (Entry Point)                        │  │
│  │                               │                                        │  │
│  │    ┌──────────────────────────┼──────────────────────────┐           │  │
│  │    │                          │                          │           │  │
│  │    ▼                          ▼                          ▼           │  │
│  │  parseInputs()         getRepoContext()          setOutputs()         │  │
│  │    │                          │                          │           │  │
│  │    └──────────────────────────┼──────────────────────────┘           │  │
│  │                               │                                        │  │
│  │                               ▼                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │  │
│  │  │              src/orchestrator.ts (Workflow Logic)               │   │  │
│  │  │                                                                 │   │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │   │  │
│  │  │  │  GitHub     │  │  Security   │  │  batching   │             │   │  │
│  │  │  │  Client     │→ │  gitleaks   │→ │  createBatches│             │   │  │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘             │   │  │
│  │  │         │                                                    │   │  │
│  │  │         ▼                                                    │   │  │
│  │  │  ┌─────────────┐                   ┌─────────────┐           │   │  │
│  │  │  │  prompts/   │──────────────────▶│   LLM       │           │   │  │
│  │  │  │  a11y-prompt│                   │   analysis  │           │   │  │
│  │  │  └─────────────┘                   └─────────────┘           │   │  │
│  │  │                                           │                    │   │  │
│  │  │  ┌─────────────────────────────────────────┘                    │   │  │
│  │  │  │                                                              │   │  │
│  │  │  ▼                                                              │   │  │
│  │  │  ┌─────────────┐                   ┌─────────────┐           │   │  │
│  │  │  │  element-   │                   │   output    │           │   │  │
│  │  │  │  counter    │──────────────────▶│   postResults│           │   │  │
│  │  │  └─────────────┘                   └─────────────┘           │   │  │
│  │  │                                                              │   │  │
│  │  └──────────────────────────────────────────────────────────────────┘   │  │
│  │                               │                                        │  │
│  │                               ▼                                        │  │
│  │                    ┌─────────────────────┐                            │  │
│  │                    │   postResults()      │                            │  │
│  │                    │   (PR review or      │                            │  │
│  │                    │    Check Run)        │                            │  │
│  │                    └─────────────────────┘                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Zero Trust** | All inputs validated, all external content sanitized |
| **Fail-Safe** | Secrets never passthrough on security scan failure |
| **Provider Abstraction** | `LLMClient` interface enables hot-swapping |
| **Idempotency** | No side effects outside of explicit GitHub API calls |
| **Observability** | Comprehensive logging via `@actions/core` |
| **Separation of Concerns** | Each module handles one responsibility |

---

## Execution Pipeline

### Complete Pipeline (11 steps)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXECUTION PIPELINE                                   │
└─────────────────────────────────────────────────────────────────────────────┘

1. ENTRY POINT (src/index.ts)
   ├── core.getInput() for each action.yml input
   ├── parseInputs() validates and converts to ActionConfig
   ├── getRepoContext() extracts owner/repo from GitHub context
   ├── getPRNumber() extracts PR number from payload
   └── Calls runAnalysis() defined in orchestrator.ts

2. INPUT VALIDATION (src/inputs.ts + src/utils/validation.ts)
   ├── validateApiKey() - Min length 20, no control chars
   ├── validateUrl() - SSRF protection, no private IPs
   ├── validateModelName() - Alphanumeric + .:-_ only
   └── validateProviderConfig() - Provider-specific requirements

3. PR METADATA FETCH (src/github/client.ts)
   ├── GET /repos/{owner}/{repo}/pulls/{number}
   ├── Extract: headSha, isDraft, author, title
   ├── If draft && skipDrafts: Post skip comment, return
   └── Return PRInfo object

4. FILE RETRIEVAL (src/github/client.ts + src/github/pr.ts)
   ├── GET /repos/{owner}/{repo}/pulls/{number}/files (paginated)
   ├── Filter: status !== 'removed'
   ├── Filter: patch !== null (skip binary/large files)
   ├── Apply maxFiles limit
   ├── Filter using shouldSkipFile() (node_modules, .min.js, etc.)
   └── Return FilePatch[]

5. FILE FILTERING (src/utils/file-utils.ts - Hybrid Approach)
   ├── Apply SKIP_PATTERNS blocklist (config, tests, generated files)
   ├── Check DIRECT_MARKUP_EXTENSIONS (always analyze)
   │   ├── html, htm, xhtml, jsx, tsx, vue, svelte, astro
   │   ├── css, scss, sass, less, styl
   │   ├── php, blade.php, erb, ejs, hbs, twig, liquid
   │   └── md, mdx
   ├── For AMBIGUOUS_EXTENSIONS (js, ts, mjs, cjs, py, rb, java):
   │   ├── Extract added lines from patch (lines with '+' prefix)
   │   ├── Check MARKUP_CONTENT_PATTERNS:
   │   │   ├── JSX components: <Button>, <div>
   │   │   ├── React patterns: className, createRoot, ReactDOM
   │   │   ├── Vue directives: v-if, v-for
   │   │   ├── Angular directives: ng-if, ng-for
   │   │   ├── Template tags: {{ }}, {% %}, <?php ?>
   │   │   └── Inline styles: style={}
   │   └── Include file if patterns found
   ├── Unknown extensions: check content defensively
   └── Return files to analyze

6. SECRET DETECTION (src/security/gitleaks.ts)
   ├── Check gitleaks binary availability
   ├── Write diffs to temp file (fs.mkdtempSync)
   ├── Execute: gitleaks detect --source={temp} --report-format=json
   ├── Parse findings, redact secrets with [REDACTED]
   ├── Cleanup temp directory
   └── Return { files: redactedFiles, secretsFound, skipped }

7. BATCH CREATION (src/utils/batching.ts)
   ├── Split files into batches of batchSize
   ├── Estimate tokens per batch (chars / 4)
   └── Return FilePatch[][]

8. PROMPT BUILDING (src/prompts/a11y-prompt.ts)
   ├── getSystemPrompt() - WCAG 2.2 expert system prompt
   ├── escapePromptContent() - Escape special characters
   ├── sanitizeFilename() - Remove path traversal
   ├── detectPromptInjection() - Security check
   └── buildUserPrompt() - Format diffs with [N] positions

9. LLM ANALYSIS (src/llm/)
   ├── createLLMClient() factory (src/llm/index.ts)
   ├── BaseLLMClient.executeWithRetry() - Retry with backoff
   ├── Provider-specific executeRequest():
   │   ├── GeminiClient: GoogleGenerativeAI SDK
   │   └── OllamaClient: Ollama SDK (ollama package)
   ├── parseJsonResponse() - JSON validation
   └── Return AnalysisResult

10. COMPLETENESS VERIFICATION (src/utils/element-counter.ts)
    ├── countElementsInFiles() - Count <img>, <input>, <button>, etc.
    ├── verifyCompleteness() - Compare to reported issues
    ├── Log warnings if gaps detected
    └── Return AnalysisResult with verificationGaps

11. OUTPUT POSTING (src/output.ts)
    ├── If outputMode === 'comments':
    │   ├── postReview()
    │   │   ├── Build inline comments for violations
    │   │   ├── Map line numbers to diff positions
    │   │   ├── POST /repos/{owner}/{repo}/pulls/{number}/reviews
    │   │   └── Fallback: POST issue comment if review fails
    │   └── Summary includes all issues + failed batches
    └── If outputMode === 'checks':
        ├── postCheckRun()
        │   ├── Build annotations (max 50)
        │   └── POST /repos/{owner}/{repo}/check-runs
        └── Fallback to comments if Check Run fails
```

---

## Module Documentation

### `src/index.ts` — Entry Point

**Purpose:** Minimal entry point that delegates to orchestrator.

**Responsibilities:**
1. Parse action inputs via `@actions/core`
2. Extract PR context from GitHub payload
3. Initialize GitHub and LLM clients
4. Call analysis workflow
5. Post results
6. Set outputs
7. Handle failures

**Dependencies:**
- `@actions/core` — Input/output, logging
- `@actions/github` — GitHub context
- `./inputs` — Input parsing
- `./llm/index` — LLM client factory
- `./github/client` — GitHub API client
- `./orchestrator` — Analysis workflow
- `./output` — Result posting
- `./utils/context` — Context extraction
- `./utils/stats` — Statistics calculation

**Key Functions:**

```typescript
async function run(): Promise<void> {
  // 1. Parse inputs
  const config = parseInputs();
  
  // 2. Get PR context
  const { owner, repo } = getRepoContext();
  const prNumber = getPRNumber();
  
  // 3. Initialize clients
  const github = new GitHubClient(config.githubToken, owner, repo);
  const llm = createLLMClient(config.llmProvider, llmConfig);
  
  // 4. Run analysis
  const result = await analyzeFiles(context);
  
  // 5. Post results
  await postResults(github, prNumber, headSha, result.issues, result.failedBatches, config.outputMode);
  
  // 6. Set outputs
  setOutputs({
    issuesFound: stats.total,
    violations: stats.violations,
    goodPractices: stats.goodPractices,
  });
  
  // 7. Handle failure
  if (config.failOnIssues && stats.violations > 0) {
    core.setFailed(`Found ${stats.violations} violations`);
  }
}
```

**Error Handling:**
- Top-level try/catch for unexpected errors
- Sets `core.setFailed()` with error message
- Logs stack trace for debugging

---

### `src/orchestrator.ts` — Workflow Orchestration

**Purpose:** Coordinate analysis workflow across all modules.

**Responsibilities:**
1. Fetch PR files (filtered by maxFiles)
2. Filter to web files
3. Run secret detection
4. Create batches
5. Process batches with LLM
6. Verify completeness
7. Return results

**Dependencies:**
- `./github/client` — PR file fetching
- `./github/pr` — Web file filtering
- `./security/gitleaks` — Secret detection
- `./llm/types` — LLM client interface
- `./prompts/a11y-prompt` — Prompt building
- `./utils/batching` — Batch creation
- `./utils/element-counter` — Completeness verification

**Key Types:**

```typescript
interface AnalysisResult {
  issues: A11yIssue[];
  failedBatches: FailedBatch[];
  totalBatches: number;
  successfulBatches: number;
  verificationGaps?: string[];
}

interface AnalysisContext {
  github: GitHubClient;
  llm: LLMClient;
  config: ActionConfig;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
}
```

**Key Functions:**

```typescript
async function analyzeFiles(context: AnalysisContext): Promise<AnalysisResult> {
  // Step 1: Fetch PR files
  const allFiles = await fetchPRFiles(github, prNumber, config.maxFiles);
  
  // Step 2: Filter to web files
  const webFiles = filterWebFiles(allFiles.filter(not(shouldSkipFile)));
  
  // Step 3: Secret detection
  const { files: redacted, secretsFound, skipped } = await redactSecrets(webFiles);
  
  if (skipped) {
    return { issues: [], failedBatches: [], totalBatches: 0, successfulBatches: 0 };
  }
  
  // Step 4: Create batches
  const batches = createBatches(redacted, config.batchSize);
  
  // Step 5: Process batches
  const systemPrompt = getSystemPrompt();
  const result = await processBatches(batches, llm, systemPrompt, owner, repo, prNumber);
  
  // Step 6: Verify completeness
  const elementCounts = countElementsInFiles(redacted);
  const verification = verifyCompleteness(elementCounts.counts, result.issues);
  
  if (!verification.passed) {
    result.verificationGaps = verification.potentialGaps;
  }
  
  return result;
}
```

**Batch Processing Strategy:**
- Sequential processing (not parallel) to avoid rate limits
- Each batch processed independently (failures don't stop others)
- 1-second delay between batches (built into retry logic)
- Progress logged for observability

---

### `src/inputs.ts` — Input Parsing & Validation

**Purpose:** Parse action.yml inputs, validate security constraints.

**Dependencies:**
- `@actions/core` — Input access
- `./types` — Type definitions
- `./constants` — Default values
- `./utils/validation` — Validation utilities

**Key Functions:**

```typescript
function parseInputs(): ActionConfig {
  // Required inputs
  const githubToken = getRequiredInput('github-token', 'GitHub token is required');
  const llmProvider = parseLLMProvider(getInput('llm-provider', 'gemini'));
  const outputMode = parseOutputMode(getInput('output-mode', 'checks'));
  
  // Optional inputs with defaults
  const failOnIssues = getBooleanInput('fail-on-issues', true);
  const maxFiles = getNumberInput('max-files', 100);
  const batchSize = getNumberInput('batch-size', 20);
  const skipDrafts = getBooleanInput('skip-drafts', true);
  
  // Provider-specific validation
  const apiKey = validateApiKey(getInput('api-key', ''), llmProvider === 'gemini' ? 20 : 10);
  const ollamaUrl = validateUrl(getInput('ollama-url', 'https://ollama.com'));
  const model = validateModelName(getInput('model', ''));
  
  validateProviderConfig(llmProvider, apiKey);
  
  return { githubToken, llmProvider, apiKey, model, ollamaUrl, outputMode, failOnIssues, maxFiles, batchSize, skipDrafts };
}
```

**Security Validations:**

| Input | Validation | Security Rationale |
|-------|-----------|-------------------|
| `api-key` | Min length 20 (Gemini) / 10 (Ollama), no control chars | Prevent empty/invalid keys |
| `ollama-url` | HTTP/HTTPS only, no private IPs | Prevent SSRF attacks |
| `model` | Alphanumeric + `.:-_` only | Prevent command injection |
| `llm-provider` | Allowlist: `gemini \| ollama` | Prevent provider injection |

---

### `src/types.ts` — Core Type Definitions

**Purpose:** Single source of truth for all data structures.

**No dependencies** — Pure TypeScript interfaces.

**Key Types:**

```typescript
// Core issue structure
interface A11yIssue {
  file: string;              // Relative path from repo root
  line: number | null;      // 1-indexed, null if not line-specific
  wcag_criterion: string;    // e.g., "1.1.1", "2.4.4"
  wcag_level: WcagLevel;     // 'A' | 'AA' | 'AAA'
  severity: Severity;        // 'CRITICAL' | 'SERIOUS' | 'MODERATE' | 'MINOR'
  confidence: Confidence;    // 'high' | 'medium' | 'low'
  title: string;             // Short actionable title
  description: string;       // Why this is a problem
  impact: string;            // User impact description
  suggestion: string;        // EXACT code fix
}

// File patch from GitHub API
interface FilePatch {
  filename: string;          // Relative path
  patch: string;             // Git unified diff format
  status: FileStatus;        // 'added' | 'modified' | 'removed' | 'renamed'
  additions: number;
  deletions: number;
}

// PR metadata
interface PRInfo {
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  baseRef: string;
  headRef: string;
  isDraft: boolean;
  author: string;
  owner: string;
  repo: string;
}

// Action configuration
interface ActionConfig {
  githubToken: string;
  llmProvider: LLMProvider;
  apiKey?: string | undefined;
  model?: string | undefined;
  ollamaUrl: string;
  outputMode: OutputMode;
  failOnIssues: boolean;
  maxFiles: number;
  batchSize: number;
  skipDrafts: boolean;
}

// Batch processing result
interface BatchProcessingResult {
  issues: A11yIssue[];
  failedBatches: FailedBatch[];
  totalBatches: number;
  successfulBatches: number;
}

// Statistics
interface IssueStats {
  total: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  violations: number;
  goodPractices: number;
}
```

**Union Types:**

```typescript
type LLMProvider = 'gemini' | 'ollama';
type OutputMode = 'comments' | 'checks';
type WcagLevel = 'A' | 'AA' | 'AAA';
type Severity = 'CRITICAL' | 'SERIOUS' | 'MODERATE' | 'MINOR';
type Confidence = 'high' | 'medium' | 'low';
type FileStatus = 'added' | 'modified' | 'removed' | 'renamed';
```

---

### `src/constants.ts` — Centralized Configuration

**Purpose:** Eliminate magic numbers, provide single configuration source.

**No dependencies** — Pure constants.

**Contents:**

```typescript
export const GITHUB_LIMITS = {
  PER_PAGE: 100,              // GitHub API pagination
  MAX_ANNOTATIONS: 50,        // Check Run annotation limit
  MAX_REVIEW_COMMENTS: 50,    // Review comment limit
  DEFAULT_MAX_FILES: 100,     // Default file analysis limit
} as const;

export const LLM_LIMITS = {
  DEFAULT_BATCH_SIZE: 20,    // Files per request
  DEFAULT_TIMEOUT_MS: 600000, // 10 minutes
  MAX_RETRIES: 3,             // Retry attempts
  BASE_DELAY_MS: 1000,        // Exponential backoff base
  TEMPERATURE: 0.1,           // Deterministic output
} as const;

export const ACTION_DEFAULTS = {
  LLM_PROVIDER: 'gemini',
  OUTPUT_MODE: 'checks',
  OLLAMA_URL: 'https://ollama.com',
} as const;
```

---

### `src/llm/types.ts` — LLM Abstraction Layer

**Purpose:** Define provider-agnostic interface for hot-swapping.

**Dependencies:**
- `../types` — Severity, WcagLevel, Confidence types

**Key Interfaces:**

```typescript
// Analysis result from LLM
interface AnalysisResult {
  issues: Array<{
    file: string;
    line: number | null;
    wcag_criterion: string;
    wcag_level: WcagLevel;
    severity: Severity;
    confidence: Confidence;
    title: string;
    description: string;
    impact: string;
    suggestion: string;
  }>;
  summary: string;
}

// LLM client interface (hot-swappable)
interface LLMClient {
  readonly provider: string;
  analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult>;
  validateConfig(): Promise<boolean>;
}

// Provider configurations
interface GeminiConfig {
  apiKey: string;
  model?: string;
  timeout?: number;
}

interface OllamaConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// Error class for LLM-specific errors
class LLMError extends Error {
  public readonly originalError: Error | undefined;
  public readonly isRetryable: boolean;
  
  constructor(message: string, originalError?: Error, isRetryable: boolean = false) {
    super(message);
    this.name = 'LLMError';
    this.originalError = originalError;
    this.isRetryable = isRetryable;
  }
}
```

**Schema Validation:**

```typescript
// JSON schema for structured output
export const A11Y_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          wcag_criterion: { type: 'string' },
          wcag_level: { type: 'string', enum: ['A', 'AA', 'AAA'] },
          severity: { type: 'string', enum: ['CRITICAL', 'SERIOUS', 'MODERATE', 'MINOR'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          description: { type: 'string' },
          impact: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['file', 'wcag_criterion', 'wcag_level', 'severity', 'confidence', 'title', 'description', 'impact', 'suggestion'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['issues', 'summary'],
};

// Runtime validation function
export function validateAnalysisResult(data: unknown): data is AnalysisResult {
  if (typeof data !== 'object' || data === null) return false;
  const result = data as Record<string, unknown>;
  
  if (!Array.isArray(result['issues'])) return false;
  if (typeof result['summary'] !== 'string') return false;
  
  for (const issue of result['issues']) {
    if (!isValidIssue(issue)) return false;
  }
  
  return true;
}
```

---

### `src/llm/base.ts` — Abstract Base LLM Client

**Purpose:** Eliminate code duplication between LLM providers.

**Dependencies:**
- `./types` — LLMError, AnalysisResult, validateAnalysisResult
- `../constants` — LLM_LIMITS

**Inheritance Hierarchy:**

```
BaseLLMClient (abstract)
├── GeminiClient (src/llm/gemini.ts)
└── OllamaClient (src/llm/ollama.ts)
```

**Shared Logic:**

```typescript
abstract class BaseLLMClient {
  protected timeout: number = LLM_LIMITS.DEFAULT_TIMEOUT_MS;
  
  // Execute with retry logic
  protected async executeWithRetry<T>(
    request: () => Promise<T>,
    extractContent: (response: T) => string,
    isRetryable: (error: Error) => boolean,
    providerName: string
  ): Promise<AnalysisResult> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < LLM_LIMITS.MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      try {
        const response = await request();
        const content = extractContent(response);
        return this.parseJsonResponse(content);
      } catch (error) {
        lastError = this.normalizeError(error, this.timeout);
        const canRetry = isRetryable(lastError);
        const hasRetriesLeft = attempt < LLM_LIMITS.MAX_RETRIES - 1;
        
        if (canRetry && hasRetriesLeft) {
          const delay = LLM_LIMITS.BASE_DELAY_MS * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    
    throw new LLMError(
      `${providerName} request failed: ${lastError?.message}`,
      lastError instanceof Error ? lastError : undefined,
      lastError ? isRetryable(lastError) : false
    );
  }
  
  // Parse and validate JSON response
  protected parseJsonResponse(text: string): AnalysisResult {
    let data: unknown;
    
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      const preview = text.length > 200 ? `${text.substring(0, 200)}...` : text;
      throw new LLMError(
        `Failed to parse JSON response: ${preview}`,
        parseError instanceof Error ? parseError : undefined,
        false
      );
    }
    
    if (!validateAnalysisResult(data)) {
      throw new LLMError(
        'LLM response does not match expected schema',
        undefined,
        false
      );
    }
    
    return data;
  }
}
```

**Benefit:** Adding a new LLM provider requires implementing only:
1. Provider-specific request method
2. Provider-specific config validation
3. Provider-specific error classification

---

### `src/llm/gemini.ts` — Google Gemini Client

**Purpose:** Gemini API client using official SDK.

**Dependencies:**
- `@google/generative-ai` — Gemini SDK
- `./types` — LLMError, AnalysisResult, GeminiConfig
- `./base` — BaseLLMClient
- `../constants` — LLM_LIMITS

**Key Implementation:**

```typescript
class GeminiClient extends BaseLLMClient {
  public readonly provider = 'gemini';
  private readonly client: GoogleGenerativeAI;
  private readonly model: string;
  private readonly apiKey: string;
  
  constructor(config: GeminiConfig) {
    super();
    
    if (!config.apiKey) {
      throw new Error('[Gemini] API key is required');
    }
    
    if (config.apiKey.length < 10) {
      throw new Error('[Gemini] API key appears to be invalid (too short)');
    }
    
    this.apiKey = config.apiKey;
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model ?? 'gemini-3-flash-preview';
    this.timeout = config.timeout ?? LLM_LIMITS.DEFAULT_TIMEOUT_MS;
  }
  
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    try {
      return await this.executeWithRetry(
        async () => {
          const model = this.client.getGenerativeModel({
            model: this.model,
            generationConfig: {
              temperature: LLM_LIMITS.TEMPERATURE,
              responseMimeType: 'application/json',
            },
            systemInstruction: systemPrompt,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          });
          
          return model.generateContent(userPrompt);
        },
        (result) => result.response.text(),
        (error) => this.isRateLimitError(error),
        'Gemini'
      );
    } catch (error) {
      const enhancedMessage = this.enhanceErrorMessage(error instanceof Error ? error.message : String(error));
      throw new LLMError(enhancedMessage, error instanceof Error ? error : undefined, false);
    }
  }
  
  async validateConfig(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      await model.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }
  
  private isRateLimitError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('rate') || message.includes('limit') || message.includes('429') || message.includes('quota');
  }
}
```

**Why Safety Filters Disabled:** We analyze potentially problematic code patterns. Safety filters would incorrectly block legitimate accessibility analysis.

---

### `src/llm/ollama.ts` — Ollama Cloud Client

**Purpose:** Ollama Cloud API client using official SDK.

**Dependencies:**
- `ollama` — Official Ollama SDK
- `./types` — LLMError, AnalysisResult, OllamaConfig
- `../constants` — LLM_LIMITS

**Key Implementation:**

```typescript
class OllamaClient {
  public readonly provider = 'ollama';
  private readonly ollama: Ollama;
  private readonly model: string;
  
  constructor(config: { apiKey: string; model?: string; baseUrl?: string }) {
    this.model = config.model ?? 'llama3.2';
    
    this.ollama = new Ollama({
      host: (config.baseUrl ?? 'https://ollama.com').replace(/\/$/, ''),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  }
  
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    try {
      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        format: 'json',
        options: {
          temperature: LLM_LIMITS.TEMPERATURE,
          num_ctx: 32768,
        },
      });
      
      const content = response.message?.content;
      
      if (!content) {
        throw new LLMError('Ollama returned empty response', undefined, false);
      }
      
      return this.parseResponse(content);
    } catch (error) {
      throw this.handleError(error);
    }
  }
  
  private parseResponse(content: string): AnalysisResult {
    // Strip markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/i, '').replace(/\s*```$/,'');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/i, '').replace(/\s*```$/,'');
    }
    
    try {
      const parsed = JSON.parse(cleanContent);
      return this.validateResult(parsed);
    } catch {
      // Try extracting JSON from response
      const startIndex = cleanContent.indexOf('{');
      if (startIndex === -1) {
        throw new LLMError('No JSON object found in response', undefined, false);
      }
      
      let depth = 0;
      let endIndex = startIndex;
      for (let i = startIndex; i < cleanContent.length; i++) {
        if (cleanContent[i] === '{') depth++;
        if (cleanContent[i] === '}') depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
      
      const jsonStr = cleanContent.substring(startIndex, endIndex);
      const parsed = JSON.parse(jsonStr);
      return this.validateResult(parsed);
    }
  }
  
  async validateConfig(): Promise<boolean> {
    try {
      await this.ollama.list();
      return true;
    } catch {
      return false;
    }
  }
}
```

---

### `src/llm/index.ts` — Client Factory

**Purpose:** Factory pattern for provider instantiation.

**Dependencies:**
- `../types` — LLMProvider
- `./types` — LLMClient, GeminiConfig, OllamaConfig, LLMError
- `./gemini` — GeminiClient
- `./ollama` — OllamaClient

**Key Functions:**

```typescript
export function createLLMClient(
  provider: LLMProvider,
  config: GeminiConfig | OllamaConfig
): LLMClient {
  switch (provider) {
    case 'gemini':
      if (!('apiKey' in config) || !config.apiKey) {
        throw new LLMError('Gemini provider requires an API key', undefined, false);
      }
      return new GeminiClient(config as GeminiConfig);
      
    case 'ollama':
      return new OllamaClient(config as OllamaConfig);
      
    default:
      const _exhaustiveCheck: never = provider;
      throw new LLMError(`Unknown LLM provider: ${String(_exhaustiveCheck)}`, undefined, false);
  }
}

export function buildLLMConfig(
  provider: LLMProvider,
  apiKey: string | undefined,
  model: string | undefined,
  ollamaUrl: string
): GeminiConfig | OllamaConfig {
  switch (provider) {
    case 'gemini':
      return {
        apiKey: apiKey ?? '',
        model: model ?? 'gemini-2.0-flash',
      };
      
    case 'ollama':
      if (!apiKey) {
        throw new LLMError('Ollama Cloud requires an API key from https://ollama.com/settings/keys', undefined, false);
      }
      return {
        baseUrl: ollamaUrl,
        model: model ?? 'llama3.2',
        apiKey,
      };
      
    default:
      throw new LLMError(`Unknown provider: ${provider}`, undefined, false);
  }
}
```

**Adding a New Provider:**
1. Create `src/llm/new-provider.ts` implementing `LLMClient`
2. Add case to `createLLMClient()` factory
3. Add type to `LLMProvider` union in `src/types.ts`

---

### `src/github/client.ts` — GitHub API Wrapper

**Purpose:** Wrap Octokit for PR operations.

**Dependencies:**
- `@actions/github` — getOctokit
- `@actions/core` — Logging
- `../types` — FilePatch, PRInfo, FileStatus, CheckAnnotation
- `../constants` — GITHUB_LIMITS

**Key Methods:**

```typescript
class GitHubClient {
  private readonly octokit: ReturnType<typeof getOctokit>;
  private readonly owner: string;
  private readonly repo: string;
  
  constructor(token: string, owner: string, repo: string) {
    this.octokit = getOctokit(token);
    this.owner = owner;
    this.repo = repo;
  }
  
  // Fetch PR metadata
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
  
  // Fetch all PR files with pagination
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
          if (file.status === 'removed') continue;
          if (!file.patch) continue;
          
          const status = validateFileStatus(file.status);
          
          files.push({
            filename: file.filename,
            patch: file.patch,
            status,
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
          });
        }
        
        if (response.data.length < GITHUB_LIMITS.PER_PAGE) break;
        page++;
      }
      
      return files;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch PR files: ${message}`);
    }
  }
  
  // Create PR review with inline comments
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
      event: 'COMMENT',
      body,
      comments: comments.slice(0, GITHUB_LIMITS.MAX_REVIEW_COMMENTS),
    });
    
    core.info(`Created review ${review.id} with ${comments.length} comments`);
    return review.id;
  }
  
  // Create Check Run with annotations
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
  
  // Build position map for diff
  buildLineToPositionMap(patch: string): Map<number, number> {
    const map = new Map<number, number>();
    const lines = patch.split('\n');
    
    let position = 0;
    let newFileLine = 0;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        const match = line.match(/\+(\d+)/);
        if (match && match[1]) {
          newFileLine = parseInt(match[1], 10);
        }
        continue;
      }
      
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      
      if (line.startsWith('+') && !line.startsWith('+++')) {
        position++;
        map.set(newFileLine, position);
        newFileLine++;
        continue;
      }
      
      if (line.startsWith('-') && !line.startsWith('---')) {
        position++;
        continue;
      }
      
      if (!line.startsWith('\\')) {
        position++;
        newFileLine++;
      }
    }
    
    return map;
  }
}
```

**Diff Position Mapping:**
GitHub reviews use "position" (line offset in diff), not file line number. The `buildLineToPositionMap()` method builds a map from file line number → diff position.

---

### `src/github/pr.ts` — PR File Processing

**Purpose:** Filter and prioritize files for analysis.

**Dependencies:**
- `@actions/core` — Logging
- `../types` — FilePatch
- `./client` — GitHubClient
- `../utils/file-utils` — File filtering utilities

**Key Functions:**

```typescript
export async function fetchPRFiles(
  client: GitHubClient,
  prNumber: number,
  maxFiles: number
): Promise<FilePatch[]> {
  const allFiles = await client.getPRFiles(prNumber);
  
  if (maxFiles > 0 && allFiles.length > maxFiles) {
    core.warning(`PR has ${allFiles.length} files, but limit is ${maxFiles}. Analyzing first ${maxFiles} files.`);
    return allFiles.slice(0, maxFiles);
  }
  
  core.info(`Found ${allFiles.length} files to analyze`);
  return allFiles;
}

export function shouldSkipFile(file: FilePatch): boolean {
  if (!file.patch || file.patch.trim() === '') return true;
  
  const SKIP_PATTERNS = [
    /node_modules\//,
    /\.min\.(js|css)$/,
    /\.d\.ts$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /\.snap$/,
    /__snapshots__\//,
  ];
  
  return SKIP_PATTERNS.some(pattern => pattern.test(file.filename));
}

export function filterWebFiles(files: FilePatch[]): FilePatch[] {
  return files.filter(file => isWebFile(file.filename));
}
```

---

### `src/prompts/a11y-prompt.ts` — Prompt Engineering

**Purpose:** Build system and user prompts for WCAG 2.2 analysis.

**Dependencies:**
- `../types` — FilePatch

**Key Functions:**

```typescript
export function getSystemPrompt(): string {
  return `You are a WCAG 2.2 AA accessibility expert auditing PR diffs...
  
## Severity Classification
- CRITICAL: Blocks access - user cannot complete task
- SERIOUS: Degrades experience significantly
- MODERATE: Works but confusing or frustrating
- MINOR: Room for improvement beyond WCAG minimum

## Completeness Requirements
- Report EVERY instance found - do NOT summarize or group
- If 5 inputs lack labels, report 5 SEPARATE issues
- Each element on different line = separate issue report

## Same-Type Different-Line Rule
When SAME issue type appears on DIFFERENT lines, report each separately.

## Systematic Element Checklist
[Detailed checklist for each WCAG criterion...]

## Output Format
Return valid JSON matching this schema:
{
  "issues": [{
    "file": "path/to/file.tsx",
    "line": 42,
    "wcag_criterion": "1.1.1",
    "wcag_level": "A",
    "severity": "SERIOUS",
    "confidence": "high",
    "title": "Image missing alternative text",
    "description": "Screen readers cannot understand image content.",
    "impact": "Screen reader users will not know what the image conveys.",
    "suggestion": "<img src=\"chart.png\" alt=\"Bar chart showing 40% increase in Q3 sales\" />"
  }],
  "summary": "3 issues found: 1 CRITICAL, 1 SERIOUS, 1 MINOR"
}`;
}

export function buildUserPrompt(
  owner: string,
  repo: string,
  prNumber: number,
  files: FilePatch[]
): string {
  // Check for prompt injection
  const allContent = files.map(f => f.patch).join('\n');
  const injectionAttempts = detectPromptInjection(allContent);
  
  if (injectionAttempts.length > 0) {
    console.warn('[Security] Potential prompt injection detected');
  }
  
  // Sanitize and format
  const safeOwner = owner.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeRepo = repo.replace(/[^a-zA-Z0-9._-]/g, '');
  
  const header = `## Repository Context
- Repository: ${safeOwner}/${safeRepo}
- Pull Request: #${prNumber}
- Files to analyze: ${files.length}

## Task
Analyze the following diffs for WCAG 2.2 AA accessibility violations.
Focus only on NEW code (lines with '+' prefix).
Report issues with exact line numbers matching the [N] position markers.
`;

  const formattedDiffs = files.map(formatFilePatch).join('\n\n');
  
  const footer = `
## Important Reminders
1. Only flag issues on lines with '+' prefix (new code)
2. Use [N] position markers for line numbers
3. Provide EXACT code fixes, not instructions
4. Include confidence level for each finding
5. Describe the impact on users with disabilities

## Completeness Checklist
For EACH file, systematically check:
- [ ] All <img>, <svg>, <input>, <button>, <a> elements have required attributes
- [ ] All onClick handlers have keyboard alternatives
- [ ] All form fields have labels
- [ ] All interactive elements have accessible names
`;

  return `${header}${formattedDiffs}${footer}`;
}

function formatFilePatch(file: FilePatch): string {
  const safeFilename = sanitizeFilename(file.filename);
  const lines = file.patch.split('\n');
  let lineNumber = 0;
  const formattedLines: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      formattedLines.push(escapePromptContent(line));
      continue;
    }
    
    if (line.startsWith('+')) {
      lineNumber++;
      formattedLines.push(`[${lineNumber}] ${escapePromptContent(line)}`);
    } else if (line.startsWith('-')) {
      continue; // Skip deleted lines
    } else {
      lineNumber++;
      formattedLines.push(`[${lineNumber}] ${escapePromptContent(line)}`);
    }
  }
  
  return `[FILE] ${safeFilename}
[STATUS] ${file.status}
[DIFF]
${formattedLines.join('\n')}
[END DIFF]`;
}
```

**Security Functions:**

```typescript
// Escape special characters to prevent prompt injection
function escapePromptContent(content: string): string {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x1f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// Sanitize filename to prevent injection
function sanitizeFilename(filename: string): string {
  let sanitized = filename.replace(/\.\./g, '');
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');
  sanitized = sanitized.replace(/[^a-zA-Z0-9._\/\\-]/g, '');
  return sanitized;
}

// Detect prompt injection attempts
const PROMPT_INJECTION_PATTERNS = [
  /---\s*END\s+OF\s+(DIFF|CODE|FILE|PROMPT)\s*---/i,
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /system\s*:\s*$/im,
  /assistant\s*:\s*$/im,
  /\[SYSTEM\]/i,
  /\[ASSISTANT\]/i,
  /forget\s+(all\s+)?(previous\s+)?instructions?/i,
  /disregard\s+(all\s+)?(previous\s+)?instructions?/i,
  /you\s+are\s+now\s*a?\s*(different|new|malicious)/i,
  /act\s+as\s+(if|though)\s+you\s+are/i,
];

export function detectPromptInjection(content: string): string[] {
  const detected: string[] = [];
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      detected.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }
  return detected;
}
```

---

### `src/utils/batching.ts` — Batch Processing

**Purpose:** Split files into LLM-requestable chunks.

**Dependencies:**
- `@actions/core` — Logging
- `../types` — FilePatch
- `../constants` — LLM_LIMITS

**Key Functions:**

```typescript
export function createBatches(
  files: FilePatch[],
  batchSize: number = LLM_LIMITS.DEFAULT_BATCH_SIZE,
  maxFiles: number = 0
): FilePatch[][] {
  const filesToProcess = maxFiles > 0 ? files.slice(0, maxFiles) : files;
  
  const batches: FilePatch[][] = [];
  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    batches.push(filesToProcess.slice(i, i + batchSize));
  }
  
  core.info(`Created ${batches.length} batches of up to ${batchSize} files each`);
  
  return batches;
}

export function estimateTokens(files: FilePatch[]): number {
  const totalChars = files.reduce((sum, file) => sum + file.patch.length, 0);
  return Math.ceil(totalChars / 4); // ~4 chars per token
}
```

---

### `src/utils/validation.ts` — Input Validation

**Purpose:** Security-focused input validation.

**Dependencies:** None — Pure validation functions.

**Key Functions:**

```typescript
// SSRF protection
export function validateUrl(url: string): string {
  const sanitized = url.trim();
  
  if (sanitized.length > 2048) {
    throw new Error(`URL exceeds maximum length of 2048 characters`);
  }
  
  const parsedUrl = new URL(sanitized);
  
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid URL scheme: '${parsedUrl.protocol}'. Only http: and https: are allowed.`);
  }
  
  const hostname = parsedUrl.hostname.toLowerCase();
  
  // Allow localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
    return sanitized;
  }
  
  // Block private IP ranges
  if (isPrivateIpAddress(hostname)) {
    throw new Error(`URL hostname '${hostname}' resolves to a private/internal IP address`);
  }
  
  return sanitized;
}

// API key validation
export function validateApiKey(apiKey: string, minRequiredLength = 20): string {
  if (!apiKey) return '';
  
  if (apiKey.length > 500) {
    throw new Error(`API key exceeds maximum length of 500 characters`);
  }
  
  const sanitized = apiKey.trim();
  
  if (sanitized && sanitized.length < minRequiredLength) {
    throw new Error(`API key appears to be invalid. Expected at least ${minRequiredLength} characters`);
  }
  
  if (/[\x00-\x1F\x7F]/.test(sanitized)) {
    throw new Error('API key contains invalid control characters');
  }
  
  return sanitized;
}

// Model name validation
export function validateModelName(model: string): string {
  if (!model) return '';
  
  const sanitized = model.trim();
  
  if (sanitized.length > 100) {
    throw new Error(`Model name exceeds maximum length of 100 characters`);
  }
  
  if (!/^[a-zA-Z0-9._:-]+$/.test(sanitized)) {
    throw new Error(`Invalid model name: '${sanitized}'. Only alphanumeric characters, dots, dashes, underscores, and colons are allowed.`);
  }
  
  return sanitized;
}
```

---

### `src/utils/element-counter.ts` — Completeness Verification

**Purpose:** Count elements and verify LLM didn't miss issues.

**Dependencies:**
- `../types` — FilePatch

**Key Logic:**

```typescript
export function countElementsInDiff(patch: string): ElementCounts {
  const counts: ElementCounts = {
    images: 0, inputs: 0, buttons: 0, links: 0, svgs: 0,
    onClickHandlers: 0, roleAttributes: 0, labels: 0, ariaLabels: 0,
  };
  
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    
    const code = line.slice(1);
    
    if (/<img[\s>]/i.test(code) || /<Image[\s>]/i.test(code)) counts.images++;
    if (/<input[\s/>]/i.test(code)) counts.inputs++;
    if (/<button[\s>]/i.test(code) || /<Button[\s>]/i.test(code)) counts.buttons++;
    if (/<a[\s][^>]*href/i.test(code) || /<Link[\s>]/i.test(code)) counts.links++;
    if (/<svg[\s>]/i.test(code)) counts.svgs++;
    if (/onClick\s*[=:]/i.test(code)) counts.onClickHandlers++;
    if (/role\s*=\s*["'][^"']+["']/i.test(code)) counts.roleAttributes++;
    if (/<label[\s>]/i.test(code) || /<Label[\s>]/i.test(code)) counts.labels++;
    if (/aria-label\s*=/i.test(code)) counts.ariaLabels++;
  }
  
  return counts;
}

export function verifyCompleteness(
  elementCounts: ElementCounts,
  reportedIssues: Array<{ wcag_criterion: string; title: string }>
): VerificationResult {
  const reportedCounts = countReportedIssues(reportedIssues);
  const potentialGaps: string[] = [];
  
  // Heuristic: If #elements > 2x #issues, flag as potential gap
  if (elementCounts.images > 0 && reportedCounts.altTextIssues < elementCounts.images) {
    const ratio = elementCounts.images / Math.max(reportedCounts.altTextIssues, 1);
    if (ratio > 1.5) {
      potentialGaps.push(`Found ${elementCounts.images} <img> elements but only ${reportedCounts.altTextIssues} alt text issues reported`);
    }
  }
  
  if (elementCounts.inputs > 0 && reportedCounts.labelIssues < elementCounts.inputs) {
    const ratio = elementCounts.inputs / Math.max(reportedCounts.labelIssues, 1);
    if (ratio > 2) {
      potentialGaps.push(`Found ${elementCounts.inputs} <input> elements but only ${reportedCounts.labelIssues} label issues reported`);
    }
  }
  
  if (elementCounts.onClickHandlers > 0 && reportedCounts.keyboardIssues < elementCounts.onClickHandlers) {
    const ratio = elementCounts.onClickHandlers / Math.max(reportedCounts.keyboardIssues, 1);
    if (ratio > 2) {
      potentialGaps.push(`Found ${elementCounts.onClickHandlers} onClick handlers but only ${reportedCounts.keyboardIssues} keyboard issues reported`);
    }
  }
  
  return { potentialGaps, filesWithGaps: [], passed: potentialGaps.length === 0 };
}
```

---

### `src/utils/file-utils.ts` — Hybrid File Filtering

**Purpose:** Detect user-facing markup in any project type using hybrid approach (blocklist + allowlist + content detection).

**Dependencies:**
- `../types` — FilePatch

**Key Constants:**

```typescript
// Files that ALWAYS contain user-facing markup
export const DIRECT_MARKUP_EXTENSIONS = [
  // HTML variants
  'html', 'htm', 'xhtml',
  // JavaScript frameworks (explicit JSX/TSX)
  'jsx', 'tsx',
  // Vue/Svelte/Astro
  'vue', 'svelte', 'astro',
  // Template engines
  'erb', 'ejs', 'hbs', 'mustache', 'pug',
  // PHP templates
  'php', 'blade.php',
  // .NET templates
  'cshtml', 'vbhtml',
  // Java templates
  'jsp', 'jspx',
  // Symfony/Twig
  'twig',
  // Shopify
  'liquid',
  // Style files
  'css', 'scss', 'sass', 'less', 'styl',
  // Documentation with embedded markup
  'md', 'mdx',
] as const;

// Files that MIGHT contain user-facing markup (content check required)
export const AMBIGUOUS_EXTENSIONS = [
  'js', 'ts', 'mjs', 'cjs',    // May contain JSX
  'py',                         // Django/Frappe templates
  'rb',                         // Rails templates
  'java',                       // JSP-like patterns
] as const;

// Files that should ALWAYS be skipped
export const SKIP_PATTERNS = [
  // Dependencies
  /node_modules\//,
  // Generated/minified files
  /\.min\.(js|css)$/,
  /\.d\.ts$/,
  /package(-lock)?\.json$/,
  /yarn\.lock$/,
  /\.snap$/,
  /__snapshots__\//,
  // Test files
  /__tests__\//,
  /\.test\.(js|ts|jsx|tsx|py|rb)$/,
  /\.spec\.(js|ts|jsx|tsx|py|rb)$/,
  // Config files
  /\.env(\.|$)/,
  /tsconfig/,
  /\.config\.(js|ts|json|mjs|cjs)$/,
  // Generated files
  /\.generated\./,
  /__generated__\//,
  /dist\//,
  /build\//,
  // Database migrations
  /migrations?\//,
  // API/backend only
  /api\//,
  /server\//,
  /backend\//,
  // CI/CD
  /\.github$/,
  /\.gitlab-ci\.yml$/,
] as const;

// Content patterns indicating user-facing markup
const MARKUP_CONTENT_PATTERNS = [
  /<[A-Z][a-zA-Z]*[\s>]/,              // JSX components: <Button
  /<[a-z][a-z0-9]*[\s>\/>]/i,          // HTML tags: <div, <span
  /className\s*[=:>\{]/i,             // React className
  /class\s*=\s*["'`{]/i,              // HTML class attribute
  /style\s*=\s*[{"]/i,                // Inline styles
  /jsx\s*[=:>\{]/i,                   // JSX pragma/import
  /html\s*[`'"]/,                     // Tagged template literals
  /ReactDOM/i,                        // React DOM
  /createRoot\s*\(/i,                 // React 18
  /@Component\s*\(/i,                 // Angular/Vue decorator
  /template\s*:\s*[<{/"`]/i,         // Vue/Angular inline template
  /\{\%\s*.+?\s*\%\}/,                // Template tags (Jinja, Django, Twig)
  /\{\{.+?\}\}/,                      // Mustache/Handlebars
  /<\?.*?\?>/,                        // PHP tags
  /<%\s*.+?\s*%>/,                    // ERB/EJS tags
  /@php/i,                            // Blade PHP directive
  /v-if|v-for|v-bind|v-on/i,          // Vue directives
  /ng-if|ng-for|ng-bind|ng-click/i,   // Angular directives
];
```

**Key Functions:**

```typescript
// Check if file is a direct markup extension (always analyze)
export function isWebFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return DIRECT_MARKUP_EXTENSIONS_SET.has(ext);
}

// Check if file extension is ambiguous (needs content check)
export function isAmbiguousExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return AMBIGUOUS_EXTENSIONS_SET.has(ext);
}

// Check if content contains markup patterns
export function containsMarkupPatterns(patchContent: string): boolean {
  const addedLines = patchContent
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');
  
  return MARKUP_CONTENT_PATTERNS.some(pattern => pattern.test(addedLines));
}

// Determine if a file should be analyzed (hybrid approach)
export function shouldAnalyzeFile(file: FilePatch): boolean {
  if (!file.patch || file.patch.trim() === '') return false;
  
  const ext = getFileExtension(file.filename);
  
  // Direct markup files - always analyze
  if (DIRECT_MARKUP_EXTENSIONS_SET.has(ext)) return true;
  
  // Ambiguous extensions - check content
  if (AMBIGUOUS_EXTENSIONS_SET.has(ext)) {
    return containsMarkupPatterns(file.patch);
  }
  
  // Unknown extensions - check content defensively
  return containsMarkupPatterns(file.patch);
}

// Filter files for analysis using hybrid approach
export function filterFilesForAnalysis(files: FilePatch[]): FilePatch[] {
  return files.filter(file => {
    if (shouldSkipFile(file)) return false;
    return shouldAnalyzeFile(file);
  });
}

// Check if file should be skipped (blocklist)
export function shouldSkipFile(file: FilePatch): boolean {
  if (!file.patch || file.patch.trim() === '') return true;
  return SKIP_PATTERNS.some(pattern => pattern.test(file.filename));
}
```

**Why This Approach:**

1. **Works for any project type** - React, Vue, Svelte, WordPress, Django, Rails, Frappe
2. **Catches markup in unexpected places** - `.js` files with JSX, `.py` files with templates
3. **Wastes fewer tokens** - Skips logic-only files that have no markup
4. **Still skips config/test** - Blocklist removes non-user-facing code

**Examples:**

| File | Extension | Content Detection | Result |
|------|-----------|-------------------|--------|
| `App.tsx` | `.tsx` (direct) | N/A | ✅ Analyze |
| `page.js` | `.js` (ambiguous) | `<Button>Click</Button>` | ✅ Analyze |
| `utils.js` | `.js` (ambiguous) | `const x = 42;` | ❌ Skip |
| `Card.py` | `.py` (ambiguous) | `return "<div>Hello</div>"` | ✅ Analyze |
| `config.js` | `.js` (ambiguous) | Skipped by `config\.js$` pattern | ❌ Skip |
| `Button.test.tsx` | `.tsx` (direct) | Skipped by `\.test\.` pattern | ❌ Skip |

---

### `src/output.ts` — Result Posting

**Purpose:** Format and post results to GitHub (comments or checks).

**Dependencies:**
- `@actions/core` — Logging
- `./types` — A11yIssue, FailedBatch
- `./github/client` — GitHubClient
- `./utils/formatting` — Comment formatting
- `./constants` — GITHUB_LIMITS

**Key Functions:**

```typescript
export async function postResults(
  github: GitHubClient,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[],
  outputMode: 'comments' | 'checks'
): Promise<void> {
  if (outputMode === 'comments') {
    await postReview(github, prNumber, headSha, issues, failedBatches);
  } else {
    await postCheckRun(github, prNumber, headSha, issues, failedBatches);
  }
}

// Post PR review with inline comments
async function postReview(
  github: GitHubClient,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[]
): Promise<void> {
  if (issues.length === 0) {
    await github.createReview(prNumber, headSha, [], formatNoIssuesComment());
    return;
  }
  
  const summaryBody = buildSummaryBody(issues, failedBatches);
  const violations = issues.filter(isViolation);
  const filePatches = await github.getPRFiles(prNumber);
  const patchMap = new Map(filePatches.map(f => [f.filename, f.patch]));
  const comments = await buildInlineComments(groupByFile(violations), patchMap, github);
  
  await github.createReview(prNumber, headSha, comments, summaryBody);
}

// Post Check Run with annotations
async function postCheckRun(
  github: GitHubClient,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  failedBatches: FailedBatch[]
): Promise<void> {
  const violations = issues.filter(isViolation).length;
  const goodPractices = issues.filter(i => i.severity === 'MINOR').length;
  const annotations = buildAnnotations(issues);
  const summary = formatCheckSummary(issues, failedBatches);
  
  await github.createCheckRun(headSha, violations, goodPractices, summary, annotations);
  
  if (issues.length > GITHUB_LIMITS.MAX_ANNOTATIONS) {
    core.warning(`Found ${issues.length} issues but only ${GITHUB_LIMITS.MAX_ANNOTATIONS} can be displayed as annotations`);
  }
}

// Helper: violations are CRITICAL, SERIOUS, or MODERATE
function isViolation(issue: A11yIssue): boolean {
  return issue.severity === 'CRITICAL' || issue.severity === 'SERIOUS' || issue.severity === 'MODERATE';
}

// Helper: severity to annotation level
function buildAnnotations(issues: A11yIssue[]): CheckAnnotation[] {
  const severityLevel: Record<string, 'failure' | 'warning' | 'notice'> = {
    CRITICAL: 'failure',
    SERIOUS: 'failure',
    MODERATE: 'warning',
    MINOR: 'notice',
  };
  
  return issues.slice(0, GITHUB_LIMITS.MAX_ANNOTATIONS).map(issue => ({
    path: issue.file,
    start_line: issue.line ?? 1,
    end_line: issue.line ?? 1,
    annotation_level: severityLevel[issue.severity] ?? 'warning',
    message: issue.description,
    title: `${issue.severity}: ${issue.title} (WCAG ${issue.wcag_criterion})`,
    raw_details: issue.suggestion,
  }));
}
```

---

### `src/security/gitleaks.ts` — Secret Detection

**Purpose:** Prevent secret exfiltration to LLM APIs.

**Dependencies:**
- `@actions/core` — Logging
- `child_process` — execFile
- `fs` — File system operations
- `path` — Path utilities
- `../types` — FilePatch, SecretFinding

**Key Functions:**

```typescript
export async function redactSecrets(
  files: FilePatch[],
  skipOnFailure: boolean = false
): Promise<{ files: FilePatch[]; secretsFound: number; skipped: boolean }> {
  const gitleaksAvailable = await isGitleaksAvailable();
  
  if (!gitleaksAvailable) {
    core.warning('Gitleaks not found - skipping secret detection');
    return { files, secretsFound: 0, skipped: false };
  }
  
  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'gitleaks-scan-'));
  const tempFile = path.join(tempDir, 'diffs.txt');
  
  try {
    // Write all patches to temp file
    const content = files.map(f => `=== ${f.filename} ===\n${f.patch}`).join('\n\n');
    fs.writeFileSync(tempFile, content);
    
    // Run gitleaks safely using execFile
    const result = await runGitleaks(tempFile, tempDir);
    
    if (result.error) {
      core.warning(`Gitleaks scan failed: ${result.error}`);
      if (skipOnFailure) {
        return { files: [], secretsFound: 0, skipped: true };
      }
      return { files, secretsFound: 0, skipped: false };
    }
    
    // Redact secrets
    const redactedFiles = redactSecretsFromPatches(files, result.findings);
    
    core.info(`Gitleaks found ${result.findings.length} potential secrets - redacted from analysis`);
    
    return { files: redactedFiles, secretsFound: result.findings.length, skipped: false };
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Run gitleaks safely (no shell interpolation)
async function runGitleaks(
  filePath: string,
  reportDir: string
): Promise<{ findings: GitleaksFinding[]; error?: string }> {
  const reportPath = path.join(reportDir, 'report.json');
  
  return new Promise((resolve) => {
    // Use execFile with argument array - NO shell interpolation
    const args = [
      'detect',
      `--source=${filePath}`,
      '--report-format=json',
      `--report-path=${reportPath}`,
      '--no-git',
      '--exit-code=0'
    ];
    
    execFile('gitleaks', args, { maxBuffer: 1024 * 1024 * 10 }, (error) => {
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
        resolve({ findings: [], error: errorMsg });
      }
    });
  });
}

// Redact secrets from patches
function redactSecretsFromPatches(
  files: FilePatch[],
  findings: GitleaksFinding[]
): FilePatch[] {
  if (findings.length === 0) return files;
  
  return files.map(file => {
    let redactedPatch = file.patch;
    
    for (const finding of findings) {
      if (finding.File === file.filename && finding.Secret) {
        const secretPattern = escapeRegex(finding.Secret);
        const regex = new RegExp(secretPattern, 'g');
        redactedPatch = redactedPatch.replace(regex, '[REDACTED]');
      }
    }
    
    return { ...file, patch: redactedPatch };
  });
}
```

**Security Constraints:**
- Uses `execFile()` instead of `exec()` to prevent shell injection
- Arguments passed as array, not interpolated string
- Temp directory unique per execution
- Cleanup guaranteed via `finally`

---

## File Interdependencies

### Dependency Graph

```
src/index.ts
├── src/inputs.ts
│   ├── src/types.ts
│   ├── src/constants.ts
│   └── src/utils/validation.ts
├── src/llm/index.ts
│   ├── src/llm/gemini.ts
│   │   ├── src/llm/base.ts
│   │   │   ├── src/llm/types.ts
│   │   │   └── src/constants.ts
│   │   └── @google/generative-ai
│   └── src/llm/ollama.ts
│       ├── src/llm/types.ts
│       ├── src/constants.ts
│       └── ollama
├── src/github/client.ts
│   ├── src/types.ts
│   ├── src/constants.ts
│   └── @actions/github
├── src/orchestrator.ts
│   ├── src/github/pr.ts
│   │   ├── src/github/client.ts
│   │   └── src/utils/file-utils.ts
│   ├── src/security/gitleaks.ts
│   ├── src/prompts/a11y-prompt.ts
│   ├── src/utils/batching.ts
│   └── src/utils/element-counter.ts
├── src/output.ts
│   ├── src/github/client.ts
│   ├── src/utils/formatting.ts
│   └── src/constants.ts
├── src/utils/context.ts
│   └── @actions/github
└── src/utils/stats.ts
    └── src/types.ts
```

### Module Responsibilities

| Module | Responsibility | Dependencies | Exports |
|--------|---------------|--------------|---------|
| `index.ts` | Entry point, error handling | All modules | `run()` |
| `inputs.ts` | Input parsing, validation | `types.ts`, `constants.ts`, `validation.ts` | `parseInputs()`, `setOutputs()` |
| `types.ts` | Type definitions | None | All interfaces and types |
| `constants.ts` | Configuration constants | None | `GITHUB_LIMITS`, `LLM_LIMITS`, `ACTION_DEFAULTS` |
| `orchestrator.ts` | Workflow coordination | `github/pr.ts`, `security/gitleaks.ts`, `prompts/a11y-prompt.ts`, `utils/batching.ts`, `utils/element-counter.ts` | `analyzeFiles()`, `AnalysisContext`, `AnalysisResult` |
| `llm/types.ts` | LLM interface, schema | `types.ts` | `LLMClient`, `AnalysisResult`, `GeminiConfig`, `OllamaConfig`, `LLMError` |
| `llm/base.ts` | Retry, timeout, parsing | `llm/types.ts`, `constants.ts` | `BaseLLMClient` |
| `llm/gemini.ts` | Gemini client | `llm/base.ts`, `@google/generative-ai` | `GeminiClient` |
| `llm/ollama.ts` | Ollama client | `llm/types.ts`, `ollama` | `OllamaClient` |
| `llm/index.ts` | Client factory | `llm/gemini.ts`, `llm/ollama.ts` | `createLLMClient()`, `buildLLMConfig()` |
| `github/client.ts` | GitHub API wrapper | `types.ts`, `constants.ts`, `@actions/github` | `GitHubClient` |
| `github/pr.ts` | PR file processing | `github/client.ts`, `utils/file-utils.ts` | `fetchPRFiles()`, `shouldSkipFile()`, `filterWebFiles()` (uses hybrid `filterFilesForAnalysis()`) |
| `prompts/a11y-prompt.ts` | Prompt engineering | `types.ts` | `getSystemPrompt()`, `buildUserPrompt()`, `detectPromptInjection()` |
| `utils/validation.ts` | Input validation | None | `validateUrl()`, `validateApiKey()`, `validateModelName()` |
| `utils/batching.ts` | File batching | `types.ts`, `constants.ts` | `createBatches()`, `estimateTokens()` |
| `utils/element-counter.ts` | Completeness verification | `types.ts` | `countElementsInFiles()`, `verifyCompleteness()` |
| `utils/file-utils.ts` | Hybrid file filtering | `types.ts` | `isWebFile()`, `shouldSkipFile()`, `shouldAnalyzeFile()`, `containsMarkupPatterns()`, `filterFilesForAnalysis()` |
| `utils/context.ts` | GitHub context extraction | `@actions/github` | `getRepoContext()`, `getPRNumber()` |
| `utils/stats.ts` | Statistics calculation | `types.ts` | `calculateStats()` |
| `utils/error-messages.ts` | Error enhancement | `llm/types.ts` | `enhanceLLMError()` |
| `output.ts` | Result posting | `github/client.ts`, `utils/formatting.ts`, `constants.ts` | `postResults()` |
| `security/gitleaks.ts` | Secret detection | `types.ts`, `@actions/core`, `child_process`, `fs`, `path` | `redactSecrets()` |

---

## Type System

### Union Types for Constrained Values

```typescript
type LLMProvider = 'gemini' | 'ollama';
type OutputMode = 'comments' | 'checks';
type WcagLevel = 'A' | 'AA' | 'AAA';
type Severity = 'CRITICAL' | 'SERIOUS' | 'MODERATE' | 'MINOR';
type Confidence = 'high' | 'medium' | 'low';
type FileStatus = 'added' | 'modified' | 'removed' | 'renamed';
```

**Benefit:** Compile-time exhaustiveness checking. Impossible to assign invalid values.

### Discriminated Unions

```typescript
type LLMConfig = GeminiConfig | OllamaConfig;

interface GeminiConfig {
  apiKey: string;
  model?: string;
}

interface OllamaConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

function createClient(config: LLMConfig): LLMClient {
  if ('apiKey' in config) {
    return new GeminiClient(config);
  }
  return new OllamaClient(config);
}
```

### Runtime Validation

```typescript
const VALID_FILE_STATUSES: ReadonlySet<string> = new Set([
  'added', 'modified', 'removed', 'renamed'
]);

function validateFileStatus(status: string): FileStatus {
  if (!VALID_FILE_STATUSES.has(status)) {
    throw new Error(`Invalid file status: ${status}`);
  }
  return status as FileStatus;
}
```

---

## Security Implementation

### Defense in Depth

| Layer | Mechanism | Module |
|-------|-----------|--------|
| **Input** | Allowlist validation | `inputs.ts` |
| **Input** | SSRF protection | `validation.ts:validateUrl()` |
| **Input** | Model name sanitization | `validation.ts:validateModelName()` |
| **Processing** | Secret detection/redaction | `security/gitleaks.ts` |
| **Processing** | Prompt content escaping | `prompts/a11y-prompt.ts` |
| **Transport** | HTTPS-only for Ollama | `validation.ts` |
| **Transport** | Request timeout | `llm/base.ts` |
| **Transport** | No shell interpolation | `security/gitleaks.ts` |

### Threat Model

| Threat | Mitigation | Code Location |
|--------|------------|---------------|
| **SSRF** | URL validation blocks private IPs, non-HTTP schemes | `validation.ts:73-90` |
| **Command Injection** | `execFile()` with array arguments | `gitleaks.ts:109-118` |
| **Prompt Injection** | Content escaping, filename sanitization | `a11y-prompt.ts:194-219` |
| **Secret Leakage** | Gitleaks scan + redaction before LLM | `gitleaks.ts:32-86` |
| **Credential Exposure** | Secrets masked in logs | `inputs.ts:38-40` |
| **DoS** | Request timeout, file limits, batch sizes | `constants.ts`, `llm/base.ts` |

### Zero Trust Principles

1. **Never trust input** — All inputs validated
2. **Never trust LLM output** — JSON schema validation
3. **Never trust file content** — Escaped before prompts
4. **Fail closed** — Security failures block analysis

---

## LLM Integration

### Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    LLM Request Lifecycle                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Build System Prompt (WCAG 2.2 expert instructions)         │
│  2. Build User Prompt (formatted diff with position markers)    │
│  3. Initialize AbortController with timeout                     │
│  4. POST to API endpoint                                        │
│     ├─ Gemini: generativelanguage.googleapis.com               │
│     └─ Ollama: ollama.com/api/chat                             │
│  5. On rate limit (429): Retry with exponential backoff         │
│  6. Parse JSON response                                         │
│  7. Validate against schema                                     │
│  8. Return AnalysisResult or throw LLMError                   │
└─────────────────────────────────────────────────────────────────┘
```

### Provider Comparison

| Aspect | Gemini | Ollama |
|--------|--------|--------|
| **Transport** | SDK (REST) | SDK (HTTP) |
| **Auth** | API Key (X-API-Key header) | Bearer token (required) |
| **JSON Mode** | `responseMimeType: 'application/json'` | `format: 'json'` |
| **Context Window** | Model-dependent (Flash: 1M tokens) | Configurable (`num_ctx: 32768`) |
| **Rate Limits** | 60 req/min (free tier) | Varies by plan |
| **Latency** | 200-2000ms | 100-500ms (cloud) |
| **Default Model** | gemini-2.0-flash | llama3.2 |
| **Safety Filters** | Disabled (for code analysis) | N/A |

---

## GitHub Integration

### API Calls

| Endpoint | Purpose | Called From |
|----------|---------|-------------|
| `GET /repos/{owner}/{repo}/pulls/{number}` | PR metadata | `getPRInfo()` |
| `GET /repos/{owner}/{repo}/pulls/{number}/files` | Changed files | `getPRFiles()` |
| `POST /repos/{owner}/{repo}/pulls/{number}/reviews` | Create review | `createReview()` |
| `POST /repos/{owner}/{repo}/check-runs` | Create check run | `createCheckRun()` |

### Rate Limits

| Token Type | Limit | Handling |
|------------|-------|----------|
| `GITHUB_TOKEN` | 1,000 req/hr | Not retried |
| PAT | 5,000 req/hr | Not retried |

### Authentication

```typescript
// Uses default GITHUB_TOKEN from Actions context
const octokit = getOctokit(token);

// Token has permissions from workflow:
// - contents: read (checkout)
// - pull_requests: write (review comments)
// - checks: write (check runs)
```

---

## Output Modes

### Comments Mode (PR Review)

```
┌─────────────────────────────────────────────────────────────┐
│                    PR Review Mode                           │
├─────────────────────────────────────────────────────────────┤
│  1. Build inline comments for violations only               │
│     - CRITICAL, SERIOUS, MODERATE severities               │
│     - MINOR (good practices) in summary only               │
│  2. Map line numbers to diff positions                      │
│  3. POST /repos/{owner}/{repo}/pulls/{number}/reviews       │
│  4. On failure: POST issue comment as fallback               │
│                                                             │
│  Review Body:                                               │
│  - Summary with issue counts by severity                    │
│  - Good practices (MINOR)                                   │
│  - Failed batches warning                                   │
│                                                             │
│  Inline Comments:                                            │
│  - 🔴 **[Title]**                                           │
│  - **WCAG X.X.X** (Level A)                                 │
│  - [Description]                                            │
│  - ```suggestion [exact fix] ```                            │
└─────────────────────────────────────────────────────────────┘
```

### Checks Mode (Check Run)

```
┌─────────────────────────────────────────────────────────────┐
│                    Check Run Mode                            │
├─────────────────────────────────────────────────────────────┤
│  1. Build annotations (max 50)                              │
│     - CRITICAL/SERIOUS: 'failure' level                     │
│     - MODERATE: 'warning' level                              │
│     - MINOR: 'notice' level                                 │
│  2. POST /repos/{owner}/{repo}/check-runs                    │
│  3. On failure: Fall back to comments mode                   │
│                                                             │
│  Check Run Result:                                           │
│  - conclusion: 'failure' if violations > 0                  │
│  - conclusion: 'success' if no violations                   │
│  - summary: Issue breakdown + failed batches                │
│                                                             │
│  Annotations:                                                │
│  - Shown in "Checks" tab                                     │
│  - Link to specific lines                                    │
│  - Can block merge if required check                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### Error Hierarchy

```typescript
class LLMError extends Error {
  message: string;
  originalError: Error | undefined;
  isRetryable: boolean;
}

class ValidationError extends Error {
  input: string;
  value: string;
}

class GitHubAPIError extends Error {
  statusCode: number;
  operation: string;
}
```

### Retry Logic

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    return await apiCall();
  } catch (error) {
    if (isRetryable(error) && attempt < MAX_RETRIES - 1) {
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      continue;
    }
    throw error;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LLMError) return error.isRetryable;
  const message = String(error).toLowerCase();
  return message.includes('429') || message.includes('rate limit');
}
```

### Failure Tracking

| Failure Type | Handling | User Notified |
|--------------|----------|---------------|
| Input validation | Throw, fail action | Yes (error message) |
| LLM config invalid | Fail action | Yes |
| Batch analysis fail | Track, continue | Yes (warning) |
| Review creation fail | Fallback to comment | Yes |
| Gitleaks fail | Skip analysis | Yes (warning) |
| Secret detected | Redact, continue | Yes (info log) |

---

## Configuration Reference

### Action Inputs (`action.yml`)

| Input | Type | Required | Default | Validation |
|-------|------|----------|---------|------------|
| `github-token` | string | Yes | `${{ github.token }}` | Non-empty |
| `llm-provider` | string | Yes | `gemini` | `gemini \| ollama` |
| `api-key` | string | No* | - | Length ≥20 (Gemini) / ≥10 (Ollama), no control chars |
| `model` | string | No | `gemini-2.0-flash` / `llama3.2` | `[a-zA-Z0-9.-_:]+` |
| `ollama-url` | string | No | `https://ollama.com` | HTTP/HTTPS, non-private IP |
| `output-mode` | string | No | `checks` | `comments \| checks` |
| `fail-on-issues` | boolean | No | `true` | Boolean |
| `max-files` | number | No | `100` | Integer ≥0 |
| `batch-size` | number | No | `20` | Integer 5-50 |
| `skip-drafts` | boolean | No | `true` | Boolean |

**Note:** `api-key` is required for both Gemini and Ollama Cloud.

### Action Outputs

| Output | Type | Description |
|--------|------|-------------|
| `issues-found` | number | Total issue count |
| `violations` | number | CRITICAL + SERIOUS + MODERATE count |
| `good-practices` | number | MINOR count |

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | GitHub API token | Yes (from Actions context) |
| `GEMINI_API_KEY` | Gemini API key | If llm-provider=gemini |
| `OLLAMA_API_KEY` | Ollama Cloud API key | If llm-provider=ollama |

---

## Development Guidelines

### Adding a New LLM Provider

1. Create `src/llm/new-provider.ts` implementing `LLMClient`:

```typescript
export class NewProviderClient implements LLMClient {
  public readonly provider = 'new-provider';
  
  async analyze(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    // Implement provider-specific request
  }
  
  async validateConfig(): Promise<boolean> {
    // Implement provider-specific validation
  }
}
```

2. Add type to `LLMProvider` in `src/types.ts`:

```typescript
type LLMProvider = 'gemini' | 'ollama' | 'new-provider';
```

3. Add case to `createLLMClient()` in `src/llm/index.ts`:

```typescript
case 'new-provider':
  return new NewProviderClient(config as NewProviderConfig);
```

4. Add case to `buildLLMConfig()` in `src/llm/index.ts`.

### Adding a New Output Mode

1. Add type to `OutputMode` in `src/types.ts`:

```typescript
type OutputMode = 'comments' | 'checks' | 'slack';
```

2. Add case to `postResults()` in `src/output.ts`:

```typescript
case 'slack':
  await postToSlack(webhook, issues, config.slackChannel);
  break;
```

### Adding a New WCAG Criterion Check

1. Update system prompt in `src/prompts/a11y-prompt.ts`:

```typescript
// Add to "Systematic Element Checklist" section
### NEW PATTERN (WCAG X.X.X)
- Description of what to check
- How to identify violations
// Add to "What to Report" section
```

2. Add criterion to `WCAG_CRITERIA` constant:

```typescript
export const WCAG_CRITERIA = {
  // ... existing criteria
  'X.X.X': { level: 'A' as const, title: 'New Criterion Name' },
} as const;
```

### Running Locally

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

### Testing with Local Files

Create a test workflow:

```yaml
name: Test Action
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-provider: gemini
          api-key: ${{ secrets.GEMINI_API_KEY }}
          output-mode: checks
          fail-on-issues: true
```

---

## Appendix: File Summary Table

| File | Lines | Purpose | Key Exports |
|------|-------|---------|-------------|
| `src/index.ts` | 191 | Entry point | `run()` |
| `src/orchestrator.ts` | 286 | Workflow coordination | `analyzeFiles()`, `AnalysisContext` |
| `src/types.ts` | 258 | Type definitions | All interfaces |
| `src/constants.ts` | 57 | Configuration constants | `GITHUB_LIMITS`, `LLM_LIMITS` |
| `src/inputs.ts` | 143 | Input parsing | `parseInputs()`, `setOutputs()` |
| `src/output.ts` | 311 | Result posting | `postResults()` |
| `src/llm/types.ts` | 206 | LLM interface | `LLMClient`, `AnalysisResult`, `LLMError` |
| `src/llm/base.ts` | 265 | Base client | `BaseLLMClient` |
| `src/llm/gemini.ts` | 312 | Gemini client | `GeminiClient` |
| `src/llm/ollama.ts` | 255 | Ollama client | `OllamaClient` |
| `src/llm/index.ts` | 96 | Client factory | `createLLMClient()`, `buildLLMConfig()` |
| `src/github/client.ts` | 233 | GitHub API | `GitHubClient` |
| `src/github/pr.ts` | 53 | PR file processing | `fetchPRFiles()`, `shouldSkipFile()` |
| `src/prompts/a11y-prompt.ts` | 397 | Prompt engineering | `getSystemPrompt()`, `buildUserPrompt()` |
| `src/utils/validation.ts` | 226 | Input validation | `validateUrl()`, `validateApiKey()`, `validateModelName()` |
| `src/utils/batching.ts` | 46 | File batching | `createBatches()`, `estimateTokens()` |
| `src/utils/element-counter.ts` | 314 | Completeness verification | `countElementsInFiles()`, `verifyCompleteness()` |
| `src/utils/file-utils.ts` | 478 | Hybrid file filtering | `isWebFile()`, `shouldAnalyzeFile()`, `containsMarkupPatterns()`, `filterFilesForAnalysis()` |
| `src/utils/context.ts` | 45 | GitHub context | `getRepoContext()`, `getPRNumber()` |
| `src/utils/stats.ts` | 46 | Statistics | `calculateStats()` |
| `src/utils/error-messages.ts` | 187 | Error enhancement | `enhanceLLMError()` |
| `src/security/gitleaks.ts` | 194 | Secret detection | `redactSecrets()` |
| `action.yml` | 69 | Action metadata | Inputs/outputs |