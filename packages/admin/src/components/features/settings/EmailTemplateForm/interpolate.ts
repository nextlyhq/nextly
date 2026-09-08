// ============================================================
// Template-source inspection (NOT rendering)
// ============================================================
//
// What remains here reads the template SOURCE: which variables it names, and
// how to escape a value for the preview frame's own chrome. Rendering left —
// `POST /api/email-templates/preview` composes a draft through the same
// function the transport uses, and a browser-side second implementation of it
// is a second answer to what a recipient receives.

const TEMPLATE_VAR_RE = /{{\s*([\w.]+)\s*}}/g;

export function escapeHtmlValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function collectVariableNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(TEMPLATE_VAR_RE)) names.add(match[1]);
  return [...names];
}
