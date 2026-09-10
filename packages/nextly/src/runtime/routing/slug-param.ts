/**
 * A stored slug, as a static param — the one question `generateStaticParams`
 * asks, answered without anything else this route needs.
 *
 * ## Why it is a module of its own
 *
 * It is a pure function over a string, and it is PUBLIC: `nextly/runtime`
 * exports it, `@nextlyhq/plugin-sdk/routing` re-exports it, and the SEO
 * plugin's sitemap and `blocks-react`'s Next entry both call it so that a
 * sitemap and a build agree with the route about which paths exist.
 *
 * Defined beside `createContentRoute` it had that route's import graph behind
 * it — `requireNextly` and the whole Direct API, the error type, the not-found
 * trigger, the content resolver — none of which it uses. That costs nothing to
 * a consumer who externalises `nextly`, and it is the ordinary application
 * build, which bundles, that pays.
 *
 * 🔴 So this module imports `./reserved-paths` and NOTHING else, and
 * `slug-param-is-a-leaf.test.ts` asserts exactly that rather than leaving it to
 * be noticed. One convenient import here would undo the split silently: the
 * function keeps working, the graph grows again, and nothing fails.
 *
 * @module runtime/routing/slug-param
 */

import { isReservedPath } from "./reserved-paths";

/**
 * Whether a STORED path segment is one URL resolution removes.
 *
 * Literal `.` and `..` only. The URL standard does also treat `%2e` as a dot
 * when parsing a URL, but this reads a slug as STORED, and a stored segment
 * reaches a URL already encoded: `%2E%2E` becomes `%252E%252E`, which stays a
 * literal segment and decodes back to the text the lookup matches. Applying the
 * URL-text rule to stored text would reject an entry that is perfectly
 * addressable, taking it out of static generation and stripping its canonical.
 */
function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

/**
 * Map a stored slug value to a static param, or `null` to skip it.
 *
 * An empty slug is the site root (`/`) — emitted as the no-segment param so the
 * homepage pre-renders — while whitespace-only, non-string, and reserved values
 * are dropped, because the page would only `notFound()` them.
 */
export function slugToStaticParam(value: unknown): { slug: string[] } | null {
  if (typeof value !== "string") return null;
  if (value === "") return isReservedPath("/") ? null : { slug: [] };
  if (value.trim() === "") return null;
  // Collapse leading/trailing/duplicate slashes so a stored "/admin" or "a//b"
  // normalizes to clean segments and can't dodge the reserved-path check.
  const normalized = value
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
  if (normalized === "") return null;
  if (isReservedPath(`/${normalized}`)) return null;
  const segments = normalized.split("/");
  // A `.` or `..` segment makes the slug UNADDRESSABLE. URL resolution removes
  // those segments before a request is sent, so a pre-rendered `/pages/../admin`
  // is fetched as `/admin` and the page generated here can never be reached —
  // while the path it occupies belongs to a different, possibly reserved route.
  // Percent-encoding does not help: the URL standard treats `%2e` as a dot for
  // exactly this purpose, so `%2E%2E` resolves away too.
  if (segments.some(isDotSegment)) return null;
  // A slug NORMALIZATION changed is a slug that cannot be served. The route
  // matches the joined incoming segments against the stored column, so an entry
  // stored as `a//b` is fetched at `/a/b` and looked up as `a/b` — which it does
  // not have. Pre-rendering that path builds a page the lookup can never find,
  // and any URL derived from it names one the route answers with `notFound()`.
  //
  // The normalization above still happens, because a reserved path must not be
  // smuggled past the check by a leading slash. What changes is the ANSWER:
  // normalization is used to decide, never to rewrite.
  if (segments.join("/") !== value) return null;
  return { slug: segments };
}
