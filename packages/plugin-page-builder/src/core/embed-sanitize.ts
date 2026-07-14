/**
 * Sanitizer for the raw-HTML Embed block (spec §6.3).
 *
 * Uses DOMPurify (via `isomorphic-dompurify`, so it runs the same on the server
 * and the client) instead of a regex pass: DOMPurify parses the markup and
 * decodes character references BEFORE validating URL schemes, so encoded-scheme
 * bypasses like `href="java&#x73;cript:…"` / `src=jAva&Tab;script:…` are caught
 * where a raw-text matcher would miss them.
 *
 * Embeds legitimately need `<iframe>` (YouTube, maps, …), so it is allow-listed —
 * an obvious, author-controlled risk — but the `srcdoc` attribute (which can host
 * its own script context) is forbidden, and script/style/object and inline event
 * handlers are stripped.
 */
import DOMPurify from "isomorphic-dompurify";

const CONFIG = {
  ADD_TAGS: ["iframe"],
  ADD_ATTR: [
    "allow",
    "allowfullscreen",
    "frameborder",
    "loading",
    "referrerpolicy",
    "sandbox",
  ],
  FORBID_TAGS: ["script", "style", "base", "meta", "link", "object", "embed"],
  // `srcdoc` can carry its own script context past sanitization; never allow it.
  FORBID_ATTR: ["srcdoc"],
};

export function sanitizeEmbedHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, CONFIG);
}
