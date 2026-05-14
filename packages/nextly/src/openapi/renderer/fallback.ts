/**
 * Fallback docs-UI renderer.
 *
 * Used when no real renderer (Scalar, Swagger UI, Redoc) is installed.
 * Emits a tiny, dependency-free HTML page that:
 *   1. Tells the contributor that Scalar is the recommended renderer
 *      and how to install it.
 *   2. Links to the JSON + YAML spec URLs so the spec is still
 *      consumable without any UI.
 *
 * Intentionally inline-styled and free of `<script>` tags so it works
 * under the strictest CSP without a nonce.
 *
 * Spec: §11.3.
 *
 * @module nextly/openapi/renderer/fallback
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

function deriveYamlUrl(jsonUrl: string): string {
  // Swap the trailing `.json` for `.yaml`. Falls back to the original
  // URL when the caller passed something we don't recognize — better to
  // render a "duplicate JSON link" than a broken `.yaml` URL.
  if (jsonUrl.endsWith(".json")) return `${jsonUrl.slice(0, -5)}.yaml`;
  if (jsonUrl.endsWith(".yaml")) return jsonUrl;
  return jsonUrl;
}

export const fallbackRenderer: DocsUiRenderer = {
  name: "fallback",
  render: ({ specUrl, title }) => {
    const safeTitle = escape(title);
    const safeJson = escape(specUrl);
    const safeYaml = escape(deriveYamlUrl(specUrl));
    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${safeTitle}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:4rem auto;padding:0 1.5rem;line-height:1.55;color:#18181b}
  h1{font-size:1.5rem;margin:0 0 1.5rem}
  code{background:#f4f4f5;padding:.15em .35em;border-radius:.3em;font-size:.95em}
  pre{background:#f4f4f5;padding:.8em 1em;border-radius:.4em;overflow-x:auto;font-size:.9em}
  .box{border:1px solid #e4e4e7;border-radius:.5em;padding:1.25em 1.5em;background:#fafafa}
  ul{padding-left:1.2em}
  a{color:#2563eb}
</style>
</head><body>
<h1>${safeTitle}</h1>
<div class="box">
  <p><strong>The Scalar docs renderer is not installed.</strong></p>
  <p>To enable interactive API docs, install:</p>
  <pre>pnpm add @scalar/api-reference</pre>
  <p>Or pick a different renderer in your config:</p>
  <pre>defineOpenApi({ ui: "swagger-ui" })</pre>
  <p>The raw spec is still available at:</p>
  <ul>
    <li><a href="${safeJson}">${safeJson}</a></li>
    <li><a href="${safeYaml}">${safeYaml}</a></li>
  </ul>
</div>
</body></html>`;
    return { html };
  },
  assets: () => new Map(),
};
