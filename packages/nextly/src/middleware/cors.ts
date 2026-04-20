/**
 * CORS Middleware
 *
 * Origin-based Cross-Origin Resource Sharing enforcement for all API responses.
 * Handles preflight (OPTIONS) requests and applies CORS headers to normal responses.
 *
 * Three origin modes:
 * - `origin: []` (default) — same-origin only, no CORS headers set
 * - `origin: ['*']` — wide-open access (development only), logs warning in production
 * - `origin: ['https://example.com', ...]` — allowlist with dynamic origin reflection
 *
 * @module middleware/cors
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const cors = createCorsMiddleware({
 *   origin: ['https://example.com', 'https://app.example.com'],
 *   credentials: true,
 * });
 *
 * // In request pipeline:
 * const preflightResponse = cors.handlePreflight(request);
 * if (preflightResponse) return preflightResponse;
 *
 * const response = await handler(request);
 * return cors.applyHeaders(request, response);
 * ```
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Configuration for CORS middleware.
 *
 * All fields are optional with secure defaults (same-origin only).
 */
export interface CorsConfig {
  /**
   * Allowed origins.
   * - `[]` (default): same-origin only — no CORS headers are set.
   * - `['*']`: wide-open access. Logs a warning in production.
   * - `['https://example.com', ...]`: allowlist with dynamic origin reflection.
   *
   * @default []
   */
  origin?: string[];

  /**
   * Allowed HTTP methods for preflight responses.
   *
   * @default ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
   */
  methods?: string[];

  /**
   * Headers the client is allowed to send.
   *
   * @default ["Content-Type", "Authorization"]
   */
  allowedHeaders?: string[];

  /**
   * Response headers exposed to client-side JavaScript.
   *
   * @default ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
   */
  exposedHeaders?: string[];

  /**
   * Whether to include credentials (cookies, Authorization header).
   * Ignored when origin is `['*']` (CORS spec prohibits credentials with wildcard).
   *
   * @default true
   */
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds.
   *
   * @default 86400 (24 hours)
   */
  maxAge?: number;
}

/**
 * CORS middleware instance returned by `createCorsMiddleware()`.
 */
export interface CorsMiddleware {
  /**
   * Handle preflight (OPTIONS) requests.
   *
   * @param request - The incoming request
   * @returns A 204 response with CORS headers for OPTIONS requests, or `null` for non-preflight requests
   */
  handlePreflight(request: Request): Response | null;

