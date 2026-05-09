/**
 * Spam Detection
 *
 * Implements honeypot and rate limiting spam protection for form submissions.
 * Provides a pluggable approach to spam detection that can be extended.
 *
 * @module handlers/spam-detection
 * @since 0.1.0
 */

// ============================================================
// Types
// ============================================================

/**
 * Configuration for spam detection.
 */
export interface SpamCheckConfig {
  /**
   * Enable honeypot field detection.
   * When enabled, submissions with filled honeypot fields are marked as spam.
   */
  honeypot?: boolean;

  /**
   * Rate limiting configuration.
   */
  rateLimit?: {
    /** Maximum submissions allowed per window */
    maxSubmissions: number;
    /** Time window in milliseconds */
    windowMs: number;
  };

  /**
   * reCAPTCHA configuration (for future implementation).
   */
  recaptcha?: {
    enabled: boolean;
    secretKey?: string;
    scoreThreshold?: number;
  };
}

/**
 * Options for spam check.
 */
export interface SpamCheckOptions {
  /** Form submission data */
  data: Record<string, unknown>;

  /** Submitter's IP address */
  ipAddress?: string;

  /** Form slug for rate limiting key */
  formSlug: string;

  /** Spam protection configuration */
  config: SpamCheckConfig;
}

/**
 * Result of spam check.
 */
export interface SpamCheckResult {
  /** Whether the submission is detected as spam */
  isSpam: boolean;

  /** Reason for spam detection (for logging, not exposed to user) */
  reason?: "honeypot" | "rate_limit" | "recaptcha";

  /** Additional details (for logging) */
  details?: string;
}

// ============================================================
// Rate Limit Store
// ============================================================

/**
 * In-memory rate limit store.
 *
 * Note: For multi-instance deployments (serverless, load-balanced),
 * consider using Redis or a database-backed store instead.
 * This in-memory implementation works well for single-instance deployments.
 */
