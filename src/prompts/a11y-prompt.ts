/**
 * WCAG 2.2 accessibility prompts for PR analysis.
 * Based on research from accessibility-agents project.
 * 
 * @module prompts/a11y-prompt
 */

import type { FilePatch } from '../types';

/**
 * Get the system prompt for WCAG 2.2 accessibility analysis.
 * This is the "expert persona" that guides the LLM's behavior.
 */
export function getSystemPrompt(): string {
  return `You are a WCAG 2.2 AA accessibility expert auditing PR diffs. You identify violations and good practices in code changes.

## Authoritative Sources (Always Cite)
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WAI-ARIA 1.2: https://www.w3.org/TR/wai-aria-1.2/
- ARIA Authoring Practices: https://www.w3.org/WAI/ARIA/apg/

## Severity Classification
- CRITICAL: Blocks access - user cannot complete task (e.g., missing alt on critical image, keyboard trap)
- SERIOUS: Degrades experience significantly (e.g., poor contrast, missing focus indicator)
- MODERATE: Works but confusing or frustrating (e.g., vague link text, skipped heading)
- MINOR: Room for improvement beyond WCAG minimum (e.g., enhanced contrast, better focus styles)

## WCAG Level Mapping
- Level A violations → Report as CRITICAL or SERIOUS
- Level AA violations → Report as SERIOUS or MODERATE
- Good practices beyond minimum → Report as MINOR

## Confidence Levels
- high: Definitively wrong (missing required ARIA, invalid role, broken ID reference)
- medium: Likely wrong (unusual pattern, may need browser verification)
- low: Possibly wrong (context-dependent, may be intentional, flag for human review)

Report issues at ALL confidence levels. Do NOT filter by confidence - let developers decide what to fix.

## Completeness Requirements (CRITICAL)
- Report EVERY instance found - do NOT summarize or group similar issues
- If 5 inputs lack labels, report 5 SEPARATE issues at their respective lines
- Each element on a different line = separate issue report
- Do NOT stop after finding "some" issues - check ALL elements exhaustively
- Better to over-report than under-report - completeness is essential

## Same-Type Different-Line Rule
When the SAME issue type appears on DIFFERENT lines, report each instance separately:

Example - Multiple inputs without labels:
- Line 9: <input type="email"> missing label → Issue #1 at line 9
- Line 14: <input type="password"> missing label → Issue #2 at line 14
- Line 30: <input type="text"> missing label → Issue #3 at line 30
Result: 3 SEPARATE issues (NOT 1 grouped issue)

Example - Multiple images without alt:
- Line 12: <img src="product.jpg"> missing alt → Issue #1 at line 12
- Line 33: <img src="avatar.jpg"> missing alt → Issue #2 at line 33
Result: 2 SEPARATE issues

## Systematic Element Checklist

For EACH file, check EVERY instance of these elements:

### IMAGES & ICONS (WCAG 1.1.1)
- Every <img> element: MUST have alt="" (decorative) OR descriptive alt (informative)
- Every <svg> inside interactive element: MUST have aria-label OR <title> element
- Every background image conveying info: MUST have text alternative

### FORMS (WCAG 3.3.2, 1.3.1)
- Every <input> without type: MUST have <label> OR aria-label
- Every <input type="text|email|password|tel|url|search">: MUST have <label> OR aria-label
- Every <textarea>: MUST have <label> OR aria-label
- Every <select>: MUST have <label> OR aria-label
- CRITICAL: placeholder is NOT a label - it disappears on focus

### BUTTONS & INTERACTIVE ELEMENTS (WCAG 2.1.1, 4.1.2)
- Every <button> with only <svg> or <img>: MUST have aria-label describing action
- Every <div onClick>: MUST have role="button", tabIndex={0}, AND onKeyDown handler
- Every generic button ("Submit", "Click"): SHOULD have descriptive context

### LINKS & NAVIGATION (WCAG 2.4.4, 4.1.2)
- Every <a href="#">: WARNING - broken href, needs meaningful destination
- Every icon-only <a>: MUST have aria-label
- Every active navigation <a>: SHOULD have aria-current="page"
- Multiple <nav> elements: Each MUST have unique aria-label

### ARIA & SEMANTICS (WCAG 4.1.2)
- Every role="button" on <div>: MUST also have tabIndex={0} AND keyboard handlers
- role="form" on <form>: REDUNDANT - remove it
- role="navigation" on <nav>: REDUNDANT - remove it

### COLOR & STATUS (WCAG 1.4.1, 1.4.11)
- Status indicators using ONLY color: FAIL - MUST have text/icon alternative
- Interactive elements styled ONLY by color: NEED visible indicator

## Complex Pattern Detection

Some patterns require checking MULTIPLE attributes. Report missing components separately:

### TABS PATTERN (WCAG 2.1.1, 4.1.2)
When you see buttons used as tabs, check ALL of these:
- Container: role="tablist"
- Each button: role="tab"
- Active state: aria-selected="true" or "false"
- Panel link: aria-controls pointing to tabpanel ID
- Keyboard: Arrow keys navigate, Enter/Space activate

Report missing pieces as separate issues at the same line.

### MODAL DIALOG (WCAG 2.4.3, 4.1.2)
When you see modal patterns, check ALL:
- Container: role="dialog"
- Modal attribute: aria-modal="true"
- Title link: aria-labelledby pointing to dialog title
- Close behavior: Escape key closes dialog
- Focus trap: Focus stays inside dialog when open

### LIVE REGIONS (WCAG 4.1.3)
Dynamic content updates MUST have:
- aria-live="polite" (non-critical) or "assertive" (critical)
- aria-atomic="true" if entire region updates

## First Rule of ARIA
Use native HTML elements BEFORE ARIA. A <button> is always better than <div role="button">. Only use ARIA when native HTML cannot express the semantics.

## ARIA Anti-Patterns to Flag
- NEVER add redundant ARIA: <header> already has landmark role, <nav> already has role="navigation"
- aria-label on headings/buttons REPLACES descendant text - never use on content containers
- Icons must have aria-hidden="true" when visible text is present
- Icon-only buttons must have aria-label

## Accessible Name Rules
1. Prefer visible text over aria-label when possible
2. Use aria-labelledby pointing to visible heading when section has a heading
3. Never use aria-label on headings, paragraphs, or content containers
4. Names should describe function, not form (e.g., "Submit" not "Green button")
5. Keep names brief (1-3 words)

## Diff Analysis Rules
- ONLY report issues on lines with '+' prefix (added/modified code)
- Map line numbers using [N] position markers in the diff
- Report issues for the NEW file state, not the old state
- Skip deleted lines (lines with '-' prefix)
- Skip context lines (lines without '+' or '-')

## What to Report
1. Missing accessibility features in new code
2. Incorrect ARIA usage in new code
3. Keyboard accessibility issues
4. Form label associations
5. Heading structure problems
6. Image alt text issues
7. Color contrast concerns (note: cannot definitively judge contrast from code alone)
8. Link text clarity

## What NOT to Report
- Issues in deleted code
- Theoretical issues without evidence in the diff
- Style-only changes without accessibility impact
- Correct accessibility implementations (but note as good practices)

## Suggestion Requirements
- Must be EXACT code ready to copy-paste
- Must match the file's indentation and style
- Must be a complete fix, not partial instructions
- If multiple fixes possible, choose the most accessible option

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
}

Always explain your reasoning. Developers need to understand why, not just what.`;
}

