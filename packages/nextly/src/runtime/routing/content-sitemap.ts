/**
 * `contentSitemapEntries` — the URLs a content route serves, as sitemap entries.
 *
 * Feeds {@link nextlySitemap}'s caller-supplied `entries`, which stays
 * caller-supplied so `nextly` need not depend on the SEO plugin. This is the
 * answer for content routes specifically; a site with other URL sources
 * concatenates them.
 *
 * **Beside the route rather than in a renderer package.** "Which URL does this
 * entry serve at" is a property of the ROUTE, not of what draws the page, so a
 * blocks page and any other content route must get the same answer. Putting it
 * next to `createContentRoute` is what stops the second renderer needing its own
 * copy of the rule — and a second copy is how a sitemap comes to advertise paths
 * the route does not serve.
 *
 * @module runtime/routing/content-sitemap
 */
import { getNextly } from "../../direct-api/nextly";
import { NextlyError } from "../../errors/nextly-error";

import { slugToStaticParam } from "./content-route";
import type { NextlyContentReader } from "./resolve-content";
import type { NextlySitemapEntry } from "./sitemap";

/**
 * The sitemap protocol's per-file ceiling: 50,000 URLs, and 50MB uncompressed.
 *
 * A file over it is rejected as a whole rather than truncated by the consumer,
 * so the count is enforced HERE, where the caller can be told which pages were
 * left out and what to do about it. Next's own answer for a larger site is
 * `generateSitemaps`, which splits by id.
 */
export const SITEMAP_MAX_URLS = 50_000;

/**
 * The protocol's other per-file ceiling: 50MB uncompressed.
 *
 * A document can cross it while well under the URL count — tens of thousands of
 * kilobyte-long paths do it — and a crawler rejects the file as a whole either
 * way, so counting URLs alone enforces half a limit. Measured against the URL
 * text rather than the serialized XML: the markup around each entry is roughly
 * constant and the paths are what vary without bound, so this tracks the term
 * that actually moves and leaves headroom for the rest.
 */
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Bytes of markup a sitemap spends on an entry beyond its URL.
 *
 * `<url><loc></loc></url>` plus indentation and an optional `<lastmod>`. A
 * deliberate over-estimate: this bounds a document that must not be rejected,
 * so erring high costs a shard boundary and erring low costs the whole file.
 */
const BYTES_PER_ENTRY_OVERHEAD = 120;

/**
 * The protocol's per-`<loc>` ceiling: 2,048 characters.
 *
 * A single stored slug can exceed it while the document is far under both
 * whole-file limits, and one over-long location makes the sitemap
 * non-compliant — so it is bounded per entry rather than only in aggregate.
 */
const MAX_LOCATION_LENGTH = 2048;

/**
 * Measures what the document will WEIGH, not how long the string is.
 *
 * `String.length` counts UTF-16 code units. The document is emitted as UTF-8,
 * where a non-ASCII path costs two to four bytes per character — so a mount or
 * slug outside ASCII, repeated across thousands of entries, crosses 50MB while
 * a length-based estimate is still comfortably under it.
 */
const encoder = new TextEncoder();

/**
 * Bytes this entry adds, including what XML escaping will cost.
 *
 * `&` and `<` in a stored slug become `&amp;` and `&lt;` in the document, so the
 * written size exceeds the URL's own. Measured on the escaped form rather than
 * estimated, because the expansion is unbounded in the worst case.
 */
function entryBytes(url: string): number {
  const escaped = url
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  return encoder.encode(escaped).length + BYTES_PER_ENTRY_OVERHEAD;
}

/** Rows read per query while paginating; the read asks for one column. */
const PAGE_SIZE = 500;

