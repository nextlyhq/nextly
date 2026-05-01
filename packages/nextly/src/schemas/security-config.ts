/**
 * Security Configuration Zod Schema
 *
 * Validates the `security` block in `defineConfig()`. Covers four sub-sections:
 * - `headers` — Security response headers (CSP, HSTS, X-Frame-Options, etc.)
 * - `cors` — Cross-Origin Resource Sharing configuration
 * - `uploads` — File upload MIME type restrictions
 * - `sanitization` — Input sanitization toggles
 *
 * All fields are optional with secure defaults applied at config resolution time.
 *
 * @module schemas/security-config
 * @since 1.0.0
 */

import { z } from "zod";

/**
 * Validates the `security.headers` block.
 *
 * Each header accepts a custom string value or `false` to disable it.
 * Omitted headers use their secure defaults (see `security-headers.ts`).
 */
export const SecurityHeadersConfigSchema = z.object({
  /** @default "default-src 'none'; frame-ancestors 'none'" */
  contentSecurityPolicy: z.union([z.string(), z.literal(false)]).optional(),
  /** @default "nosniff" */
  xContentTypeOptions: z.union([z.string(), z.literal(false)]).optional(),
  /** @default "DENY" */
  xFrameOptions: z.union([z.string(), z.literal(false)]).optional(),
  /** @default "max-age=31536000; includeSubDomains" (production only) */
  strictTransportSecurity: z.union([z.string(), z.literal(false)]).optional(),
  /** @default "strict-origin-when-cross-origin" */
  referrerPolicy: z.union([z.string(), z.literal(false)]).optional(),
  /** @default "camera=(), microphone=(), geolocation=()" */
  permissionsPolicy: z.union([z.string(), z.literal(false)]).optional(),
});

/**
 * Validates the `security.cors` block.
 *
 * Controls Cross-Origin Resource Sharing behaviour for all API responses.
 * Default: same-origin only (empty `origin` array).
 */
export const CorsConfigSchema = z.object({
  /**
   * Allowed origins. Empty array = same-origin only.
   * Use `['*']` for wide-open access (development only).
   * @default []
   */
  origin: z.array(z.string()).optional(),
  /**
   * Allowed HTTP methods.
   * @default ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
   */
  methods: z.array(z.string()).optional(),
  /**
   * Headers the client is allowed to send.
   * @default ["Content-Type", "Authorization"]
   */
  allowedHeaders: z.array(z.string()).optional(),
  /**
   * Headers exposed to the client in the response.
   * @default ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
   */
  exposedHeaders: z.array(z.string()).optional(),
  /**
   * Whether to include credentials (cookies, Authorization header).
   * Ignored when origin is `['*']` (CORS spec prohibits credentials with wildcard).
   * @default true
   */
  credentials: z.boolean().optional(),
  /**
   * Preflight cache duration in seconds.
   * @default 86400 (24 hours)
   */
  maxAge: z.number().int().nonnegative().optional(),
});

/**
 * Validates the `security.uploads` block.
 *
 * Controls MIME type restrictions and SVG serving behaviour for file uploads.
 */
export const UploadSecurityConfigSchema = z.object({
  /**
   * Additional MIME types to allow beyond the defaults. Merged with the
   * default allowlist. Use with caution.
   */
  additionalMimeTypes: z.array(z.string()).optional(),
  /**
   * Override the default MIME allowlist entirely. Blocked types
   * (HTML, JS) are still rejected regardless of this setting.
   */
  allowedMimeTypes: z.array(z.string()).optional(),
  /**
   * Serve SVG files with a restrictive CSP (`script-src 'none'`).
   * @default true
   */
  svgCsp: z.boolean().optional(),
});

/**
 * Validates the `security.sanitization` block.
 *
 * Controls which sanitization features are active. All default to `true`.
 */
export const SanitizationConfigSchema = z.object({
  /**
   * Master toggle for the sanitization hook.
   * @default true
   */
  enabled: z.boolean().optional(),
  /**
   * Strip HTML tags from plain-text fields (text, textarea, email).
   * @default true
   */
  stripHtmlFromText: z.boolean().optional(),
  /**
   * Validate CSS values in rich text (bgColor, textColor, inline styles).
   * @default true
   */
  validateCssValues: z.boolean().optional(),
  /**
   * Block dangerous URL protocols (javascript:, data:, vbscript:) in rich text.
   * @default true
   */
  validateUrlProtocols: z.boolean().optional(),
});

/**
 * Audit H13 (T-012): request body / multipart size caps. Each field
 * accepts a byte count or a human-readable suffix (`"1mb"`, `"500kb"`).
 * String shorthand is parsed at runtime; the schema stays permissive.
 */
export const SecurityLimitsConfigSchema = z.object({
  /** Max `application/json` body size. @default "1mb" */
  json: z.union([z.string(), z.number().int().positive()]).optional(),
  /** Max total `multipart/form-data` body size. @default "50mb" */
  multipart: z.union([z.string(), z.number().int().positive()]).optional(),
  /** Per-file size cap inside multipart uploads. @default "10mb" */
  fileSize: z.union([z.string(), z.number().int().positive()]).optional(),
  /** Max files per multipart request. @default 10 */
  fileCount: z.number().int().positive().optional(),
  /** Max non-file form fields per request. @default 50 */
  fieldCount: z.number().int().positive().optional(),
  /** Max size of a single non-file form field. @default "100kb" */
  fieldSize: z.union([z.string(), z.number().int().positive()]).optional(),
});

/**
 * Validates the full `security` namespace in `defineConfig()`.
 *
 * @example
 * ```typescript
 * import { SecurityConfigSchema } from '@nextly/schemas/security-config';
 *
 * const parsed = SecurityConfigSchema.parse({
 *   headers: { contentSecurityPolicy: "default-src 'self'" },
 *   cors: { origin: ['https://example.com'] },
 *   sanitization: { enabled: true },
 *   trustProxy: true,
 *   limits: { multipart: "100mb" },
 * });
 * ```
 */
export const SecurityConfigSchema = z.object({
  headers: SecurityHeadersConfigSchema.optional(),
  cors: CorsConfigSchema.optional(),
  uploads: UploadSecurityConfigSchema.optional(),
  sanitization: SanitizationConfigSchema.optional(),
  limits: SecurityLimitsConfigSchema.optional(),
  /**
   * When the application sits behind a reverse proxy (Vercel, Cloudflare,
   * Nginx, ALB, etc.), set this to `true` so client-IP resolution honors
   * `X-Forwarded-For`. Pair with the `TRUSTED_PROXY_IPS` env var (a
   * comma-separated CIDR list of your proxy fleet) so the framework
   * can identify which hops in the chain are proxies vs the real client.
   *
   * When `false` (default), proxy headers are ignored entirely. Use
   * this when the application is exposed directly to clients with no
   * trusted intermediary, or during local development.
   *
   * Audit: closes C4 (XFF blindly trusted across rate-limit / auth flows).
   *
   * @default false
   */
  trustProxy: z.boolean().optional(),
});

export type SecurityConfigInput = z.infer<typeof SecurityConfigSchema>;
export type SecurityHeadersConfigInput = z.infer<
  typeof SecurityHeadersConfigSchema
>;
export type CorsConfigInput = z.infer<typeof CorsConfigSchema>;
export type UploadSecurityConfigInput = z.infer<
  typeof UploadSecurityConfigSchema
>;
export type SanitizationConfigInput = z.infer<typeof SanitizationConfigSchema>;
export type SecurityLimitsConfigInput = z.infer<
  typeof SecurityLimitsConfigSchema
>;