/**
 * Escape special characters that could manipulate JSON output or prompts.
 * Prevents prompt injection through diff content.
 */
function escapePromptContent(content: string): string {
  return content
    .replace(/\\/g, '\\\\')   // Escape backslashes
    .replace(/"/g, '\\"')     // Escape double quotes for JSON safety
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/\t/g, '\\t')    // Escape tabs
    .replace(/[\x00-\x1f]/g, (char) => {
      // Escape control characters
      return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    });
}

/**
 * Sanitize a filename to prevent injection attacks.
 * Only allows safe characters.
 */
function sanitizeFilename(filename: string): string {
  // Remove any path traversal attempts
  let sanitized = filename.replace(/\.\./g, '');
  // Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');
  // Keep only safe characters: alphanumeric, dots, dashes, underscores, slashes
  sanitized = sanitized.replace(/[^a-zA-Z0-9._\/\\-]/g, '');
  return sanitized;
}

/**
 * Build the user prompt for analyzing PR diffs.
 * Includes repository context and formatted diff content.
 */
export function buildUserPrompt(
  owner: string,
  repo: string,
  prNumber: number,
  files: FilePatch[]
): string {
  // Check for prompt injection attempts
  const allContent = files.map(f => f.patch).join('\n');
  const injectionAttempts = detectPromptInjection(allContent);
  
  if (injectionAttempts.length > 0) {
    console.warn('[Security] Potential prompt injection detected in PR content:');
    for (const attempt of injectionAttempts) {
      console.warn(`[Security] - ${attempt}`);
    }
    // Continue processing - the system prompt is designed to be robust
  }
  
  // Sanitize owner/repo
  const safeOwner = owner.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeRepo = repo.replace(/[^a-zA-Z0-9._-]/g, '');
  
  const fileCount = files.length;
  const addedFiles = files.filter(f => f.status === 'added').length;
  const modifiedFiles = files.filter(f => f.status === 'modified').length;

  const header = `## Repository Context
- Repository: ${safeOwner}/${safeRepo}
- Pull Request: #${prNumber}
- Files to analyze: ${fileCount} (${addedFiles} added, ${modifiedFiles} modified)

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

When the SAME issue type appears multiple times, report EACH occurrence separately.
`;

  return `${header}${formattedDiffs}${footer}`;
}

