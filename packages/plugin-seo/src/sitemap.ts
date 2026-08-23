/**
 * Sitemap generation for `@nextlyhq/plugin-seo`.
 *
 * Framework-agnostic (zero `next`): lists each configured collection's
 * PUBLISHED entries through the managed service (as system — a sitemap is
 * public derived data) and renders a sitemaps.org `<urlset>`. Pure given a
 * services object, so it is unit-testable with a stub and integration-testable
 * against a real boot.
 *
 * Caching lives in the delivery layer, not here: the `<loc>` set is derived
 * from `status: published` content, which the F1 write path already busts on
 * every create / update / publish / delete, so a cached read tagged with the
 * collection tags refreshes on content changes without any bespoke cache.
 *
 * @module sitemap
 */
// The route's own path derivation, taken from the SDK rather than from core.
// `@nextlyhq/plugin-sdk` is this repository's stability boundary, and a
// first-party plugin is the worked example third parties copy — reaching past it
// into `nextly/runtime` would publish that shortcut as the pattern.
//
// It keeps this module framework-agnostic either way: the routing entry reaches
// `next/navigation` and `next/cache` through a lazy `createRequire` precisely so
// importing it never loads `next`, so the package's zero-`next` guarantee holds.
import { slugToStaticParam } from "@nextlyhq/plugin-sdk";

/**
 * The minimal `listEntries` the sitemap builder calls — a structural slice of
 * the managed collection service (`ctx.services.collections`). Declared
 * explicitly (rather than `Pick<PluginCollectionService, ...>`) so a test can
 * satisfy it with a plain stub, while the real, richer service stays assignable
 * to it. Reads published rows as system; only the fields the sitemap consumes
 * (`data` + `pagination.hasMore`) are named here.
 */
export interface SitemapServices {
  collections: {
    /**
     * Collection metadata — read only to check the built-in draft/published
     * lifecycle flag (`status: true`). Typed as `unknown` and narrowed at the
     * call site (the core `Collection` type does not surface `status`). The
     * context arg is unused by the read; pass `{}`.
     */
    getCollection(
      slug: string,
      context: Record<string, never>
    ): Promise<unknown>;
    listEntries(
      slug: string,
      query: {
        where?: Record<string, unknown>;
        depth?: number;
        // Field projection passed to the managed service. It trims the returned
        // rows to what the default mapper reads; note the current service
        // applies it to the response, not the SQL, so it does not yet avoid
        // reading the columns at the DB layer (a core enhancement).
        select?: Record<string, boolean>;
        // A stable, unique sort so consecutive pages don't overlap or skip
        // rows: the managed service adds `ORDER BY` only when `sort` is passed.
        sort?: { field: string; direction: "asc" | "desc" };
        // Paged by 1-indexed `page`: the managed service reads a page from
        // `page`, not `offset`, so pagination MUST advance `page` to progress.
        pagination?: { limit?: number; page?: number };
      },
      opts: { as: "system" }
    ): Promise<{ data: unknown[]; pagination: { hasMore: boolean } }>;
  };
}

/** One resolved sitemap URL. */
export interface SitemapUrl {
  /** Absolute location; XML-escaped at serialization time. */
  loc: string;
  /** ISO-8601 last-modified timestamp, when the entry carries one. */
  lastModified?: string;
}

/**
 * Build the URL path for an entry (leading slash, appended to the origin).
 * Defaults to `/<collection>/<slug>`. Return `null`/`undefined` to EXCLUDE the
 * entry from the sitemap (e.g. it has no stable public URL).
 */
export type UrlForEntry = (
  entry: Record<string, unknown>,
  collection: string
) => string | null | undefined;

