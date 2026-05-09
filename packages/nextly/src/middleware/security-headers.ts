/**
 * Security Headers Middleware
 *
 * Response transformer that attaches security headers to every API response.
 * Headers are pre-computed at initialization time for zero per-request overhead.
 *
 * All headers are individually configurable or disableable via
 * `defineConfig({ security: { headers: { ... } } })`.
 *
 * @module middleware/security-headers
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // Use with all defaults
 * const applyHeaders = createSecurityHeadersMiddleware();
 * const securedResponse = applyHeaders(response);
 *
 * // Customize specific headers
 * const applyHeaders = createSecurityHeadersMiddleware({
 *   contentSecurityPolicy: "default-src 'self'",
 *   strictTransportSecurity: false, // Disable HSTS
 * });
 * ```
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Configuration for security response headers.
 *
 * Each header can be set to a custom string value or `false` to disable it.
 * Omitted headers use their secure defaults.
 *
 * @example
 * ```typescript
 * const config: SecurityHeadersConfig = {
 *   contentSecurityPolicy: "default-src 'self'",
 *   strictTransportSecurity: false, // Disable HSTS
 * };
 * ```
 */
export interface SecurityHeadersConfig {
  /**
   * Content-Security-Policy header value.
   * Set to `false` to disable.
   *
   * The previous default `default-src 'none'; frame-ancestors 'none'`
   * was a hard "block everything" — fine on a pure
   * JSON response (CSP doesn't enforce on JSON) but instantly broke any
   * HTML response, including the admin SPA. The new default is
   * restrictive but lets a self-hosted Nextly admin UI run end-to-end:
   *
   *   default-src 'self';
   *   script-src 'self';
   *   style-src 'self' 'unsafe-inline';
   *   img-src 'self' data: blob:;
   *   font-src 'self' data:;
   *   connect-src 'self';
   *   frame-ancestors 'none';
   *   base-uri 'self';
   *   form-action 'self';
   *   object-src 'none'
   *
   * To extend (e.g. for a CDN, analytics, or third-party fonts), pass
   * an explicit string here — your value replaces the default entirely.
   * To disable CSP entirely, set to `false`.
   *
   * @default see above
   */
  contentSecurityPolicy?: string | false;

  /**
   * X-Content-Type-Options header value.
   * Set to `false` to disable.
   *
   * @default "nosniff"
   */
  xContentTypeOptions?: string | false;

  /**
   * X-Frame-Options header value.
   * Set to `false` to disable.
   *
   * @default "DENY"
   */
  xFrameOptions?: string | false;

  /**
   * Strict-Transport-Security header value.
   * Only applied when `NODE_ENV === 'production'` unless explicitly set.
   * Set to `false` to disable entirely.
   *
   * @default "max-age=31536000; includeSubDomains"
   */
  strictTransportSecurity?: string | false;

  /**
   * Referrer-Policy header value.
   * Set to `false` to disable.
   *
   * @default "strict-origin-when-cross-origin"
   */
  referrerPolicy?: string | false;

  /**
   * Permissions-Policy header value.
   * Set to `false` to disable.
   *
   * @default "camera=(), microphone=(), geolocation=()"
   */
  permissionsPolicy?: string | false;
}

// ============================================================================
// Defaults
// ============================================================================

/**
 * The default CSP is restrictive but lets a self-
 * hosted Nextly admin SPA run without an override. See the doc on
 * `SecurityHeadersConfig.contentSecurityPolicy` for the rationale and
 * the override path.
 */
const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Default security header values.
 *
 * - CSP allows self-hosted SPA assets and blocks frame embedding /
 *   plugins / cross-origin form posts.
 * - HSTS enforces HTTPS in production.
 * - X-Frame-Options prevents clickjacking (legacy browser fallback).
 * - X-Content-Type-Options prevents MIME sniffing.
 * - Referrer-Policy limits referrer leakage.
 * - Permissions-Policy disables sensitive browser APIs.
 */
const DEFAULT_HEADERS: Record<
  keyof SecurityHeadersConfig,
  { header: string; value: string }
> = {
  contentSecurityPolicy: {
    header: "Content-Security-Policy",
    value: DEFAULT_CSP,
  },
  xContentTypeOptions: {
    header: "X-Content-Type-Options",
    value: "nosniff",
  },
  xFrameOptions: {
    header: "X-Frame-Options",
    value: "DENY",
  },
  strictTransportSecurity: {
    header: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  referrerPolicy: {
    header: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  permissionsPolicy: {
    header: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
};

// ============================================================================
// Header Map Builder
// ============================================================================

/**
 * Pre-computes the header entries from the config.
 *
 * Resolves defaults, applies overrides, and filters out disabled headers.
 * HSTS is only included in production unless explicitly configured.
 *
 * @param config - User-provided header configuration
 * @returns Array of [headerName, headerValue] entries to apply
 */
function buildHeaderMap(
  config?: SecurityHeadersConfig
): Array<[string, string]> {
  const isProduction = process.env.NODE_ENV === "production";
  const entries: Array<[string, string]> = [];

  for (const [key, def] of Object.entries(DEFAULT_HEADERS)) {
    const configKey = key as keyof SecurityHeadersConfig;
    const userValue = config?.[configKey];

    // Header explicitly disabled
    if (userValue === false) {
      continue;
    }

    // HSTS: only apply in production unless explicitly set by the user
    if (configKey === "strictTransportSecurity") {
      if (userValue === undefined && !isProduction) {
        continue;
      }
    }

    // Use user value if provided, otherwise use default
    const value = typeof userValue === "string" ? userValue : def.value;
    entries.push([def.header, value]);
  }

  return entries;
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Creates a security headers response transformer.
 *
 * The returned function takes a `Response` and returns a new `Response`
 * with security headers applied. Headers are pre-computed at creation
 * time for zero per-request config resolution overhead.
 *
 * @param config - Optional header configuration with overrides
 * @returns A function that transforms responses by adding security headers
 *
 * @example
 * ```typescript
 * // Default configuration
 * const applyHeaders = createSecurityHeadersMiddleware();
 *
 * // In route handler pipeline:
 * const response = await handler(request);
 * return applyHeaders(response);
 * ```
 *
 * @example
 * ```typescript
 * // Custom configuration
 * const applyHeaders = createSecurityHeadersMiddleware({
 *   contentSecurityPolicy: "default-src 'self'",
 *   strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
 *   permissionsPolicy: false, // Disable Permissions-Policy
 * });
 * ```
 */
export function createSecurityHeadersMiddleware(
  config?: SecurityHeadersConfig
): (response: Response) => Response {
  const headerEntries = buildHeaderMap(config);

  // No headers to apply — return identity function
  if (headerEntries.length === 0) {
    return (response: Response) => response;
  }

  return function applySecurityHeaders(response: Response): Response {
    const newHeaders = new Headers(response.headers);

    for (const [name, value] of headerEntries) {
      newHeaders.set(name, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}