/** Options for {@link contentSitemapEntries}. */
export interface ContentSitemapOptions {
  /**
   * Collections to enumerate, in the order the route resolves them.
   *
   * The same list the route was configured with. A sitemap built from a
   * different list advertises paths the route will answer with `notFound()`, or
   * omits paths it serves, and nothing reports either.
   */
  collections: string[];
  /**
   * Absolute origin, e.g. `https://example.com`. Required by the sitemap
   * protocol, which does not accept a relative URL.
   */
  baseUrl: string;
  /**
   * Where the route is mounted, e.g. `/blocks` for `app/blocks/[[...slug]]`.
   * Defaults to the site root.
   */
  basePath?: string;
  /** Field holding the slug (default `"slug"`), matching the route's. */
  slugField?: string;
  /**
   * Lifecycle scope (default `"published"`).
   *
   * A sitemap lists what a visitor can reach, so the default is the published
   * scope rather than the route's — a route serving drafts to a previewing
   * editor must not advertise them to a crawler.
   */
  status?: "published" | "draft" | "all";
  /** Locale to read in, matching the route's. */
  locale?: string;
  /**
   * Whether the listed collections are PUBLIC, matching the route serving them.
   *
   * The same decision `createContentRoute` and `createPublicContentRoute` make
   * by which one you call, in the same words they use for it — because a
   * sitemap enumerating under a different posture than the route disagrees with
   * it in one direction or the other, and both are silent:
   *
   * - reading `"restricted"` for a PUBLIC route makes an anonymous scan of a
   *   collection whose stored policy denies anonymous access throw, so the
   *   whole collection is skipped and every page the route happily serves goes
   *   unlisted;
   * - reading `"public"` for a RESTRICTED route bypasses access control, and
   *   publishes the slugs of entries no visitor may read.
   *
   * REQUIRED rather than defaulted, deliberately. A safe default is exactly the
   * documented-rule-with-nothing-enforcing-it this repository has a rule about:
   * a caller serving public content who simply never met this option gets a
   * sitemap that silently omits every page whose collection denies anonymous
   * reads, and nothing anywhere reports it. Naming it costs one line and makes
   * the omission a compile error instead.
   *
   * It restates a decision the caller already made by choosing
   * `createContentRoute` or `createPublicContentRoute`, and TWO security-
   * sensitive values that must agree is a weaker arrangement than one. The
   * stronger form is for the route to hand back a sitemap function already
   * bound to its own posture, so there is nothing to keep in step; that changes
   * the public route surface and is filed rather than smuggled in here.
   */
  content: "public" | "restricted";
  /** Field carrying the last-modified timestamp, e.g. `"updatedAt"`. */
  lastModifiedField?: string;
  /** `changeFrequency` applied to every entry, if the site wants one. */
  changeFrequency?: NextlySitemapEntry["changeFrequency"];
  /** `priority` applied to every entry, if the site wants one. */
  priority?: number;
  /**
   * Maximum URLs to emit. Defaults to {@link SITEMAP_MAX_URLS}.
   *
   * Raising it past the protocol ceiling produces a file consumers reject.
   */
  limit?: number;
  /**
   * URLs to skip before collecting, for sharding with Next's `generateSitemaps`.
   *
   * `limit` alone cannot shard. Every invocation would start the same scan from
   * the beginning and return the same first `limit` URLs, so a site split into
   * four files would publish its first shard four times and never name the rest
   * — while looking exactly like a correctly sharded sitemap.
   *
   * Shard `n` is `{ offset: n * limit, limit }`, derived from the id
   * `generateSitemaps` hands the route:
   *
   * ```ts
   * export async function generateSitemaps() {
   *   return [{ id: 0 }, { id: 1 }];
   * }
   * export default async function sitemap(props: { id: number | Promise<string> }) {
   *   // Next 16 hands the id as a PROMISE; 14 and 15 hand it synchronously,
   *   // and this package supports all three. `await` accepts both, and the
   *   // conversion is what makes the arithmetic below real — multiplying the
   *   // un-awaited value yields NaN, which floors `offset` to nothing and
   *   // republishes the first shard from every file while looking correct.
   *   const shard = Number(await props.id);
   *   return contentSitemapEntries({
   *     ...config,
   *     offset: shard * 50_000,
   *     limit: 50_000,
   *   });
   * }
   * ```
   *
   * Counted in URLS EMITTED rather than rows read, so a row the route serves no
   * path for does not consume a shard's allowance and leave a gap between two
   * shards that each look full.
   */
  offset?: number;
  /**
   * Reader to use, for a per-tenant instance. Defaults to the process one.
   *
   * Narrowed to `find`, which is all this scan calls. Asking for a whole
   * `NextlyContentReader` would make a caller supply `findByID` and a media
   * namespace to build a list of URLs, and a wrapper written to satisfy a type
   * rather than a need is a surface nobody meant to expose.
   */
  nextly?: Pick<NextlyContentReader, "find">;
}