/** Options for {@link buildSitemapUrls} / {@link generateSitemap}. */
export interface SitemapOptions {
  /** Collections whose published entries appear in the sitemap. */
  collections: string[];
  /**
   * Absolute site origin for `<loc>` (e.g. "https://example.com"). Must be an
   * origin only — no path, query, fragment, or credentials; per-entry paths come
   * from {@link UrlForEntry}. An invalid value throws.
   */
  baseUrl: string;
  /** Path builder; defaults to `/<collection>/<slug>`. */
  urlFor?: UrlForEntry;
  /**
   * Where each collection's route is MOUNTED, which decides the prefix its
   * entries' URLs carry. Defaults to `/<collection>`.
   *
   * This exists because the mount point is the one part of an entry's URL the
   * sitemap cannot derive: it is decided by where the route file sits in the
   * app directory, which is invisible from here. Everything AFTER the prefix is
   * derived from the route's own `slugToStaticParam`, so declaring the mount is
   * the whole of what a caller has to supply for the sitemap to agree with the
   * pages it lists.
   *
   * Pass `""` for a collection served at the site root — a page builder's pages
   * render at `/about`, not `/pages/about`. A function receives each collection
   * name; returning `null` EXCLUDES that collection from the sitemap entirely.
   *
   * It does NOT declare that the mount's own root is served, and an entry whose
   * slug is empty is skipped whatever this says: that depends on the route
   * file's bracket count, which is not visible from here. List a homepage with
   * a custom `urlFor`.
   *
   * Ignored when `urlFor` is supplied, which already owns the whole path.
   *
   * @example
   * ```ts
   * // Page-builder pages at the site root, blog posts under /blog.
   * buildSitemapUrls(services, {
   *   collections: ["pages", "posts"],
   *   baseUrl,
   *   basePath: collection => (collection === "pages" ? "" : "/blog"),
   * });
   * ```
   */
  basePath?: string | ((collection: string) => string | null);
  /**
   * Page size for the paginated service reads. Defaults to and is capped at
   * {@link MAX_PAGE_SIZE} (the managed service's per-page maximum).
   */
  pageSize?: number;
  /**
   * Advanced: cap the serialized document size in bytes. Defaults to and is
   * capped at {@link MAX_SITEMAP_BYTES} (the 50 MB protocol limit).
   */
  maxBytes?: number;
}

/**
 * Normalize a caller-supplied mount point into a prefix that concatenates
 * cleanly: no trailing slash, a leading slash unless it is empty.
 *
 * `""` is meaningful and distinct from absent — it is a collection mounted at
 * the site ROOT, which is how the page builder serves its pages.
 */
function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (trimmed === "" || trimmed === "/") return "";
  // A mount is a PATH PREFIX, and anything carrying URL structure is not one.
  // Left alone, `/docs?lang=en` reaches URL resolution as a query rather than as
  // two path segments and the entry is advertised at a location the route never
  // serves — the same silent disagreement this module exists to remove. Refused
  // rather than encoded, so a misconfiguration is a startup error instead of a
  // sitemap full of subtly wrong URLs. `baseUrl` is validated the same way.
  if (/[?#]/.test(trimmed)) {
    throw new Error(
      `sitemap: basePath must be a path prefix with no query or fragment, got: ${basePath}`
    );
  }
  // A backslash is a PATH SEPARATOR to the URL parser on an http(s) origin, not
  // an ordinary character, so `/docs\..\admin` is one segment to a reader that
  // splits on "/" and three to the thing that resolves the URL — and the dot
  // segments below would be looked straight past. Refused rather than folded to
  // "/", because a backslash in a mount is a mistake either way and silently
  // rewriting a caller's path is how the two answers diverge again.
  if (trimmed.includes("\\")) {
    throw new Error(
      `sitemap: basePath must not contain a backslash, got: ${basePath}`
    );
  }
  // A dot segment does not stay where it is written. URL resolution removes it
  // before the request is sent, so `/docs/../admin` mounts at `/admin` — the
  // prefix escapes itself and can land on a reserved root, and every entry under
  // it is then advertised somewhere the caller never named.
  //
  // Percent-encoded forms count: the URL standard decodes `%2e` to `.` for
  // exactly this purpose, so `%2e%2e` resolves away too and a check that read
  // only literal dots would pass the spelling written to evade it. Decided on
  // the SEGMENTS rather than by searching the string, so a legitimate name that
  // merely contains dots — `v1.2`, `file.tar.gz` — is untouched.
  const decoded = trimmed.replace(/%2e/gi, ".");
  if (decoded.split("/").some(seg => seg === "." || seg === "..")) {
    throw new Error(
      `sitemap: basePath must not contain "." or ".." segments, got: ${basePath}`
    );
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, "");
}

