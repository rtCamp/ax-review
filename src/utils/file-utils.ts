/**
 * File utilities for accessibility analysis.
 * 
 * Provides functions for:
 * - File type detection
 * - Extension parsing
 * - Web file filtering
 * - Skip pattern matching
 * 
 * @module utils/file-utils
 * 
 * @example
 * import { isWebFile, shouldSkipFile, filterWebFiles } from './utils/file-utils';
 * 
 * const filesToAnalyze = filterWebFiles(allFiles.filter(f => !shouldSkipFile(f)));
 */

import type { FilePatch } from '../types';

/**
 * Extensions for files that ALWAYS contain user-facing markup.
 * These are analyzed without content checking.
 */
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

/**
 * Extensions for files that MIGHT contain user-facing markup.
 * These require content inspection before analysis.
 */
export const AMBIGUOUS_EXTENSIONS = [
  // JavaScript/TypeScript (may contain JSX)
  'js', 'ts', 'mjs', 'cjs',
  // Python (Django/Frappe templates)
  'py',
  // Ruby (Rails templates in .rb files)
  'rb',
  // Java (JSP-like patterns)
  'java',
] as const;

/**
 * A Set for O(1) lookup of direct markup extensions.
 */
const DIRECT_MARKUP_EXTENSIONS_SET = new Set(DIRECT_MARKUP_EXTENSIONS);

/**
 * A Set for O(1) lookup of ambiguous extensions.
 */
const AMBIGUOUS_EXTENSIONS_SET = new Set(AMBIGUOUS_EXTENSIONS);

/**
 * Legacy constant for backward compatibility.
 * @deprecated Use DIRECT_MARKUP_EXTENSIONS instead
 */
export const WEB_EXTENSIONS = DIRECT_MARKUP_EXTENSIONS;

/**
 * Patterns for files that should ALWAYS be skipped.
 * These contain no user-facing markup regardless of extension.
 */
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
  /test\.(js|ts|jsx|tsx|py|rb)$/,
  /spec\.(js|ts|jsx|tsx|py|rb)$/,
  // Config files
  /\.env(\.|$)/,
  /tsconfig/,
  /\.config\.(js|ts|json|mjs|cjs)$/,
  /config\.(js|ts|json)$/,
  /babel\.config\.(js|ts|json)$/,
  /webpack\.config\.(js|ts)$/,
  /vite\.config\.(js|ts)$/,
  /rollup\.config\.(js|ts)$/,
  /jest\.config\.(js|ts)$/,
  /vitest\.config\.(js|ts)$/,
  /eslint/i,
  /prettier/i,
  /playwright\.config\.(js|ts)$/,
  /cypress\.config\.(js|ts)$/,
  // Generated files
  /\.generated\./,
  /__generated__\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /coverage\//,
  // Database migrations
  /migrations?\//,
  // Type definitions only
  /types\//,
  /@types\//,
  // API/backend only (no user-facing markup)
  /api\//,
  /server\//,
  /backend\//,
  // CI/CD
  /\.github$/,
  /\.gitlab-ci\.yml$/,
  /\.travis\.yml$/,
  /Jenkinsfile$/,
  // Documentation infrastructure (not content)
  /docs\/config\//,
] as const;

/**
 * Content patterns that indicate user-facing markup.
 * Used for ambiguous file extensions (js, ts, py, rb, java).
 */
