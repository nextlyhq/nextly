/**
 * Scalar docs-UI renderer.
 *
 * Wraps `@scalar/api-reference` and is the default UI when the peer dep
 * is installed. The handler resolves this module via dynamic import so
 * the dep stays *optional*: deployments that don't install Scalar fall
 * back to the dependency-free fallback renderer in `./fallback.ts`.
 *
 * Ships the Scalar bundle from `cdn.jsdelivr.net` to keep this package
 * wire-light. Future work will switch to bundled-asset serving via
 * `assets()` for offline and strict-CSP environments — that's the
 * intended end-state. For now, deployments with a strict CSP can either:
 *
 *   1. Stick with the fallback renderer (`defineOpenApi({ ui: undefined })`
 *      doesn't choose scalar — actually setting `ui: "swagger-ui"` is the
 *      cleaner opt-out and is planned; until then, omitting the peer dep
 *      is the easiest path).
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

// Strips Scalar's vendor surfaces so the standalone reference is reduced
// to "just the API docs":
//   - `agent.disabled` blocks the Scalar Agent chat (enabled on localhost
//     by default; would otherwise appear unprompted in user dev).
//   - `customCss` hides two undocumented Scalar surfaces:
//       • `.scalar-mcp-layer` — bottom-left sidebar panel with "VS Code",
//         "Cursor", and "Generate MCP" launchers (all link to scalar.com).
//       • `.api-reference-toolbar` — top toolbar with "Developer Tools",
//         "Configure", "Share", "Deploy". Verified empirically to contain
//         only those four buttons in @scalar/api-reference@1.55 (no search
//         or theme toggle lives there — those are in the sidebar).
//     Neither has a documented config flag as of v1.55; the class names
//     are the stable handles. If Scalar later ships real flags, drop the
//     CSS in favor of them.
// The "Powered by Scalar" footer stays — MIT has no NOTICE clause, but
// attributing OSS we ship unchanged is a goodwill norm.
const SCALAR_CONFIG = {
  agent: { disabled: true },
  customCss:
    ".scalar-mcp-layer, .api-reference-toolbar { display: none !important; }",
} as const;

export const scalarRenderer: DocsUiRenderer = {
  name: "scalar",
  render: ({ specUrl, title, theme = "auto", cspNonce }) => {
    const safeTitle = escape(title);
    const safeUrl = escape(specUrl);
    const safeTheme = escape(theme);
    const safeConfig = escape(JSON.stringify(SCALAR_CONFIG));
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
<script id="api-reference" data-url="${safeUrl}" data-configuration="${safeConfig}"${nonceAttr}></script>
<script src="${SCALAR_CDN_URL}"${nonceAttr}></script>
</body></html>`;
    return { html };
  },
  assets: () => new Map(),
};
