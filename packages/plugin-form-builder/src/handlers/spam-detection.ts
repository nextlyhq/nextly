/**
 * Spam Detection
 *
 * Honeypot and rate limiting for form submissions.
 *
 * The honeypot is a pure read of the submitted payload. The rate limit is not:
 * it counts, and where the count lives decides whether the limit means
 * anything. It lives in the deployment's own {@link RateLimitStore}, the one
 * the REST and auth limiters already share, so `rateLimit.store` is configured
 * once and all three agree about what they are counting. A store private to
 * this module would count per process, and on a deployment that spans several
 * the effective limit becomes `configured x instances` -- a number the operator
 * never chose, that fails open, and only under load.
 *
 * @module handlers/spam-detection
 * @since 0.1.0
 */

import { RateLimiter, resolveRateLimitStore } from "nextly";

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
    const rateLimitResult = await checkRateLimit(
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
 * Whether this address has submitted this form too often, recording the attempt.
 *
 * Keyed by form and address together, so a burst against one form does not
 * lock a visitor out of another. The window lives in the deployment's shared
 * store, so two processes serving the same visitor count once.
 *
 * An address of `unknown` is not a bucket to key on: every client whose address
 * could not be resolved would share one window, and the first bot to fill it
 * would lock out every visitor behind an untrusted proxy. The caller decides
 * what to do about an unidentifiable client; this counts only identified ones.
 */
async function checkRateLimit(
  ipAddress: string,
  formSlug: string,
  config: { maxSubmissions: number; windowMs: number }
): Promise<SpamCheckResult> {
  const limiter = new RateLimiter(resolveRateLimitStore());
  const result = await limiter.check(
    `form-submit:${formSlug}:${ipAddress}`,
    config.maxSubmissions,
    config.windowMs
  );
  if (result.allowed) return { isSpam: false };
  return {
    isSpam: true,
    reason: "rate_limit",
    details: `Rate limit exceeded: ${config.maxSubmissions} per ${config.windowMs}ms`,
  };
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
