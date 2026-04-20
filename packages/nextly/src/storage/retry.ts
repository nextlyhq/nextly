/**
 * Retry Utility for Storage Operations
 *
 * Provides exponential backoff retry logic for transient failures.
 * Used by storage adapters for upload, delete, and other operations.
 *
 * Features:
 * - Exponential backoff with jitter
 * - Configurable max attempts
 * - Custom retry condition
 * - Timeout support
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => storage.upload(buffer, options),
 *   {
 *     maxAttempts: 3,
 *     baseDelayMs: 1000,
 *     shouldRetry: (error) => isTransientError(error),
 *   }
 * );
 * ```
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number;
  /** Add random jitter to delay (default: true) */
  jitter?: boolean;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback called before each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "shouldRetry" | "onRetry">> =
  {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitter: true,
  };

/**
 * Check if an error is a transient error that should be retried.
 *
 * Transient errors include:
 * - Network timeouts
 * - Connection resets
 * - Rate limiting (429)
 * - Server errors (5xx)
 * - DNS resolution failures
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  // Check for Error objects
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network errors
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("etimedout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("enetunreach") ||
      message.includes("socket hang up") ||
      message.includes("network") ||
      name.includes("timeout") ||
      name.includes("abort")
    ) {
      return true;
    }

    // Rate limiting
    if (message.includes("rate limit") || message.includes("too many")) {
      return true;
    }
  }

  // Check for HTTP-like errors with status codes
  const errorAny = error as Record<string, unknown>;
  const metadata = errorAny.$metadata as Record<string, unknown> | undefined;
  if (errorAny.statusCode || errorAny.status || metadata?.httpStatusCode) {
    const status =
      errorAny.statusCode || errorAny.status || metadata?.httpStatusCode;

    // Retry on 429 (rate limited) and 5xx (server errors)
    const statusNum = typeof status === "number" ? status : Number(status);
    if (statusNum === 429 || (statusNum >= 500 && statusNum < 600)) {
      return true;
    }
  }

  // AWS SDK errors
  if (errorAny.code) {
    const code = String(errorAny.code).toLowerCase();
    if (
      code.includes("timeout") ||
      code.includes("throttl") ||
      code.includes("serviceunavailable") ||
      code.includes("slowdown") ||
      code === "econnreset" ||
      code === "epipe"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 *
 * Formula: min(maxDelay, baseDelay * (backoffFactor ^ attempt)) + jitter
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "shouldRetry" | "onRetry">>
): number {
  const { baseDelayMs, maxDelayMs, backoffFactor, jitter } = options;

  // Exponential backoff: baseDelay * (factor ^ attempt)
  const exponentialDelay = baseDelayMs * Math.pow(backoffFactor, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (0-50% of delay) to prevent thundering herd
  if (jitter) {
    const jitterAmount = cappedDelay * Math.random() * 0.5;
    return Math.floor(cappedDelay + jitterAmount);
  }

  return Math.floor(cappedDelay);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic.
 *
 * Uses exponential backoff with jitter to handle transient failures.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withRetry(() => uploadFile(buffer));
 *
 * // With custom options
 * const result = await withRetry(
 *   () => uploadFile(buffer),
 *   {
 *     maxAttempts: 5,
 *     baseDelayMs: 500,
 *     onRetry: (err, attempt) => console.log(`Retry ${attempt}:`, err.message),
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const { maxAttempts, shouldRetry, onRetry } = {
    ...config,
    shouldRetry: options.shouldRetry ?? isTransientError,
    onRetry: options.onRetry,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt >= maxAttempts;
      const canRetry = !isLastAttempt && shouldRetry(error, attempt);

      if (!canRetry) {
        throw error;
      }

      // Calculate delay with backoff
      const delayMs = calculateDelay(attempt, config);

      // Call retry callback if provided
      if (onRetry) {
        onRetry(error, attempt, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of an async function.
 *
 * Useful for wrapping multiple functions with the same retry config.
 *
 * @example
 * ```typescript
 * const retryableUpload = createRetryable(
 *   (buffer: Buffer, opts: UploadOptions) => storage.upload(buffer, opts),
 *   { maxAttempts: 3 }
 * );
 *
 * await retryableUpload(buffer, { filename: 'test.jpg', mimeType: 'image/jpeg' });
 * ```
 */
export function createRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}