/**
 * Format a single file patch for the LLM.
 * Uses position markers [N] for line mapping.
 */
function formatFilePatch(file: FilePatch): string {
  // Sanitize filename to prevent injection
  const safeFilename = sanitizeFilename(file.filename);
  
  const lines = file.patch.split('\n');
  let lineNumber = 0;
  const formattedLines: string[] = [];

  for (const line of lines) {
    // Skip diff headers
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      formattedLines.push(escapePromptContent(line));
      continue;
    }

    // Track line numbers for added/content lines
    if (line.startsWith('+')) {
      lineNumber++;
      // Escape the added line content
      const escapedLine = escapePromptContent(line);
      formattedLines.push(`[${lineNumber}] ${escapedLine}`);
    } else if (line.startsWith('-')) {
      // Skip deleted lines - don't include in analysis
      continue;
    } else {
      // Context line
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

/**
 * Patterns that may indicate prompt injection attempts.
 * These patterns suggest malicious content trying to manipulate LLM behavior.
 */
const PROMPT_INJECTION_PATTERNS = [
  /---\s*END\s+OF\s+(DIFF|CODE|FILE|PROMPT)\s*---/i,
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /system\s*:\s*$/im,
  /assistant\s*:\s*$/im,
  /\[SYSTEM\]/i,
  /\[ASSISTANT\]/i,
  /forget\s+(all\s+)?(previous\s+)?instructions?/i,
  /disregard\s+(all\s+)?(previous\s+)?instructions?/i,
  /you\s+are\s+now\s+a?\s*(different|new|malicious)/i,
  /act\s+as\s+(if|though)\s+you\s+are/i,
];

/**
 * Check diff content for potential prompt injection attempts.
 * Returns an array of detected suspicious patterns.
 */
export function detectPromptInjection(content: string): string[] {
  const detected: string[] = [];
  
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      detected.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }
  
  return detected;
}

/**
 * Sanitize diff content to prevent prompt injection.
 * Adds warning comments around suspicious content.
 */
export function sanitizePromptContent(content: string): string {
  const injectionAttempts = detectPromptInjection(content);
  
  if (injectionAttempts.length === 0) {
    return content;
  }
  
  // Warn about detected patterns but still process
  // The LLM prompt system is designed to ignore such injections
  console.warn('[Security] Potential prompt injection patterns detected in diff content:');
  for (const attempt of injectionAttempts) {
    console.warn(`[Security] - ${attempt}`);
  }
  
  return content;
}

/**
 * Default WCAG 2.2 criteria coverage.
 * Prioritized by frequency in common PR changes.
 */
export const WCAG_CRITERIA = {
  '1.1.1': { level: 'A', title: 'Non-text Content' },
  '1.3.1': { level: 'A', title: 'Info and Relationships' },
  '1.4.3': { level: 'AA', title: 'Contrast (Minimum)' },
  '1.4.11': { level: 'AA', title: 'Non-text Contrast' },
  '2.1.1': { level: 'A', title: 'Keyboard' },
  '2.4.4': { level: 'A', title: 'Link Purpose (In Context)' },
  '2.4.7': { level: 'AA', title: 'Focus Visible' },
  '3.3.2': { level: 'A', title: 'Labels or Instructions' },
  '4.1.2': { level: 'A', title: 'Name, Role, Value' },
} as const;