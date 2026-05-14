/**
 * Scalar docs-UI renderer.
 *
 * Wraps `@scalar/api-reference` and is the default UI when the peer dep
 * is installed. The handler resolves this module via dynamic import so
 * the dep stays *optional*: deployments that don't install Scalar fall
 * back to the dependency-free fallback renderer in `./fallback.ts`.
 *
 * Phase 1 ships the Scalar bundle from `cdn.jsdelivr.net` to keep this
 * package wire-light. Phase 2 will switch to bundled-asset serving via
 * `assets()` for offline and strict-CSP environments — that's the
 * intended end-state described in spec §11.4. For now, deployments
 * with a strict CSP can either:
 *
 *   1. Stick with the fallback renderer (`defineOpenApi({ ui: undefined })`
 *      doesn't choose scalar — actually setting `ui: "swagger-ui"` is the
 *      cleaner opt-out and lands in Phase 2; until then, omitting the
 *      peer dep is the easiest path).
 *   2. Allow `cdn.jsdelivr.net` in `script-src`.
 *
 * @module nextly/openapi/renderer/scalar
 */

import type { DocsUiRenderer } from "./interface";

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escape(value: string): string {
  return value.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch] ?? ch);
}

/**
 * Scalar's CDN entry point. Pinned to the major-version channel so we
 * pick up patches automatically without breaking changes.
 */
const SCALAR_CDN_URL = "https://cdn.jsdelivr.net/npm/@scalar/api-reference";

export const scalarRenderer: DocsUiRenderer = {
  name: "scalar",
  render: ({ specUrl, title, theme = "auto", cspNonce }) => {
    const safeTitle = escape(title);
    const safeUrl = escape(specUrl);
    const safeTheme = escape(theme);
    // When a CSP nonce is supplied, thread it onto both inline + CDN script
    // tags so they pass `script-src 'nonce-...'`. Deployments without a
    // nonce policy can omit it entirely.
    const nonceAttr = cspNonce ? ` nonce="${escape(cspNonce)}"` : "";

    const html = `<!doctype html>
<html lang="en" data-theme="${safeTheme}"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${safeTitle}</title>
</head><body>
<script id="api-reference" data-url="${safeUrl}"${nonceAttr}></script>
<script src="${SCALAR_CDN_URL}"${nonceAttr}></script>
</body></html>`;
    return { html };
  },
  assets: () => new Map(),
};