interface RateLimitEntry {
  count: number;
  timestamp: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// ============================================================
// Main Spam Check Function
// ============================================================

/**
 * Check a form submission for spam indicators.
 *
 * Performs multiple spam checks based on configuration:
 * 1. Honeypot field detection
 * 2. Rate limiting by IP/form
 * 3. reCAPTCHA verification (future)
 *
 * @param options - Spam check options
 * @returns Spam check result
 *
 * @example
 * ```typescript
 * const result = await checkSpam({
 *   data: formData,
 *   ipAddress: req.ip,
 *   formSlug: 'contact-form',
 *   config: {
 *     honeypot: true,
 *     rateLimit: { maxSubmissions: 5, windowMs: 60000 },
 *   },
 * });
 *
 * if (result.isSpam) {
 *   // Silently reject (return fake success to bot)
 *   return { success: true };
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/require-await -- public API: declared return type is `Promise<SpamCheckResult>` and callers `await` it; removing `async` would force a return-type change
export async function checkSpam(
  options: SpamCheckOptions
): Promise<SpamCheckResult> {
  const { data, ipAddress, formSlug, config } = options;

  // 1. Honeypot check
  if (config.honeypot) {
    const honeypotResult = checkHoneypot(data);
    if (honeypotResult.isSpam) {
      return honeypotResult;
    }
  }

  // 2. Rate limiting check
  if (config.rateLimit && ipAddress) {
    const rateLimitResult = checkRateLimit(
      ipAddress,
      formSlug,
      config.rateLimit
    );
    if (rateLimitResult.isSpam) {
      return rateLimitResult;
    }
  }

  return { isSpam: false };
}

// ============================================================
// Honeypot Detection
// ============================================================

/**
 * Standard honeypot field names to check.
 * These fields should be hidden from users but filled by bots.
 */
const HONEYPOT_FIELDS = [
  "__honeypot",
  "_honeypot",
  "honeypot",
  "__hp",
  "_hp",
  "website", // Common honeypot field name
  "url_field", // Another common honeypot
  "fax_number", // Rarely used by humans
];

/**
 * Check for honeypot field presence.
 *
 * Honeypot fields are hidden form fields that legitimate users
 * won't see or fill, but bots often fill automatically.
 *
 * @param data - Form submission data
 * @returns Spam check result
 */
function checkHoneypot(data: Record<string, unknown>): SpamCheckResult {
  for (const fieldName of HONEYPOT_FIELDS) {
    const value = data[fieldName];

    // Check if honeypot field has a non-empty value
    if (value !== undefined && value !== null && value !== "") {
      let raw: string;
      if (typeof value === "object") {
        raw = JSON.stringify(value);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value narrowed to primitive above; rule doesn't follow control flow on unknown
        raw = String(value);
      }
      const stringValue = raw.trim();
      if (stringValue.length > 0) {
        return {
          isSpam: true,
          reason: "honeypot",
          details: `Honeypot field "${fieldName}" was filled`,
        };
      }
    }
  }

  return { isSpam: false };
}

// ============================================================
// Rate Limiting
// ============================================================

/**
 * Check rate limit for a given IP and form combination.
 *
 * Uses a sliding window approach where submissions are counted
 * within a time window. If the count exceeds the maximum,
 * further submissions are blocked.
 *
 * @param ipAddress - Submitter's IP address
 * @param formSlug - Form identifier
 * @param config - Rate limit configuration
 * @returns Spam check result
 */
function checkRateLimit(
  ipAddress: string,
  formSlug: string,
  config: { maxSubmissions: number; windowMs: number }
): SpamCheckResult {
  const key = `${formSlug}:${ipAddress}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (entry) {
    // Check if window has expired
    if (now - entry.timestamp > config.windowMs) {
      // Reset counter for new window
      rateLimitStore.set(key, { count: 1, timestamp: now });
      return { isSpam: false };
    }

    // Check if limit exceeded
    if (entry.count >= config.maxSubmissions) {
      return {
        isSpam: true,
        reason: "rate_limit",
        details: `Rate limit exceeded: ${entry.count}/${config.maxSubmissions} in ${config.windowMs}ms`,
      };
    }

    // Increment counter
    rateLimitStore.set(key, {
      count: entry.count + 1,
      timestamp: entry.timestamp,
    });
  } else {
    // First submission from this IP/form
    rateLimitStore.set(key, { count: 1, timestamp: now });
  }

  return { isSpam: false };
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Clean up expired rate limit entries.
 *
 * Call this periodically (e.g., every 5 minutes) to prevent
 * memory leaks from accumulated rate limit entries.
 *
 * @param maxAgeMs - Maximum age of entries to keep (default: 5 minutes)
 * @returns Number of entries removed
 *
 * @example
 * ```typescript
 * // Set up periodic cleanup
 * setInterval(() => {
 *   const removed = cleanupRateLimitStore();
 *   console.log(`Cleaned up ${removed} expired rate limit entries`);
 * }, 5 * 60 * 1000); // Every 5 minutes
 * ```
 */
export function cleanupRateLimitStore(
  maxAgeMs: number = 5 * 60 * 1000
): number {
  const now = Date.now();
  let removed = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.timestamp > maxAgeMs) {
      rateLimitStore.delete(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Get the current size of the rate limit store.
 *
 * Useful for monitoring and debugging.
 *
 * @returns Number of entries in the store
 */
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

/**
 * Clear all rate limit entries.
 *
 * Useful for testing or resetting state.
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Check if a specific IP/form is currently rate limited.
 *
 * @param ipAddress - IP address to check
 * @param formSlug - Form slug
 * @param config - Rate limit configuration
 * @returns Whether the IP is currently rate limited
 */
export function isRateLimited(
  ipAddress: string,
  formSlug: string,
  config: { maxSubmissions: number; windowMs: number }
): boolean {
  const key = `${formSlug}:${ipAddress}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry) {
    return false;
  }

  // Check if window has expired
  if (now - entry.timestamp > config.windowMs) {
    return false;
  }

  return entry.count >= config.maxSubmissions;
}

// ============================================================
// reCAPTCHA Support (Future Implementation)
// ============================================================

/**
 * Verify reCAPTCHA v3 token.
 *
 * Note: This is a placeholder for future implementation.
 * reCAPTCHA verification requires server-side API calls to Google.
 *
 * @param data - Form data containing reCAPTCHA token
 * @param config - reCAPTCHA configuration
 * @returns Spam check result
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- declared return type is `Promise<SpamCheckResult>`; placeholder for unimplemented Google siteverify fetch
async function verifyRecaptcha(
  _data: Record<string, unknown>,
  _config: { secretKey?: string; scoreThreshold?: number }
): Promise<SpamCheckResult> {
  // Placeholder - always pass for now
  return { isSpam: false };
}