/**
 * Default path: `<basePath>/<slug>`, where `basePath` defaults to
 * `/<collection>`.
 *
 * ## The segments come from the ROUTE, not from a second opinion
 *
 * `slugToStaticParam` is the route's own answer to "what path does this stored
 * slug render at" — the same function `generateStaticParams` pre-renders from
 * and a page's canonical is built with. Deriving the sitemap's `<loc>` any
 * other way makes this module a second opinion on a question the route already
 * answers, and a second opinion names paths the route refuses: the two agree on
 * the day they are written and drift silently afterwards, because each looks
 * correct on its own.
 *
 * Three things follow from asking it, all of which a hand-rolled
 * `encodeURIComponent(slug)` got wrong:
 *
 * - **A multi-segment slug stays multi-segment.** `docs/getting-started` is a
 *   nested path the catch-all route serves; percent-encoding it whole produces
 *   `docs%2Fgetting-started`, one broken segment naming nothing.
 * - **An unaddressable slug is SKIPPED rather than advertised.** `..`, `a//b`
 *   and a leading slash all make the route return `null` — it will not serve
 *   them — so emitting a `<loc>` for them lists a URL that 404s or, worse,
 *   resolves somewhere else entirely.
 * - **A reserved path is skipped too**, for the same reason and by the same
 *   check, without this module keeping its own copy of the denylist.
 *
 * ## `null` means SKIP, and it still does
 *
 * Returned for an entry with no usable slug, exactly as before: without a slug
 * there is no stable URL, and emitting `<basePath>/` for every slugless row
 * would advertise duplicate, meaningless listing URLs.
 *
 * ## An empty slug is ALWAYS skipped, `basePath` or not
 *
 * An empty string is not "no slug" — to the route it is the root of wherever
 * this collection is mounted. But whether that root is SERVED depends on the
 * route file, which is not visible from here: a required `[...slug]` catch-all
 * matches no segments and answers `notFound()` there, while an optional
 * `[[...slug]]` serves it. Both shapes ship in this repository.
 *
 * `basePath` names the prefix, not the bracket count, so it cannot stand in for
 * that answer and this does not treat it as one. A site that does serve its
 * root lists it with a custom `urlFor`. Omitting a URL costs a listing;
 * advertising one that 404s costs indexing.
 */
export function defaultUrlForEntry(
  entry: Record<string, unknown>,
  collection: string,
  basePath?: string
): string | null {
  // Given the STORED SLUG, which is exactly what the route is given.
  //
  // 🔴 Not the mounted path, and the difference decides whether a `<loc>` is
  // ever served. The denylist reads as though it were about final URLs, so
  // asking it about `pages/admin` is the intuitive move — but the route never
  // sees that value. `createContentRoute` joins the CATCH-ALL PARAMS, which in
  // the App Router exclude the static mount prefix, and checks `isReservedPath`
  // on the result. A page stored as `admin` therefore reaches `notFound()`
  // whether it is mounted at the root or under `/pages`, so reasoning about the
  // mount here would advertise a URL the route refuses — this module's own
  // failure mode, reintroduced by a smarter-looking check.
  //
  // The input matches the route's input for that reason. That the route ignores
  // its own mount is the route's to change; agreeing with it is this module's
  // job, and disagreeing "correctly" still produces a dead link.
  const param = slugToStaticParam(entry.slug);
  if (param === null) return null;

  const declared = basePath !== undefined;
  const base = normalizeBasePath(declared ? basePath : `/${collection}`);

  if (param.slug.length === 0) {
    // An empty slug is the mount's own root, and whether that root is SERVED is
    // not something this module can find out. A required catch-all (`[...slug]`)
    // matches no segments at all, so its mount root 404s; an optional one
    // (`[[...slug]]`) serves it. Both shapes exist in this repository — the
    // playground's frontend route is required and its blocks route is optional —
    // and `basePath` names the prefix, not the bracket count.
    //
    // Emitting on a declared mount would have been inferring the second fact
    // from the first, so an empty slug is skipped and a site that does serve its
    // root maps it with `urlFor`. Omitting a URL costs a listing; advertising
    // one that 404s costs indexing, which is the trade this module exists for.
    return null;
  }

  // Only the ROUTE-DERIVED segments are encoded. The prefix is a caller-supplied
  // pathname that may already carry escapes, and encoding it again would turn
  // `/docs%20archive` into `/docs%2520archive` — a different mount.
  return `${base}/${param.slug.map(encodeURIComponent).join("/")}`;
}

