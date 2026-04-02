/**
 * Input validation and security utilities.
 * 
 * Provides validation functions for:
 * - API keys
 * - URLs (with SSRF protection)
 * - Model names (injection protection)
 * 
 * @module utils/validation
 * 
 * @example
 * import { validateUrl, validateModelName } from './utils/validation';
 * 
 * const safeUrl = validateUrl(userProvidedUrl);
 * const safeModel = validateModelName(userProvidedModel);
 */

/**
 * Maximum lengths for input validation.
 */
export const MAX_LENGTHS = {
  model: 100,
  apiKey: 500,
  url: 2048,
  filename: 255,
} as const;

/**
 * Validates a URL to prevent SSRF attacks.
 * 
 * **Security measures:**
 * - Only allows HTTP/HTTPS schemes
 * - Blocks private IP addresses (10.x, 172.16-31.x, 192.168.x)
 * - Allows localhost for local development
 * - Validates URL format
 * 
 * @param url - URL to validate
 * @returns Sanitized URL
 * @throws Error if URL is invalid or potentially malicious
 * 
 * @example
 * // Valid URLs
 * validateUrl('http://localhost:11434'); // OK - localhost allowed
 * validateUrl('https://api.example.com'); // OK - public URL
 * 
 * // Invalid URLs
 * validateUrl('file:///etc/passwd'); // Error - bad scheme
 * validateUrl('http://192.168.1.1'); // Error - private IP
 */
export function validateUrl(url: string): string {
  const sanitized = url.trim();
  
  // Length check
  if (sanitized.length > MAX_LENGTHS.url) {
    throw new Error(`URL exceeds maximum length of ${MAX_LENGTHS.url} characters`);
  }
  
  // Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sanitized);
  } catch {
    throw new Error(`Invalid URL: '${sanitized}' is not a valid URL`);
  }
  
  // Only allow http and https schemes
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `Invalid URL scheme: '${parsedUrl.protocol}'. Only http: and https: are allowed.`
    );
  }
  
  // Block internal IP addresses
  const hostname = parsedUrl.hostname.toLowerCase();
  
  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
    // Explicitly allowed for local development
    return sanitized;
  }
  
  // Block private IP ranges
  if (isPrivateIpAddress(hostname)) {
    throw new Error(
      `URL hostname '${hostname}' resolves to a private/internal IP address. ` +
      `Access to internal networks is not allowed for security reasons.`
    );
  }
  
  return sanitized;
}

/**
 * Checks if a hostname is a private/internal IP address.
 * 
 * Blocks these ranges:
 * - 10.0.0.0/8 (Class A private)
 * - 172.16.0.0/12 (Class B private)
 * - 192.168.0.0/16 (Class C private)
 * - 169.254.0.0/16 (Link-local)
 * - fc00::/7 (IPv6 private)
 * - fe80::/10 (IPv6 link-local)
 * 
 * @param hostname - Hostname to check
 * @returns true if hostname is a private IP
 */
export function isPrivateIpAddress(hostname: string): boolean {
  const ipV4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipV4Pattern);
  
  if (match) {
    const o1 = parseInt(match[1]!, 10);
    const o2 = parseInt(match[2]!, 10);
    const o3 = parseInt(match[3]!, 10);
    const o4 = parseInt(match[4]!, 10);
    
    // Invalid IP if any octet > 255
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) {
      return false;
    }
    
    // 10.0.0.0/8 - Class A private
    if (o1 === 10) {
      return true;
    }
    
    // 172.16.0.0/12 - Class B private
    if (o1 === 172 && o2 >= 16 && o2 <= 31) {
      return true;
    }
    
    // 192.168.0.0/16 - Class C private
    if (o1 === 192 && o2 === 168) {
      return true;
    }
    
    // 169.254.0.0/16 - Link-local
    if (o1 === 169 && o2 === 254) {
      return true;
    }
  }
  
  // IPv6 private ranges (simplified check)
  if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80::')) {
    return true;
  }
  
  return false;
}

/**
 * Validates an API key.
 * 
 * **Validation rules:**
 * - Optional (empty string is valid)
 * - Maximum length: 500 characters
 * - No control characters (0x00-0x1F, 0x7F)
 * - Trimmed of whitespace
 * 
 * @param apiKey - API key to validate
 * @param minRequiredLength - Minimum length if key is provided (default: 20)
 * @returns Sanitized API key or empty string
 * @throws Error if API key is invalid
 */
export function validateApiKey(apiKey: string, minRequiredLength = 20): string {
  if (!apiKey) return '';
  
  // Length check
  if (apiKey.length > MAX_LENGTHS.apiKey) {
    throw new Error(`API key exceeds maximum length of ${MAX_LENGTHS.apiKey} characters`);
  }
  
  // Remove any whitespace
  const sanitized = apiKey.trim();
  
  // If key is provided, check it's valid
  if (sanitized && sanitized.length < minRequiredLength) {
    throw new Error(
      `API key appears to be invalid. Expected at least ${minRequiredLength} characters, ` +
      `got ${sanitized.length}.`
    );
  }
  
  // Check for control characters
  if (/[\x00-\x1F\x7F]/.test(sanitized)) {
    throw new Error('API key contains invalid control characters');
  }
  
  return sanitized;
}

/**
 * Validates a model name to prevent injection attacks.
 * 
 * **Validation rules:**
 * - Only allows: a-z, A-Z, 0-9, ., _, -, :
 * - Maximum length: 100 characters
 * - Trimmed of whitespace
 * 
 * @param model - Model name to validate
 * @returns Sanitized model name or empty string
 * @throws Error if model name is invalid
 * 
 * @example
 * validateModelName('gemini-2.0-flash'); // OK
 * validateModelName('llama3.2:latest'); // OK
 * validateModelName('../../etc/passwd'); // Error - path traversal
 */
export function validateModelName(model: string): string {
  if (!model) return '';
  
  const sanitized = model.trim();
  
  if (sanitized.length > MAX_LENGTHS.model) {
    throw new Error(`Model name exceeds maximum length of ${MAX_LENGTHS.model} characters`);
  }
  
  if (!/^[a-zA-Z0-9._:-]+$/.test(sanitized)) {
    throw new Error(
      `Invalid model name: '${sanitized}'. ` +
      `Only alphanumeric characters, dots, dashes, underscores, and colons are allowed.`
    );
  }
  
  return sanitized;
}