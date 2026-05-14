/**
 * Pluggable docs-UI renderer interface.
 *
 * Ships two implementations:
 *   - `fallbackRenderer` — tiny inline HTML with install instructions.
 *   - `scalarRenderer`   — wraps `@scalar/api-reference` (dynamic
 *                          import; peer-dep optional).
 *
 * Swagger UI and Redoc adapters are planned. The interface is kept
 * minimal on purpose: every renderer ships a single page of HTML plus
 * an optional static-asset map (favicons, vendored JS bundles, etc.)
 * served from a renderer-controlled base path.
 *
 * @module nextly/openapi/renderer
 */

export interface RenderArgs {
  /** Absolute URL of the spec JSON the renderer should load. */
  specUrl: string;
  /** Document title shown in the browser tab + page header. */
  title: string;
  /** Optional theme hint. Renderers ignore this if they don't support it. */
  theme?: "light" | "dark" | "auto";
  /**
   * CSP nonce to thread into any inline `<script>` / `<style>` blocks.
   * When omitted, renderers either avoid inline scripting entirely
   * (fallback) or assume `script-src 'self'`.
   */
  cspNonce?: string;
}

export interface RenderResult {
  html: string;
  /**
   * Optional base path under which the renderer expects to serve its
   * static assets. Callers that wire a static handler check `assets()`
   * for the actual map; `undefined` means the renderer is self-contained.
   */
  assetsBasePath?: string;
}

export interface DocsUiRenderer {
  /** Human-readable renderer name (e.g. `"scalar"`, `"fallback"`). */
  name: string;
  /** Produce the docs-page HTML for the supplied spec URL. */
  render(args: RenderArgs): RenderResult;
  /**
   * Map of asset path → `{ content, mime }` blobs the renderer needs
   * served as siblings of the docs page. Empty for self-contained
   * renderers (the default).
   */
  assets(): Map<string, { content: Buffer; mime: string }>;
}
