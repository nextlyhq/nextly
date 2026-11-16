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

/**
 * The segment a paginated list's later pages sit under: page 2 of the list
 * at `/news` is served at `/news/page/2`.
 *
 * Here, in the leaf, because three readers must agree on it: the route that
 * serves those pages, the renderer that links to them, and whatever records
 * which addresses a list holds. One spelled `"page"` and another `"p"` would
 * each be internally consistent and link to pages the other never serves.
 *
 * @experimental Settles with list pagination.
 */
export const LIST_PAGE_SEGMENT = "page";

/** A page number as an address writes it: a whole number from 1, no sign, no leading zero. */
const LIST_PAGE_NUMBER = /^[1-9]\d*$/;

/**
 * The page number a path segment names, or null when it names none.
 *
 * Only one spelling per number is a page, so a page has one address: `02`,
 * `+2`, `2.0` and `0` are not pages, and the route answers them as not found
 * rather than serving a duplicate of `/page/2`. Any number held exactly
 * is a page number, so every page a list's count names has an address; a
 * run of digits too long to hold exactly is none.
 *
 * @experimental Settles with list pagination.
 */
export function listPageNumber(segment: string): number | null {
  if (!LIST_PAGE_NUMBER.test(segment)) return null;
  const page = Number(segment);
  return Number.isSafeInteger(page) ? page : null;
}

/**
 * The address a path is a later page of, and the segment naming the page, or
 * null when the path does not end in `page/<segment>`.
 *
 * `news/page/2` is page `"2"` of `news`, and `page/2` is page `"2"` of the
 * home page (`""`). The page segment comes back as written, so a caller can
 * tell `1` (the list's own address, under a second spelling) from `02` (no
 * page at all) with {@link listPageNumber}.
 *
 * @experimental Settles with list pagination.
 */
export function listPageOf(
  slug: string
): { readonly base: string; readonly segment: string } | null {
  const segments = slug.split("/");
  if (segments.length < 2) return null;
  if (segments.at(-2) !== LIST_PAGE_SEGMENT) return null;
  return {
    base: segments.slice(0, -2).join("/"),
    segment: segments.at(-1) ?? "",
  };
}

/**
 * The path a stored slug is served at, each segment percent-encoded, or null
 * where the route serves none: `""` is `/`, `about/team` is `/about/team`.
 *
 * Derived from {@link slugToStaticParam}, the route's own answer, so a link,
 * a canonical or a redirect never names a path the route does not serve.
 * Encoded per segment because Next hands the route DECODED segments while
 * the request used their encoded form: `faq?all` written raw reads as a path
 * and a query.
 *
 * @experimental Settles with list pagination.
 */
export function slugToPath(value: unknown): string | null {
  const param = slugToStaticParam(value);
  if (param === null) return null;
  if (param.slug.length === 0) return "/";
  return `/${param.slug.map(encodeURIComponent).join("/")}`;
}