/**
 * Enumerate the published paths of one or more collections as sitemap entries.
 *
 * Paths come from {@link slugToStaticParam}, the route's own answer to what a
 * stored slug renders at, so a sitemap cannot name a path the route does not
 * serve. Re-deriving that rule here is exactly how the two would come to
 * disagree, and the disagreement is silent in both directions.
 */
export async function contentSitemapEntries(
  options: ContentSitemapOptions
): Promise<NextlySitemapEntry[]> {
  const {
    collections,
    baseUrl,
    basePath = "",
    slugField = "slug",
    status = "published",
    locale,
    lastModifiedField,
    changeFrequency,
    priority,
    content,
    limit = SITEMAP_MAX_URLS,
    offset = 0,
    nextly,
  } = options;

  // Whether the caller SUPPLIED an offset, not what it is. Passing one at all —
  // including the `0` shard zero gets — is the declaration that this call is one
  // shard of a deliberate split, and a boundary between shards is not a cut.
  //
  // No value of `entries.length` can separate the two: a non-final shard reads
  // one URL past its limit exactly as a truncated whole sitemap does, and the
  // URL it read is published by the next shard. Only the caller knows which
  // situation this is, so only the caller can say.
  const sharded = options.offset !== undefined;
  // Counted alongside the URLs, because the two ceilings are independent and
  // whichever is reached first decides.
  let bytes = 0;

  if (!Number.isFinite(limit) || limit <= 0) return [];
  // The protocol ceiling BINDS, whatever the caller asked for. A limit above it
  // produced a document consumers reject while the module documented the bound
  // it was not applying — the byte estimate does not save it, since 50,000
  // short URLs stay far under 50MB.
  const urlCap = Math.min(Math.floor(limit), SITEMAP_MAX_URLS);

  const reader = nextly ?? getNextly();
  const origin = requireOrigin(baseUrl);
  const mount = normalizeBasePath(basePath);
  const entries: NextlySitemapEntry[] = [];
  // URLs passed over for a lower shard. Counted here rather than translated
  // into a starting page, because a page holds ROWS and a row need not yield a
  // URL — so a page offset would drift from the URL offset by however many rows
  // the route serves no path for.
  let skipped = 0;
  // Two collections can hold the same slug, and the route resolves such a path
  // to the FIRST collection that answers. Emitting both would advertise one URL
  // twice, so the first wins here for the same reason it wins there.
  const seen = new Set<string>();

  for (const collection of collections) {
    let page = 1;
    for (;;) {
      let result;
      try {
        result = await reader.find({
          collection,
          status,
          ...(locale ? { locale } : {}),
          // One column, plus the timestamp when the caller asked for it. A
          // sitemap scan that inherited the route's depth would pull related
          // rows through their hooks and discard them.
          select: {
            [slugField]: true,
            ...(lastModifiedField ? { [lastModifiedField]: true } : {}),
          },
          // `id` is unique and present on every collection; a non-unique sort
          // lets rows shift between pages and duplicate or vanish across a
          // paginated scan.
          // A slug scan wants ONE column. The Direct API's relationship depth
          // defaults to 2, and expansion happens before selection — so without
          // this a 50,000-row scan issues relationship reads, and runs their
          // access checks and hooks, for rows discarded immediately.
          depth: 0,
          sort: "id",
          limit: PAGE_SIZE,
          page,
          // The route's posture, not a fixed one, and BOTH halves are needed
          // to mean it. The Direct API bypasses access control by DEFAULT, so
          // omitting this entirely is a trusted read wearing an anonymous
          // costume — it would list the slugs, and any timestamp asked for, of
          // entries no visitor may read, and the access branch below would
          // never be reached to skip that collection.
          overrideAccess: content === "public",
          user: undefined,
        });
      } catch (error) {
        // An access-restricted collection has no PUBLIC paths to advertise, so
        // skipping it is correct; failing the build over it is not.
        //
        // Matched on the CODE rather than the status, because 403 is shared:
        // `BUILDER_DISABLED` carries it too, and its own declaration says it is
        // "separate from FORBIDDEN: the caller's permissions are not the
        // problem". A status check would drop a whole collection for a failure
        // that says nothing about access, and say nothing about having done so.
        if (NextlyError.is(error) && error.code === "FORBIDDEN") break;
        throw error;
      }

      for (const item of result.items) {
        const param = slugToStaticParam(item[slugField]);
        if (!param) continue;
        // Each segment is ENCODED. A stored slug may legitimately hold a
        // space, `?`, `#`, `%` or `&`, and joining raw text changes what the
        // URL means: `docs/a?b` would advertise the path `/docs/a` carrying the
        // query `b`, which is not the path the route serves — besides producing
        // characters a sitemap document cannot carry.
        const path =
          param.slug.length > 0
            ? `/${param.slug.map(encodeURIComponent).join("/")}`
            : "";
        const url = `${origin}${mount}${path}`;
        // A location over the protocol's per-entry bound makes the document
        // non-compliant on its own, however small the file is. Skipped rather
        // than emitted: the route still serves that page, and one unlisted URL
        // is better than a sitemap a crawler discards whole.
        if (url.length > MAX_LOCATION_LENGTH) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        // Marked seen BEFORE the skip, so de-duplication spans shard
        // boundaries: a URL two collections both claim must be dropped by the
        // shard that skips it as well, or it reappears in the next one.
        if (skipped < offset) {
          skipped += 1;
          continue;
        }
        entries.push({
          url,
          ...lastModifiedOf(item, lastModifiedField),
          ...(changeFrequency ? { changeFrequency } : {}),
          ...(priority === undefined ? {} : { priority }),
        });
        // One PAST the limit before reporting a cut. Stopping at exactly
        // `limit` cannot tell a site with that many pages from one with more,
        // so a complete sitemap would announce that pages were omitted. The
        // extra URL is the evidence that some were, and it is dropped rather
        // than emitted.
        if (entries.length > urlCap) {
          return sharded
            ? entries.slice(0, urlCap)
            : truncated(entries, urlCap);
        }
        bytes += entryBytes(url);
        // The byte ceiling has no shard exemption. A URL count can be split
        // deliberately, but a document over 50MB is refused whatever the caller
        // intended, so this always reports — and it drops the entry that
        // crossed rather than emitting a file the crawler will reject.
        if (bytes > SITEMAP_MAX_BYTES) {
          return sharded ? shardOverByBytes(entries) : oversized(entries);
        }
      }

      if (!result.meta.hasNext) break;
      page += 1;
    }
  }

  return entries;
}

