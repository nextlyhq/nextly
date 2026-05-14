/**
 * Nextly OpenAPI generator — public surface.
 *
 * What `nextly/openapi` exports for application code:
 *
 *   - `defineOpenApi(config)` — identity helper for typing the
 *     `openapi` slot in `defineConfig({ ... })`.
 *   - `OpenApiConfig` and friends — the user-facing config shape.
 *   - `DocsUiRenderer` — the renderer plug-point. The default fallback
 *     renderer is mounted automatically when no real renderer is
 *     installed; T25 wires Scalar in as the default.
 *   - Curated OAS type re-exports for callers writing inline schema
 *     overrides.
 *
 * Spec: §6.
 *
 * @module nextly/openapi
 */

import type { OpenAPIV3_1 } from "openapi-types";

// ────────────────────────────────────────────────────────────────────
// User-facing config types
// ────────────────────────────────────────────────────────────────────

/**
 * Authorization gates per surface (the spec doc and the docs UI).
 *
 * The literal values cover the common cases ("admin" = any authenticated
 * user, "public" = no auth required); custom predicates land in
 * Phase 2's middleware layer.
 */
export interface OpenApiAccessConfig {
  /** Who can fetch `openapi.json` / `openapi.yaml`. */
  json: "admin" | "public" | ((req: Request) => boolean | Promise<boolean>);
  /** Who can load the docs UI page. */
  ui: "admin" | "public" | ((req: Request) => boolean | Promise<boolean>);
}

export interface OpenApiCacheConfig {
  /** Whether the generator's LRU cache is honoured. Defaults to `true`. */
  enabled: boolean;
  /**
   * `cache-control: max-age` for spec responses. The handler always
   * emits `must-revalidate` alongside this, so ETag-based revalidation
   * still keeps the client honest.
   */
  maxAgeSeconds: number;
}

/**
 * Top-level OpenAPI configuration.
 *
 * Slots into the user's `defineConfig({ openapi: defineOpenApi({...}) })`
 * call. Every field is optional; sensible defaults apply per-handler.
 */
export interface OpenApiConfig {
  /**
   * OAS `info` overrides — title / version / description / contact /
   * license. Anything you omit falls back to the handler's defaults.
   */
  info?: Partial<OpenAPIV3_1.InfoObject>;
  /**
   * Optional `servers` list. Set this to your deployment URL(s) so
   * client SDKs generated from the spec know where to call.
   */
  servers?: readonly OpenAPIV3_1.ServerObject[];
  /** Authorization gates per surface. Defaults: both `"admin"`. */
  access?: Partial<OpenApiAccessConfig>;
  /**
   * Which docs UI renderer to mount. `"scalar"` is the default once
   * `@scalar/api-reference` is installed; Swagger UI and Redoc adapters
   * land in Phase 2.
   */
  ui?: "scalar" | "swagger-ui" | "redoc";
  /**
   * Cache tuning. Defaults: enabled = true, maxAgeSeconds = 60.
   */
  cache?: Partial<OpenApiCacheConfig>;
  /**
   * Run the OAS validator after every generation. Defaults to
   * `"dev-only"` (catches authoring mistakes locally without paying
   * the validation cost on every prod request).
   */
  validate?: "dev-only" | "always" | "never";
}

/**
 * Identity helper that pins the `OpenApiConfig` shape at call sites.
 *
 * @example
 * ```ts
 * import { defineConfig, defineOpenApi } from "nextly";
 *
 * export default defineConfig({
 *   collections: [...],
 *   openapi: defineOpenApi({
 *     info: { title: "Acme API", version: "1.0.0" },
 *     servers: [{ url: "https://api.acme.com" }],
 *   }),
 * });
 * ```
 */
export function defineOpenApi(config: OpenApiConfig = {}): OpenApiConfig {
  return config;
}

// ────────────────────────────────────────────────────────────────────
// Curated re-exports
// ────────────────────────────────────────────────────────────────────

export type {
  OpenAPIDocument,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIReference,
  OpenAPIRequestBody,
  OpenAPIResponse,
  OpenAPISchema,
  OpenAPISecurityScheme,
  OpenAPIServer,
  OpenAPITag,
} from "./types";

export type {
  DocsUiRenderer,
  RenderArgs,
  RenderResult,
} from "./renderer/interface";

export { fallbackRenderer } from "./renderer/fallback";
