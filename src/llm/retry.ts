import { LLMError } from './types';

/**
 * Determine if a non-2xx HTTP status code is worth retrying.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Determine if an error thrown during the request is retryable.
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof LLMError) {
    return error.isRetryable;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('quota') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    error.name === 'AbortError'
  );
}