/**
 * Report the cut rather than returning a quietly short list.
 *
 * A sitemap that stops at the ceiling looks exactly like a site that has that
 * many pages, so nothing downstream can tell the difference and the missing
 * pages are simply never crawled. The result shape is fixed by the sitemap
 * protocol and has nowhere to carry a third state, so the signal goes where a
 * developer will meet it: the build log, naming the remedy.
 */
/**
 * A SHARD that hit the byte ceiling before its count.
 *
 * Reported rather than silently short, because it breaks the arithmetic the
 * caller is sharding by. Shard `n` starts at `n * limit`, so a shard that emits
 * fewer than `limit` entries leaves the next one starting past the URLs it
 * skipped — they are in no shard at all, and every file still looks complete.
 *
 * The document cannot simply be allowed over the ceiling: a crawler rejects it
 * whole. So the caller is told to lower `limit` until a shard fits, which
 * restores contiguity by making the count the binding constraint again.
 */
function shardOverByBytes(entries: NextlySitemapEntry[]): NextlySitemapEntry[] {
  const emitted = entries.slice(0, -1);
  console.warn(
    `[nextly] a sitemap shard reached the ${SITEMAP_MAX_BYTES}-byte protocol ` +
      `limit after ${emitted.length} URLs, before its own limit. Offsets are ` +
      `derived from the limit, so the NEXT shard starts past the URLs this one ` +
      `could not carry and they appear in no shard. Lower the limit until a ` +
      `shard fits within the byte ceiling.`
  );
  return emitted;
}

