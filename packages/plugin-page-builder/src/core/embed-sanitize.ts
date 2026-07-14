/**
 * Conservative sanitizer for the raw-HTML Embed block (spec §6.3). React-free.
 *
 * This is a defense-in-depth pass for TRUSTED-AUTHOR content (the block is only usable
 * by users who can already edit pages). It strips script/style/meta/base/object tags,
 * inline event handlers, and dangerous URL schemes. It is intentionally conservative;
 * a full DOM-based sanitizer is the richer long-term option.
 */
export function sanitizeEmbedHtml(html: string): string {
  if (!html) return "";
  let s = html;
  // Remove script/style blocks entirely (including content).
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  // Remove standalone dangerous tags.
  s = s.replace(
    /<\/?(script|style|link|meta|base|object|embed|frame|frameset)\b[^>]*>/gi,
    ""
  );
  // Strip inline event handlers (onclick, onerror, …).
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize dangerous URL schemes in href/src/action.
  s = s.replace(
    /\b(href|src|action|formaction)\s*=\s*(["']?)\s*(javascript|vbscript|data):/gi,
    "$1=$2blocked:"
  );
  return s;
}