/** XML-escape a text value for safe inclusion in an element body. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Narrow an unknown row to an indexable object without asserting a type. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resolve a urlFor path against the origin to a valid absolute URL, percent-
 * encoding any unsafe characters. Returns `null` when the path is unusable or
 * escapes the origin (a custom mapper returning an absolute/protocol-relative
 * value) — such an entry is dropped rather than advertised at a foreign URL.
 */
function resolveOnOrigin(path: string, baseOrigin: string): string | null {
  try {
    const resolved = new URL(path, baseOrigin);
    if (resolved.origin !== baseOrigin) return null;
    // Never publish credentials a custom mapper embedded (origin excludes them).
    if (resolved.username !== "" || resolved.password !== "") return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/** Normalize a stored timestamp to ISO-8601, or undefined when unusable. */
function toLastModified(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The managed service caps a page at 500 rows and drops a larger `limit`, so a
 * page never exceeds this — the pagination loop relies on the requested size
 * matching what comes back to know when to stop.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * The sitemap protocol allows at most 50,000 URLs (and 50 MB uncompressed) per
 * document. Collection is bounded to this so the single `<urlset>` is always
 * valid; sharding a larger corpus into a sitemap index belongs to the Next
 * delivery layer (`generateSitemaps()`).
 */
export const MAX_SITEMAP_URLS = 50_000;

/**
 * The sitemap protocol also limits an uncompressed document to 50 MB, so
 * collection stops before the serialized size would cross this even if the URL
 * count is under {@link MAX_SITEMAP_URLS} (long locations can hit the byte cap
 * first).
 */
export const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;

/** The sitemap protocol limits a single `<loc>` to 2,048 characters. */
export const MAX_LOC_LENGTH = 2048;

/** The columns the default mapper reads — passed as the response projection. */
const DEFAULT_SELECT: Record<string, boolean> = {
  slug: true,
  seo: true,
  updatedAt: true,
};

const XML_HEADER =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
const XML_FOOTER = `\n</urlset>`;

/** Serialize one resolved URL into its `<url>` line (shared by size accounting). */
function serializeUrlEntry({ loc, lastModified }: SitemapUrl): string {
  const lastmod = lastModified
    ? `<lastmod>${escapeXml(lastModified)}</lastmod>`
    : "";
  return `  <url><loc>${escapeXml(loc)}</loc>${lastmod}</url>`;
}

// UTF-8 byte length via the web-standard TextEncoder (no Node `Buffer`), so the
// size cap works in any runtime the agnostic plugin runs in.
const utf8Encoder = new TextEncoder();
const utf8Bytes = (value: string): number => utf8Encoder.encode(value).length;
const WRAPPER_BYTES = utf8Bytes(XML_HEADER) + utf8Bytes(XML_FOOTER);

/**
 * Resolve `baseUrl` to an origin, requiring an absolute http(s) origin with no
 * path, query, fragment, or credentials — per-entry paths belong in `urlFor`.
 * Rejecting a path avoids a doubled base like `https://x.com/cms/pages/a`, and
 * rejecting credentials avoids leaking them into a public `<loc>`.
 */
export function resolveBaseOrigin(baseUrl: string): string {
  const invalid = (): never => {
    // Redact any credentials before surfacing the value — this runs at
    // construction and the message can land in startup/deploy logs.
    let shown: string;
    try {
      const u = new URL(baseUrl);
      shown = `${u.protocol}//${u.host}${u.pathname}${u.search}${u.hash}`;
    } catch {
      shown = "<invalid>";
    }
    throw new Error(
      `sitemap: baseUrl must be an absolute http(s) origin with no path, ` +
        `query, fragment, or credentials (put per-entry paths in urlFor), ` +
        `got: ${shown}`
    );
  };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return invalid();
  }
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  const isOriginOnly =
    (url.pathname === "" || url.pathname === "/") &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  if (!isHttp || !isOriginOnly) return invalid();
  return url.origin;
}

/**
 * List every configured collection's PUBLISHED entries and map them to sitemap
 * URLs. Reads as system (a sitemap is public derived data), and pages through
 * ALL matches by advancing the 1-indexed `page` — no silent cap — so a large
 * collection is never truncated to a first-page slice. Entries flagged
 * `seo.noindex` are excluded: a page told not to be indexed does not belong in
 * the sitemap.
 *
 * The `status: published` filter is applied ONLY to collections with the
 * built-in draft/published lifecycle (`status: true`, read via
 * `getCollection`). A status-less collection has no unpublished state, so every
 * entry — all of which are live — is listed; the filter is skipped there rather
 * than applied to a same-named ordinary field. That mirrors the core's own
 * status handling (filter only when the lifecycle column exists).
 */
export async function buildSitemapUrls(
  services: SitemapServices,
  options: SitemapOptions
): Promise<SitemapUrl[]> {
  // A custom urlFor may read arbitrary fields, so only project the columns when
  // using the built-in mapper; a custom callback gets full rows.
  const usingDefaultUrlFor = options.urlFor === undefined;
  // `basePath` configures the DEFAULT builder's mount point; a custom `urlFor`
  // already owns the whole path, so the two never combine.
  //
  // Gated on `usingDefaultUrlFor` rather than only consulted there: a FUNCTION
  // basePath is caller code, and calling it when it cannot affect the result
  // runs whatever it does — and its `null` return would exclude a collection
  // that `urlFor` was going to map perfectly well, which is the documented
  // promise "ignored when urlFor is supplied" being broken by the mechanism
  // meant to honour it.
  const basePathFor = (collection: string): string | null | undefined => {
    if (!usingDefaultUrlFor || options.basePath === undefined) return undefined;
    return typeof options.basePath === "function"
      ? options.basePath(collection)
      : options.basePath;
  };
  const urlFor: UrlForEntry = options.urlFor ?? defaultUrlForEntry;
  const pageSize =
    options.pageSize && options.pageSize > 0
      ? Math.min(options.pageSize, MAX_PAGE_SIZE)
      : MAX_PAGE_SIZE;
  // The sitemap's own origin (scheme + host + port). Every `<loc>` is built from
  // it, and a canonical on a different origin is dropped rather than mixed in.
  // Rejects a non-origin/relative baseUrl up front so `<loc>` is never invalid.
  const baseOrigin = resolveBaseOrigin(options.baseUrl);
  // Only `undefined` takes the default; a supplied value (including 0 or a
  // negative) is honored so the wrapper guard below rejects an impossible cap
  // rather than silently substituting the 50 MB default. A non-finite value
  // (NaN/Infinity) would defeat both guards, so reject it explicitly.
  if (options.maxBytes !== undefined && !Number.isFinite(options.maxBytes)) {
    throw new Error(
      `sitemap: maxBytes must be a finite number, got: ${options.maxBytes}`
    );
  }
  const maxBytes =
    options.maxBytes === undefined
      ? MAX_SITEMAP_BYTES
      : Math.min(options.maxBytes, MAX_SITEMAP_BYTES);
  // Even an empty document is the wrapper, so a budget below it can never be
  // met — reject it rather than emit an over-cap wrapper-only document.
  if (maxBytes < WRAPPER_BYTES) {
    throw new Error(
      `sitemap: maxBytes (${maxBytes}) is smaller than the minimum ` +
        `document size (${WRAPPER_BYTES} bytes).`
    );
  }
  const urls: SitemapUrl[] = [];
  // Running serialized size (the wrapper plus each `<url>` line and its join),
  // so the document is bounded by BOTH the URL count and the byte limit.
  let byteSize = WRAPPER_BYTES;

  for (const collection of options.collections) {
    // Resolved once per collection, before any read: a `basePath` function
    // returning `null` excludes the collection outright, and paying for its
    // pages first would be work whose every row is then discarded.
    const collectionBasePath = basePathFor(collection);
    if (collectionBasePath === null) continue;
    // Validated HERE as well as at use, because the per-entry path builder only
    // runs once there is an entry: a collection that happens to be empty would
    // otherwise accept a malformed mount in silence and return an empty sitemap,
    // so whether a misconfiguration is reported would depend on the content.
    // Discarded on purpose — this call is the check, not the value.
    if (collectionBasePath !== undefined) normalizeBasePath(collectionBasePath);

    // Apply the published filter ONLY to collections with the built-in
    // lifecycle. A status-less collection has no unpublished state, and it may
    // even define an ordinary `status` field (e.g. "active"/"closed"), so a
    // blanket `status = published` filter there would wrongly drop live rows.
    const meta = await services.collections.getCollection(collection, {});
    const hasLifecycle = isRecord(meta) && meta.status === true;
    const where = hasLifecycle
      ? { status: { equals: "published" } }
      : undefined;

    // 1-indexed: the managed service reads by `page`, not `offset`, so the loop
    // MUST advance `page` — advancing an ignored `offset` would re-read page 1
    // forever while `hasMore` stayed true.
    let page = 1;
    for (;;) {
      const result = await services.collections.listEntries(
        collection,
        {
          where,
          depth: 0,
          ...(usingDefaultUrlFor ? { select: DEFAULT_SELECT } : {}),
          // Deterministic paging: without an explicit sort the service pages an
          // unordered query, so rows could repeat or vanish between pages. `id`
          // is unique and stable on every collection.
          sort: { field: "id", direction: "asc" },
          pagination: { limit: pageSize, page },
        },
        { as: "system" }
      );

      for (const row of result.data) {
        if (!isRecord(row)) continue;
        const seo = isRecord(row.seo) ? row.seo : undefined;
        // A noindexed page is intentionally kept out of the sitemap.
        if (seo?.noindex === true) continue;

        // Resolve the URL FIRST so `urlFor`'s exclusion contract is honored even
        // for an entry that also declares a canonical: a falsy path means no
        // stable URL (no slug, or a custom urlFor opted it out) — skip it.
        // Branched rather than passed as a third argument, so `UrlForEntry`
        // keeps the two parameters its callers actually implement: `basePath`
        // configures the DEFAULT builder's mount point and is structurally
        // unreachable when a custom mapper owns the whole path.
        const path = usingDefaultUrlFor
          ? defaultUrlForEntry(row, collection, collectionBasePath)
          : urlFor(row, collection);
        if (!path) continue;
        // Normalize the path through URL so a custom mapper's spaces/non-ASCII
        // are percent-encoded, and DROP an entry whose path escapes the origin
        // (an absolute or protocol-relative value a custom urlFor returned).
        let loc = resolveOnOrigin(path, baseOrigin);
        if (loc === null) continue;

        // A declared canonical overrides the generated URL, but only a same-
        // origin http(s) one with no credentials. The `canonical` field is free
        // text: resolve it against the origin (a relative `/about` becomes
        // absolute); ignore a non-http scheme (`mailto:`/`javascript:`/`data:`)
        // or embedded credentials, keeping the generated URL; and DROP the entry
        // when the canonical is on another origin.
        const canonical =
          typeof seo?.canonical === "string" ? seo.canonical.trim() : "";
        if (canonical) {
          let offOrigin = false;
          try {
            const resolved = new URL(canonical, baseOrigin);
            const isHttp =
              resolved.protocol === "http:" || resolved.protocol === "https:";
            const hasCreds =
              resolved.username !== "" || resolved.password !== "";
            if (isHttp && resolved.origin === baseOrigin && !hasCreds) {
              loc = resolved.href;
            } else if (isHttp && resolved.origin !== baseOrigin) {
              offOrigin = true;
            }
          } catch {
            // Malformed canonical → keep the generated URL.
          }
          if (offOrigin) continue;
        }
        // A `<loc>` over the protocol's 2,048-char limit is an invalid record —
        // drop it rather than emit a non-compliant entry.
        if (loc.length > MAX_LOC_LENGTH) continue;
        const entry: SitemapUrl = {
          loc,
          lastModified: toLastModified(row.updatedAt),
        };
        // Stop before the serialized size would exceed the byte limit — for the
        // FIRST entry too, so a single oversized URL never yields an over-limit
        // document. `+ 1` accounts for the newline joining entries.
        const entryBytes = utf8Bytes(serializeUrlEntry(entry)) + 1;
        if (byteSize + entryBytes > maxBytes) return urls;
        byteSize += entryBytes;
        urls.push(entry);
        // Bound the document to the protocol limits so the single `<urlset>`
        // stays valid; a larger corpus needs a sitemap index (delivery layer).
        if (urls.length >= MAX_SITEMAP_URLS) return urls;
      }

      if (!result.pagination.hasMore) break;
      page += 1;
    }
  }

  return urls;
}

/** Serialize resolved URLs into a sitemaps.org `<urlset>` document. */
export function serializeSitemap(urls: SitemapUrl[]): string {
  const body = urls.map(serializeUrlEntry).join("\n");
  return `${XML_HEADER}${body}${XML_FOOTER}`;
}

/** Build the full sitemap XML for the configured collections. */
export async function generateSitemap(
  services: SitemapServices,
  options: SitemapOptions
): Promise<string> {
  return serializeSitemap(await buildSitemapUrls(services, options));
}