/**
 * Report a document stopped at the BYTE ceiling.
 *
 * Separate from {@link truncated} because the cause differs even though the
 * remedy does not: this one is reached by long paths rather than by many of
 * them, so a caller told only about the URL count would look at a sitemap well
 * under 50,000 entries and conclude the warning was wrong.
 *
 * No shard exemption, unlike the URL limit. A count can be split deliberately;
 * a document over the byte ceiling is refused whatever the caller intended.
 */
function oversized(entries: NextlySitemapEntry[]): NextlySitemapEntry[] {
  // Without the entry that crossed, rather than with it — emitting a document
  // known to be over the limit publishes something the crawler discards whole.
  const emitted = entries.slice(0, -1);
  console.warn(
    `[nextly] sitemap reached the ${SITEMAP_MAX_BYTES}-byte protocol limit at ` +
      `${emitted.length} URLs and stopped. Long paths cross this well before ` +
      `the 50,000-URL count, and a crawler rejects the whole document. Split ` +
      `it with Next's generateSitemaps, giving shard n its own offset and limit.`
  );
  return emitted;
}

function truncated(
  entries: NextlySitemapEntry[],
  limit: number
): NextlySitemapEntry[] {
  const emitted = entries.slice(0, limit);
  console.warn(
    `[nextly] sitemap reached its ${limit}-URL limit and stopped. ` +
      `Pages beyond it are absent and will not be crawled. ` +
      `Split it with Next's generateSitemaps, giving shard n ` +
      `{ offset: n * ${limit}, limit: ${limit} } — a lower limit alone restarts ` +
      `the same scan and republishes the first shard.`
  );
  return emitted;
}

/** The entry's timestamp, when the caller named a field carrying one. */
function lastModifiedOf(
  item: Record<string, unknown>,
  field: string | undefined
): { lastModified?: string | Date } {
  if (!field) return {};
  const value = item[field];
  // A Date passes through; a string is what most drivers return. Anything else
  // is omitted rather than coerced — `lastModified` is optional, and a wrong
  // date is worse for a crawler than an absent one.
  // PARSED, not merely non-empty. The field is named by the caller and may hold
  // anything a column does — a title, a slug, a malformed timestamp — and an
  // unparseable string emitted as `<lastmod>` is an invalid document rather
  // than a wrong date. Normalized to ISO so a driver's local-time or
  // space-separated form does not reach the file in a shape the protocol does
  // not define.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? {} : { lastModified: value };
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return { lastModified: parsed.toISOString() };
    }
  }
  return {};
}

/**
 * The origin, refused rather than concatenated when it is not one.
 *
 * The option's contract already required an absolute HTTP(S) origin, and a
 * contract nothing enforces is how `example.com` becomes a relative location in
 * every entry of a published document. Refused at the top, where the caller can
 * still be told which value was wrong — a sitemap full of malformed locations
 * is discovered by a crawler rather than by a build.
 *
 * Credentials, a query and a fragment are refused too: none is meaningful on a
 * sitemap origin, and the first would publish them.
 */
function requireOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw NextlyError.invalidInput({
      message: `contentSitemapEntries: baseUrl must be an absolute URL, received ${JSON.stringify(value)}.`,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw NextlyError.invalidInput({
      message: `contentSitemapEntries: baseUrl must use http or https, received ${JSON.stringify(value)}.`,
    });
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw NextlyError.invalidInput({
      message:
        "contentSitemapEntries: baseUrl must not carry credentials; they would be published in every location.",
    });
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw NextlyError.invalidInput({
      message: `contentSitemapEntries: baseUrl must be an origin without a query or fragment, received ${JSON.stringify(value)}.`,
    });
  }
  return trimTrailingSlash(parsed.origin + parsed.pathname);
}

/** `https://x.com/` and `https://x.com` must produce the same URLs. */
function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** `blocks`, `/blocks` and `/blocks/` all mount at `/blocks`. */
function normalizeBasePath(value: string): string {
  const trimmed = trimTrailingSlash(value.trim());
  if (trimmed === "") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