const MARKUP_CONTENT_PATTERNS = [
  /<[A-Z][a-zA-Z]*[\s>]/,              // JSX components: <Button
  /<[a-z][a-z0-9]*[\s>\/>]/i,          // HTML tags: <div, <span
  /className\s*[=:>\{]/i,             // React className
  /class\s*=\s*["'`{]/i,              // HTML class attribute
  /style\s*=\s*[{"]/i,                // Inline styles
  /jsx\s*[=:>\{]/i,                   // JSX pragma/import
  /html\s*[`'"]/,                     // Tagged template literals (htm, lit-html)
  /ReactDOM/i,                        // React DOM render
  /createRoot\s*\(/i,                 // React 18 createRoot
  /@Component\s*\(/i,                 // Angular/Vue decorator
  /template\s*:\s*[<{/"`]/i,          // Vue/Angular inline template
  /render\s*\(\s*\)\s*\{[\s\S]*return\s*\(/i,  // Render methods
  /\{\%\s*.+?\s*\%\}/,                // Template tags (Jinja, Django, Twig)
  /\{\{.+?\}\}/,                      // Mustache/Handlebars interpolation
  /<\?.*?\?>/,                        // PHP tags
  /<%\s*.+?\s*%>/,                    // ERB/EJS tags
  /@php/i,                            // Blade PHP directive
  /@if\s*\(/i,                        // Blade directives
  /v-if|v-for|v-bind|v-on/i,          // Vue directives
  /ng-if|ng-for|ng-bind|ng-click/i,   // Angular directives
  /svelte:head|svelte:window/i,       // Svelte special elements
];

// =============================================================================
// Extension Parsing
// =============================================================================

/**
 * Get file extension from filename.
 * 
 * Handles compound extensions like `.blade.php`.
 * 
 * @param filename - Filename or path
 * @returns Lowercase extension without dot, or empty string
 * 
 * @example
 * getFileExtension('App.tsx'); // 'tsx'
 * getFileExtension('index.blade.php'); // 'php'
 * getFileExtension('README'); // ''
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  const ext = parts[parts.length - 1];
  return ext ? ext.toLowerCase() : '';
}

/**
 * Get the full extension including compound extensions.
 * 
 * @param filename - Filename or path
 * @returns Extension with dot, or empty string
 * 
 * @example
 * getFullExtension('index.blade.php'); // '.blade.php'
 * getFullExtension('App.tsx'); // '.tsx'
 */
export function getFullExtension(filename: string): string {
  const dotIndex = filename.indexOf('.', 1);
  if (dotIndex === -1) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === 0 ? '' : filename.substring(lastDot);
  }
  return filename.substring(dotIndex);
}

// =============================================================================
// File Type Detection
// =============================================================================

/**
 * Check if file is a web-related file (HTML/JSX/Vue/Svelte/etc).
 * 
 * Web files are those that can contain accessibility-impacting markup.
 * This includes template files and style files.
 * 
 * @param filename - Filename to check
 * @returns true if file is a web file
 * 
 * @example
 * isWebFile('src/App.tsx'); // true
 * isWebFile('src/utils/helper.ts'); // false
 * isWebFile('styles/main.css'); // true
 */
export function isWebFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return DIRECT_MARKUP_EXTENSIONS_SET.has(ext as typeof DIRECT_MARKUP_EXTENSIONS[number]);
}

/**
 * Check if file is a TypeScript/JavaScript file.
 * 
 * @param filename - Filename to check
 * @returns true if file is TS/JS
 */
export function isJavaScriptFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx' || ext === 'mjs' || ext === 'cjs';
}

/**
 * Check if file is a style file (CSS/SCSS/etc).
 * 
 * @param filename - Filename to check
 * @returns true if file is a style file
 */
export function isStyleFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less' || ext === 'styl';
}

/**
 * Check if file is a template file.
 * 
 * @param filename - Filename to check
 * @returns true if file is a template file
 */
export function isTemplateFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return [
    'erb', 'ejs', 'hbs', 'mustache', 'pug',
    'php', 'blade.php',
    'cshtml', 'vbhtml',
    'jsp', 'jspx', 'twig', 'liquid',
  ].includes(ext);
}

/**
 * Check if a file might contain user-facing markup.
 * 
 * This is the main entry point for the hybrid filtering approach:
 * 1. Direct markup extensions (html, jsx, vue, etc) → always analyze
 * 2. Ambiguous extensions (js, ts, py, rb) → check content for markup
 * 3. Unknown extensions → check content defensively
 * 
 * @param filename - Filename to check
 * @returns true if file should be analyzed
 * 
 * @example
 * shouldAnalyzeFile('App.tsx'); // true (direct markup)
 * shouldAnalyzeFile('Button.js'); // depends on content
 * shouldAnalyzeFile('utils.ts'); // false if content has no markup
 */
export function isMarkupExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return DIRECT_MARKUP_EXTENSIONS_SET.has(ext as typeof DIRECT_MARKUP_EXTENSIONS[number]);
}

/**
 * Check if a file extension is ambiguous (might contain markup).
 * 
 * @param filename - Filename to check
 * @returns true if extension is ambiguous
 */
export function isAmbiguousExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return AMBIGUOUS_EXTENSIONS_SET.has(ext as typeof AMBIGUOUS_EXTENSIONS[number]);
}

/**
 * Check if file content contains markup patterns.
 * Only checks ADDED lines (lines with '+' prefix).
 * 
 * @param patchContent - Git diff patch content
 * @returns true if content contains markup patterns
 */
export function containsMarkupPatterns(patchContent: string): boolean {
  // Only check ADDED lines (not deleted/context)
  const addedLines = patchContent
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');
  
  // Check against all markup patterns
  return MARKUP_CONTENT_PATTERNS.some(pattern => pattern.test(addedLines));
}

/**
 * Determine if a file should be analyzed for accessibility issues.
 * 
 * This implements the hybrid approach:
 * 1. Skip files matching ALWAYS_SKIP_PATTERNS
 * 2. Check if extension is a direct markup extension → analyze
 * 3. Check if extension is ambiguous → analyze if content has markup
 * 4. Unknown extensions → check content defensively
 * 
 * @param file - FilePatch object with filename and content
 * @returns true if file should be analyzed
 * 
 * @example
 * // Direct markup files - always analyze
 * shouldAnalyzeFile({ filename: 'App.tsx', patch: '...' }); // true
 * shouldAnalyzeFile({ filename: 'index.html', patch: '...' }); // true
 * 
 * // Ambiguous files - check content
 * shouldAnalyzeFile({ filename: 'page.js', patch: '+<Button>Click</Button>' }); // true
 * shouldAnalyzeFile({ filename: 'page.js', patch: '+const x = 42;' }); // false
 * 
 * // Skip patterns - always skip
 * shouldAnalyzeFile({ filename: 'package.json', patch: '...' }); // false
 */
export function shouldAnalyzeFile(file: FilePatch): boolean {
  // Skip if no content
  if (!file.patch || file.patch.trim() === '') {
    return false;
  }
  
  const filename = file.filename;
  const ext = getFileExtension(filename);
  
  // Direct markup files - always analyze
  if (DIRECT_MARKUP_EXTENSIONS_SET.has(ext as typeof DIRECT_MARKUP_EXTENSIONS[number])) {
    return true;
  }
  
  // Ambiguous extensions - check content
  if (AMBIGUOUS_EXTENSIONS_SET.has(ext as typeof AMBIGUOUS_EXTENSIONS[number])) {
    return containsMarkupPatterns(file.patch);
  }
  
  // Unknown extensions - check content defensively
  // This catches edge cases like .md files, custom extensions, etc.
  return containsMarkupPatterns(file.patch);
}

// =============================================================================
// Skip Pattern Matching
// =============================================================================

/**
 * Check if a file should be skipped for analysis.
 * 
 * Skips:
 * - Files without meaningful content (no patch)
 * - Generated files (minified, lock files, snapshots)
 * - Files in node_modules
 * 
 * @param file - File to check
 * @returns true if file should be skipped
 * 
 * @example
 * if (shouldSkipFile(file)) {
 *   console.log(`Skipping ${file.filename}`);
 * }
 */
export function shouldSkipFile(file: FilePatch): boolean {
  // Skip files without meaningful content
  if (!file.patch || file.patch.trim() === '') {
    return true;
  }

  // Skip generated/minified files
  return SKIP_PATTERNS.some(pattern => pattern.test(file.filename));
}

/**
 * Check if a filename matches any skip pattern.
 * 
 * @param filename - Filename to check
 * @returns true if filename matches a skip pattern
 */
export function matchesSkipPattern(filename: string): boolean {
  return SKIP_PATTERNS.some(pattern => pattern.test(filename));
}

// =============================================================================
// File Filtering
// =============================================================================

/**
 * Filter files to only include web-related files.
 * Uses legacy extension-based approach.
 * 
 * @param files - Files to filter
 * @returns Only web files (by extension)
 * 
 * @example
 * const webFiles = filterWebFiles(allFiles);
 * console.log(`Analyzing ${webFiles.length} web files`);
 */
export function filterWebFiles(files: FilePatch[]): FilePatch[] {
  return files.filter(file => isWebFile(file.filename));
}

/**
 * Filter files for accessibility analysis using hybrid approach.
 * 
 * This is the recommended filter function that uses:
 * 1. Blocklist (SKIP_PATTERNS) to exclude non-markup files
 * 2. Direct markup extensions to include markup files
 * 3. Content detection for ambiguous file extensions
 * 
 * @param files - Files to filter (already downloaded)
 * @returns Files that should be analyzed
 * 
 * @example
 * const filesToAnalyze = filterFilesForAnalysis(allFiles);
 * console.log(`Analyzing ${filesToAnalyze.length} files`);
 * 
 * // Works for any project type:
 * // - React: .jsx, .tsx, .js with JSX
 * // - Vue: .vue, .js
 * // - Svelte: .svelte
 * // - WordPress: .php with templates
 * // - Frappe: .py with templates
 * // - Django: .html, .py with templates
 * // - Rails: .erb, .rb with templates
 */
export function filterFilesForAnalysis(files: FilePatch[]): FilePatch[] {
  return files.filter(file => {
    // First, check skip patterns
    if (shouldSkipFile(file)) {
      return false;
    }
    
    // Then, use hybrid approach
    return shouldAnalyzeFile(file);
  });
}

/**
 * Filter files, removing those that should be skipped.
 * 
 * @param files - Files to filter
 * @returns Files that should not be skipped
 */
export function filterSkippedFiles(files: FilePatch[]): FilePatch[] {
  return files.filter(file => !shouldSkipFile(file));
}

/**
 * Filter to non-removed files only.
 * 
 * @param files - Files to filter
 * @returns Files that were not removed
 */
export function filterNonRemovedFiles(files: FilePatch[]): FilePatch[] {
  return files.filter(file => file.status !== 'removed');
}

// =============================================================================
// File Information
// =============================================================================

/**
 * Get filename without path.
 * 
 * @param filepath - Full file path
 * @returns Just the filename
 * 
 * @example
 * getBasename('src/components/Button.tsx'); // 'Button.tsx'
 */
export function getBasename(filepath: string): string {
  const parts = filepath.split('/');
  return parts[parts.length - 1] || filepath;
}

/**
 * Get directory path from full file path.
 * 
 * @param filepath - Full file path
 * @returns Directory path
 * 
 * @example
 * getDirectory('src/components/Button.tsx'); // 'src/components'
 */
export function getDirectory(filepath: string): string {
  const lastSlash = filepath.lastIndexOf('/');
  return lastSlash === -1 ? '' : filepath.substring(0, lastSlash);
}