  /**
   * Apply CORS headers to a response based on the request's Origin header.
   *
   * @param request - The incoming request (used to read the Origin header)
   * @param response - The response to add CORS headers to
   * @returns A new Response with CORS headers applied
   */
  applyHeaders(request: Request, response: Response): Response;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_ALLOWED_HEADERS = ["Content-Type", "Authorization"];
const DEFAULT_EXPOSED_HEADERS = [
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
];
const DEFAULT_MAX_AGE = 86400; // 24 hours

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Determine the origin mode from the config.
 *
 * @returns 'none' (same-origin), 'wildcard', or 'allowlist'
 */
function resolveOriginMode(
  origins: string[]
): "none" | "wildcard" | "allowlist" {
  if (origins.length === 0) return "none";
  if (origins.length === 1 && origins[0] === "*") return "wildcard";
  return "allowlist";
}

/**
 * Check if the request Origin matches any origin in the allowlist.
 *
 * Comparison is case-sensitive and exact-match (no glob/regex).
 */
function isOriginAllowed(requestOrigin: string, allowlist: string[]): boolean {
  return allowlist.includes(requestOrigin);
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Creates a CORS middleware instance.
 *
 * The returned object has two methods:
 * - `handlePreflight(request)` — intercepts OPTIONS requests, returns 204 or null
 * - `applyHeaders(request, response)` — adds CORS headers to any response
 *
 * Configuration is resolved at creation time for minimal per-request overhead.
 *
 * @param config - Optional CORS configuration
 * @returns A CorsMiddleware instance
 *
 * @example
 * ```typescript
 * // Same-origin only (default)
 * const cors = createCorsMiddleware();
 *
 * // Development: wide open
 * const cors = createCorsMiddleware({ origin: ['*'] });
 *
 * // Production: specific origins
 * const cors = createCorsMiddleware({
 *   origin: ['https://example.com', 'https://app.example.com'],
 *   credentials: true,
 *   maxAge: 86400,
 * });
 * ```
 */
export function createCorsMiddleware(config?: CorsConfig): CorsMiddleware {
  // Resolve config with defaults
  const origins = config?.origin ?? [];
  const methods = config?.methods ?? DEFAULT_METHODS;
  const allowedHeaders = config?.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS;
  const exposedHeaders = config?.exposedHeaders ?? DEFAULT_EXPOSED_HEADERS;
  const credentials = config?.credentials ?? true;
  const maxAge = config?.maxAge ?? DEFAULT_MAX_AGE;

  const mode = resolveOriginMode(origins);

  // Pre-compute static header values (avoid per-request string joins)
  const methodsString = methods.join(", ");
  const allowedHeadersString = allowedHeaders.join(", ");
  const exposedHeadersString = exposedHeaders.join(", ");
  const maxAgeString = String(maxAge);

  // Warn if wildcard is used in production
  if (mode === "wildcard" && process.env.NODE_ENV === "production") {
    console.warn(
      "[nextly] CORS origin is set to '*' (wildcard) in production. " +
        "This allows any website to make cross-origin requests to your API. " +
        "Consider restricting to specific origins for production use."
    );
  }

  // Same-origin mode: no CORS headers needed
  if (mode === "none") {
    return {
      handlePreflight(_request: Request): Response | null {
        // Even in same-origin mode, respond to OPTIONS with 204
        // (some clients send OPTIONS regardless)
        if (_request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: { "Content-Length": "0" },
          });
        }
        return null;
      },

      applyHeaders(_request: Request, response: Response): Response {
        return response;
      },
    };
  }

  // Wildcard mode: static headers, no credentials
  if (mode === "wildcard") {
    return {
      handlePreflight(request: Request): Response | null {
        if (request.method !== "OPTIONS") return null;

        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": methodsString,
            "Access-Control-Allow-Headers": allowedHeadersString,
            "Access-Control-Max-Age": maxAgeString,
            "Content-Length": "0",
          },
        });
      },

      applyHeaders(_request: Request, response: Response): Response {
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Access-Control-Allow-Origin", "*");

        if (exposedHeadersString) {
          newHeaders.set("Access-Control-Expose-Headers", exposedHeadersString);
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      },
    };
  }

  // Allowlist mode: dynamic origin reflection
  const originSet = new Set(origins);

  return {
    handlePreflight(request: Request): Response | null {
      if (request.method !== "OPTIONS") return null;

      const requestOrigin = request.headers.get("Origin");
      const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": methodsString,
        "Access-Control-Allow-Headers": allowedHeadersString,
        "Access-Control-Max-Age": maxAgeString,
        Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        "Content-Length": "0",
      };

      // Reflect origin if it matches the allowlist
      if (requestOrigin && isOriginAllowed(requestOrigin, [...originSet])) {
        headers["Access-Control-Allow-Origin"] = requestOrigin;

        if (credentials) {
          headers["Access-Control-Allow-Credentials"] = "true";
        }
      }

      return new Response(null, { status: 204, headers });
    },

    applyHeaders(request: Request, response: Response): Response {
      const requestOrigin = request.headers.get("Origin");

      // No Origin header = same-origin request, no CORS headers needed
      if (!requestOrigin) return response;

      // Origin not in allowlist = browser will block (no CORS headers)
      if (!isOriginAllowed(requestOrigin, [...originSet])) {
        // Still set Vary: Origin for cache safety even when rejecting
        const newHeaders = new Headers(response.headers);
        newHeaders.append("Vary", "Origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", requestOrigin);
      newHeaders.append("Vary", "Origin");

      if (credentials) {
        newHeaders.set("Access-Control-Allow-Credentials", "true");
      }

      if (exposedHeadersString) {
        newHeaders.set("Access-Control-Expose-Headers", exposedHeadersString);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    },
  };
}
