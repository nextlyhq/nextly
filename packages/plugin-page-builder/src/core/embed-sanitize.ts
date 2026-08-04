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
 *
 * Scheme safety is only half the question, and it is the only half DOMPurify
 * answers. A sanitized fragment may still name any HOST it likes, and the
 * requests it makes are the same conditional channel the origin policy closes
 * everywhere else: an `<iframe loading="lazy">` or an `<img>` fires only when
 * something renders it, and custom CSS in the same page decides whether it
 * does. So every attribute the browser fetches from is held to the same
 * `remotePatterns` allowlist as the rest of the builder, through the hook
 * DOMPurify provides for exactly this.
 */
import * as csstree from "css-tree";
import DOMPurify from "isomorphic-dompurify";

import {
  fetchableValues,
  isFetchableUrl,
  type RemotePatternInput,
} from "./url-policy";

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

/**
 * Attributes the browser resolves into a request on its own.
 *
 * `href` is deliberately absent: a link is followed by a person, so where it
 * points is the author's business and the navigation carries no information
 * back without an action. These fetch without one, which is what makes them a
 * channel rather than a preference.
 */
const FETCH_ATTRS = [
  "src",
  "srcset",
  "poster",
  "background",
  "data",
  "lowsrc",
] as const;

/** The SVG namespace, where `href` names a resource rather than a destination. */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Whether this element's `href` is fetched rather than navigated to.
 *
 * In HTML `href` belongs to `<a>` and `<link>` and is followed by a person. In
 * SVG it is how `<image>`, `<use>`, `<feImage>` and the gradient and pattern
 * elements REFERENCE something, and the browser resolves it on its own — so an
 * `<feImage href="https://…">` inside a filter fetches whenever the filter is
 * applied, which CSS decides. SVG's own `<a>` is the one exception and keeps
 * navigating.
 */
function hrefIsFetched(node: Element): boolean {
  return node.namespaceURI === SVG_NS && node.localName.toLowerCase() !== "a";
}

/**
 * Every URL in a `srcset`, which holds a comma-separated candidate list.
 *
 * Each candidate is a URL optionally followed by a descriptor, so the URL is
 * the text up to the first space. A candidate that yields none makes the whole
 * attribute unreadable rather than empty, and unreadable is refused.
 */
function srcsetUrls(value: string): string[] | undefined {
  const urls: string[] = [];
  for (const candidate of value.split(",")) {
    const url = candidate.trim().split(/\s+/)[0];
    if (!url) return undefined;
    urls.push(url);
  }
  return urls.length > 0 ? urls : undefined;
}

/** Whether an inline `style` attribute fetches only from allowed origins. */
function styleIsAllowed(
  value: string,
  patterns: readonly RemotePatternInput[]
): boolean {
  let declarations: csstree.CssNode;
  try {
    // A style attribute is a declaration list rather than a single value, so it
    // is parsed as one. That puts each declaration's value within reach of the
    // shared scan instead of growing a second URL reader here.
    declarations = csstree.parse(value, { context: "declarationList" });
  } catch {
    return false;
  }
  let allowed = true;
  csstree.walk(declarations, {
    visit: "Declaration",
    enter(node: csstree.CssNode) {
      if (!allowed) return;
      const declaration = node as csstree.Declaration;
      const { values, unreadable } = fetchableValues(
        declaration.value,
        0,
        [],
        // A custom property is judged as though its value could land anywhere.
        // Declarations are checked one at a time, so `--u: "https://…"` reads
        // as a bare string and the declaration consuming it holds only
        // `var(--u)` — neither sees a URL, while the pair fetches one.
        declaration.property.startsWith("--")
      );
      // Unreadable is not safe, the same as everywhere else this scan is used.
      if (unreadable !== undefined) allowed = false;
      else if (values.some(url => !isFetchableUrl(url, patterns)))
        allowed = false;
    },
  });
  return allowed;
}

/**
 * Strip the fetch-bearing attributes a sanitized fragment may not use.
 *
 * The ATTRIBUTE is removed rather than the element: an `<iframe>` or `<img>`
 * left without a source renders as nothing, which makes the omission visible,
 * while removing the node would take surrounding markup the author wrote around
 * it. Nothing is rewritten to a "safe" value either — guessing what the author
 * meant is not something a security control should invent.
 */
function enforceOrigins(
  node: Element,
  patterns: readonly RemotePatternInput[]
): void {
  // `href` and its legacy `xlink:href` spelling join the list only where they
  // name a resource. Both spellings, because SVG 1.1 content uses the namespaced
  // one and browsers still honour it.
  const attrs = hrefIsFetched(node)
    ? [...FETCH_ATTRS, "href", "xlink:href"]
    : FETCH_ATTRS;
  for (const attr of attrs) {
    const value = node.getAttribute(attr);
    if (value === null) continue;
    const urls = attr === "srcset" ? srcsetUrls(value) : [value];
    if (urls !== undefined && urls.every(url => isFetchableUrl(url, patterns)))
      continue;
    node.removeAttribute(attr);
  }
  const style = node.getAttribute("style");
  if (style !== null && !styleIsAllowed(style, patterns))
    node.removeAttribute("style");
}

export function sanitizeEmbedHtml(
  html: string,
  remotePatterns: readonly RemotePatternInput[] = []
): string {
  if (!html) return "";
  const hook = (node: Element): void => {
    enforceOrigins(node, remotePatterns);
  };
  // Registered and removed around ONE synchronous call. DOMPurify keeps hooks
  // on a shared instance, so one left behind would apply to every later
  // sanitize with whichever patterns this call happened to be holding.
  DOMPurify.addHook("afterSanitizeAttributes", hook);
  try {
    return DOMPurify.sanitize(html, CONFIG);
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}
