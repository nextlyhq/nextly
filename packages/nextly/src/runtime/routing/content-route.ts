/**
 * `createContentRoute` — a thin factory for a single `app/[[...slug]]/page.tsx`
 * optional catch-all that resolves ANY path to a published content entry (the
 * pages-collection model: add an `/about` entry and it just works).
 *
 * You keep the route file; this fills the body. It returns `generateStaticParams`
 * (pre-render published paths, with `dynamicParams` handling the rest),
 * `generateMetadata`, and the page component — which resolves the path across the
 * configured collections, calls `notFound()` on a genuine miss or a reserved
 * path, and otherwise renders your component with the resolved entry.
 *
 * `next`/`react` imports are TYPE-ONLY and `next/navigation` is resolved lazily,
 * so importing this never forces those onto a non-Next consumer at load.
 *
 * `generateStaticParams` returns `[]` when there is nothing to pre-render (a
 * `staticParamsLimit` of `0`, or no published slugs yet), which is valid for
 * standard App Router builds. Next 16 Cache Components is stricter: an EXPORTED
 * `generateStaticParams` must return at least one entry. Under that mode, do not
 * wire `generateStaticParams` into the route file for a no-prerender/empty-site
 * setup — export only `ContentPage` and `generateMetadata` and let paths render
 * on demand.
 *
 * @module runtime/routing/content-route
 */
import { createRequire } from "node:module";

import type { Metadata } from "next";

import { getNextly } from "../../direct-api/nextly";
import { NextlyError } from "../../errors/nextly-error";

import { isReservedPath } from "./reserved-paths";
import {
  resolveContent,
  type ContentEntry,
  type NextlyContentReader,
} from "./resolve-content";

/** Where a resolved entry was found. */
export interface ResolvedContext {
  /** The collection the entry was resolved from. */
  collection: string;
  /** The joined slug path (no leading slash), e.g. `"about/team"`. */
  slug: string;
}

/**
 * What `render` and `buildMetadata` receive: where the entry was found.
 *
 * Deliberately NOT a reader. An earlier version carried the instance this route
 * resolved through, so a render needing a second read did not have to obtain
 * one of its own. The Direct API is a TRUSTED surface — access bypassed,
 * lifecycle unfiltered, no locale — and a route is the opposite, so handing one
 * to a callback meant re-binding every attribute it carries: access, both
 * identity channels, lifecycle and locale, each of which failed independently.
 *
 * A caller that genuinely needs a second read passes its own instance as
 * `nextly` and uses it directly, where the posture is visibly theirs to choose
 * rather than inherited from a field that looks like a convenience.
 */
export interface RenderContext extends ResolvedContext {
  /**
   * The locale this route read in, when it was configured for one.
   *
   * Carried explicitly rather than read back off the row: the companion
   * overlay copies localized values ONTO the entry without stamping which
   * locale they came from, so a render inferring it from the row would find
   * nothing on exactly the localized pages that need it — and a block or data
   * provider reading in a different language than the page around it is a
   * mismatch nothing surfaces as an error.
   */
  locale?: string;
}

/**
 * Config for {@link createContentRoute}. `TNode` is the render output (your
 * server component's return, e.g. `ReactNode`) — inferred from `render`, so
 * `nextly` needs no `react` dependency of its own.
 */
export interface ContentRouteConfig<TNode> {
  /**
   * Collections to resolve a path against, in order — the first collection with
   * a published entry whose slug matches the path wins. A status-less collection
   * (no built-in lifecycle) works automatically: the `status` scope is a no-op
   * there, so it can be mixed freely with lifecycle collections.
   */
  collections: string[];
  /** Render the resolved entry (your server component body). May be async. */
  render: (
    entry: ContentEntry,
    context: RenderContext
  ) => TNode | Promise<TNode>;
  /** Optional per-entry metadata (e.g. via `buildMetadata`). */
  buildMetadata?: (
    entry: ContentEntry,
    context: RenderContext
  ) => Metadata | Promise<Metadata>;
  /** Field holding the slug (default `"slug"`). */
  slugField?: string;
  /**
   * Draft/Published lifecycle scope for the resolved reads (default
   * `"published"`). Lifecycle- and locale-aware; a no-op on status-less
   * collections.
   */
  status?: "published" | "draft" | "all";
  /**
   * Whether this request may see pending unpublished edits at THIS path.
   *
   * Almost always a function, because route config is captured once at module
   * scope while whether a visitor is previewing is a per-request fact. It is
   * asked for every path the route resolves, and is handed the collection and
   * slug being resolved so the answer can be scoped to a document.
   *
   * **The argument is the point, not a convenience.** Next's draft mode is a
   * single boolean for the whole host — `draftMode().isEnabled` says a visitor
   * opened *a* valid preview link, never *which* document it was for. Answering
   * from that alone turns a link scoped to one unpublished page into a key to
   * every unpublished page in the configured collections for the life of the
   * session, which is precisely what the preview token's scope exists to
   * prevent. Compare it against what the token actually granted:
   *
   * ```ts
   * draft: async ({ collection, slug }) => {
   *   const scope = await readPreviewScope(previewConfig);
   *   if (scope === null || scope.collection !== collection) return false;
   *   if (slug !== (await slugOf(scope.collection, scope.entryId))) return false;
   *   return { entryId: scope.entryId };
   * }
   * ```
   *
   * Name the entry rather than returning a bare `true`. A slug is not unique,
   * so a boolean grants whichever row this route resolves the path to, which
   * need not be the one the token was minted for; `{ entryId }` is checked
   * against the document that was actually resolved.
   *
   * **Returning `true` is an authorization decision, not a display
   * preference.** This route always resolves anonymously, and the working-draft
   * overlay is gated on an update-capability probe an anonymous read can never
   * pass — so a request this returns `true` for is read TRUSTED, exactly as
   * Payload pairs `draft: isDraftMode` with `overrideAccess: isDraftMode`. Put
   * the authorization here, never in a query parameter the visitor controls.
   *
   * A literal `true` is accepted for a route mounted behind the app's own auth,
   * and means every visitor sees unpublished content at every path. It is
   * almost never what a public site wants.
   *
   * `generateStaticParams` ignores this entirely — draft paths are never
   * pre-rendered.
   *
   * @default false
   */
  draft?:
    | boolean
    | ((context: ResolvedContext) => DraftGrant | Promise<DraftGrant>);
  /**
   * Read this locale on localized collections, and report it to `render` and
   * `buildMetadata` as `context.locale`. Omit for the default locale.
   */
  locale?: string;
  /** Relation depth for the resolved read (default `1`). */
  depth?: number;
  /** A booted Nextly instance (defaults to `getNextly()`). */
  nextly?: NextlyContentReader;
  /**
   * Extra cache tags attached to every resolved read, so a write to a related
   * collection (a populated author, category, media) can bust the page. The
   * primary collection is always tagged; add the related collections' tags
   * (e.g. `nextlyTags("authors")`) here when you render populated relations.
   */
  tags?: string[];
  /** Time-based revalidation seconds for the resolved read. */
  revalidate?: number | false;
  /**
   * A stable discriminator folded into the resolved read's cache key — supply
   * one when distinct `nextly` readers (per-tenant/per-database) can resolve the
   * same collection + slug, so their cached reads never alias.
   */
  cacheScope?: string;
  /**
   * Max published paths to pre-render per collection in `generateStaticParams`
   * (default `1000`). The rest render on demand via `dynamicParams`.
   */
  staticParamsLimit?: number;
}

/**
 * What a draft decision may answer.
 *
 * `true` grants the draft at this path unconditionally. `{ entryId }` grants it
 * for ONE document, and the route discards the draft if the path resolved to a
 * different one — which matters because a slug need not be unique: the resolver
 * deliberately supports duplicates and settles them by sorting on `id`, so a
 * token issued for one entry could otherwise reach another that shares its slug.
 *
 * A preview token names an entry, so `{ entryId: scope.entryId }` is the shape
 * to return when one backs the decision.
 */
export type DraftGrant = boolean | { entryId: string };

/** The optional-catch-all route arg: `{ params: Promise<{ slug?: string[] }> }`. */
export interface ContentRouteArgs {
  params: Promise<{ slug?: string[] }> | { slug?: string[] };
}

/**
 * What a route always returns — wire these into the route file.
 *
 * Deliberately without `generateStaticParams`. A route reading access-enforced
 * content answers differently per visitor, so no path it serves can be
 * pre-rendered, and offering the function anyway is not a harmless extra: Next
 * classifies a route as STATIC when it exports one, and every dynamic marking
 * inside a static render is an error. Measured — an access-enforced route
 * exporting it answered 500 on every path once its collection was empty at
 * build time, because an empty param list left nothing to bail out and degrade
 * the route to dynamic.
 */
export interface ContentRoute<TNode> {
  generateMetadata: (args: ContentRouteArgs) => Promise<Metadata>;
  ContentPage: (args: ContentRouteArgs) => Promise<TNode>;
}

/**
 * What a `content: "public"` route returns, additionally.
 *
 * Present only on this shape so a route that cannot pre-render cannot export
 * the function that claims it does. The check is the type system's rather than
 * a runtime warning nobody reads: destructuring `generateStaticParams` from an
 * enforced route does not compile.
 */
export interface StaticContentRoute<TNode> extends ContentRoute<TNode> {
  generateStaticParams: () => Promise<Array<{ slug: string[] }>>;
}

// `next/navigation` is resolved lazily (opaque to bundlers), so importing this
// module never forces `next` at load; `notFound()` throws the special error the
// App Router catches to render the not-found page.
let cachedNotFound: (() => never) | null | undefined;
function loadNotFound(): () => never {
  if (cachedNotFound === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("next/navigation") as { notFound?: () => never };
      cachedNotFound = typeof mod.notFound === "function" ? mod.notFound : null;
    } catch {
      cachedNotFound = null;
    }
  }
  if (!cachedNotFound) {
    // Outside a Next runtime there is no not-found boundary to trigger.
    throw NextlyError.internal({
      logContext: {
        reason:
          "createContentRoute requires next/navigation (use it inside a Next.js app)",
      },
    });
  }
  return cachedNotFound;
}

/** Trigger the App Router's not-found boundary; never returns (narrows callers). */
function triggerNotFound(): never {
  return loadNotFound()();
}

const MAX_STATIC_PARAMS_PER_PAGE = 500;

/**
 * Map a stored slug value to a static param, or `null` to skip it. An empty
 * slug is the site root (`/`) — emitted as the no-segment param so the homepage
 * pre-renders — while whitespace-only, non-string, and reserved values are
 * dropped (the page would only `notFound()` them).
 */
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
 * The instance, bound to the access policy this route resolved the entry with.
 *
 * The Direct API is a TRUSTED server surface: its documented default is
 * `overrideAccess: true`, because the ordinary caller is application code that
 * has already decided who is asking. A route is the opposite — it answers
 * whoever holds the URL — and it resolves its own entry with access enforced
 * and no user.
 *
 * Handing a render or metadata callback the raw instance therefore offers a
 * reader whose defaults are the inverse of the page's. A callback doing the
 * obvious thing — `context.reader.find({ collection: "authors" })` to name the
 * author of the post it is rendering — would read PAST the access rules that
 * governed the post itself, and publish restricted rows in a public response.
 *
 * So the defaults are restated to match the route: access enforced unless this
 * route resolved with it overridden, and no identity, because the route
 * resolves anonymously. A caller that genuinely wants the trusted surface can
 * still pass `overrideAccess: true` explicitly — the arguments win, since they
 * are spread over these defaults. What changes is which way the DEFAULT points,
 * and that is the direction a caller cannot see.
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

function buildRoute<TNode>(
  config: ContentRouteConfig<TNode>,
  content: "public" | "restricted"
): StaticContentRoute<TNode> {
  const slugField = config.slugField ?? "slug";
  const status = config.status ?? "published";
  const depth = config.depth ?? 1;
  // The secure default, unchanged: enforce unless the site says the content is
  // public. Naming the decision does not relax it.
  const isPublic = content === "public";
  const overrideAccess = isPublic;
  const staticParamsLimit = config.staticParamsLimit ?? 1000;

  const collections = [...new Set(config.collections)];

  const getInstance = (): NextlyContentReader => config.nextly ?? getNextly();

  /** Whether this request may see unpublished edits at one collection + slug. */
  async function draftForThisPath(
    context: ResolvedContext
  ): Promise<DraftGrant> {
    const decision = config.draft;
    if (decision === undefined) return false;
    return typeof decision === "function" ? decision(context) : decision;
  }

  /** Resolve the joined slug across the configured collections (first match wins). */
  async function resolve(
    slug: string
  ): Promise<{ entry: ContentEntry; context: RenderContext } | null> {
    for (const collection of collections) {
      // Asked per collection, not once per request: the answer is scoped to a
      // document, and the same slug can name a different document in each
      // configured collection.
      const grant = await draftForThisPath({ collection, slug });
      // A grant that NAMES an entry is resolved by that id rather than by slug,
      // so a duplicate slug cannot decide which document a preview opens. A
      // bare `true` names nothing and keeps the ordinary lookup.
      //
      // An object grant carrying no usable id authorizes NOTHING. The decision
      // is app-supplied code and the type is not a runtime guarantee, so a
      // `{}` reaching here would otherwise widen the lifecycle scope while
      // naming no entry to bound it, which is the one combination that must not
      // exist.
      const grantedEntryId =
        typeof grant === "object" &&
        grant !== null &&
        typeof grant.entryId === "string" &&
        grant.entryId !== ""
          ? grant.entryId
          : undefined;
      const draft = grant === true || grantedEntryId !== undefined;
      const entry = await resolveContent(collection, slug, {
        nextly: config.nextly,
        slugField,
        ...(config.locale ? { locale: config.locale } : {}),
        // `status` is left to widen itself when a draft is asked for, so a
        // route cannot end up previewing with only one of the two draft layers
        // switched on.
        ...(config.status ? { status: config.status } : {}),
        draft,
        ...(grantedEntryId === undefined ? {} : { entryId: grantedEntryId }),
        depth,
        tags: config.tags,
        revalidate: config.revalidate,
        cacheScope: config.cacheScope,
        // A draft request reads trusted. The overlay is gated on an
        // update-capability probe and this route resolves anonymously, so an
        // enforced draft read could only ever return the published row — the
        // silent no-op that makes preview look broken. The authorization that
        // justifies this lives in the `draft` decision itself.
        overrideAccess: overrideAccess || draft,
      });
      if (!entry) continue;
      // No identity check here, deliberately. Both halves a grant has to
      // satisfy — that it names THIS entry, and that the entry lives at THIS
      // path — are settled inside `resolveContent`, which reads by the granted
      // id and confirms the slug, and resolves published-only when either fails.
      // Re-comparing ids at this layer is what the by-id read replaced: it
      // compares a POST-`afterRead` document, so a collection that reshapes its
      // public read would fail a valid grant and send the editor to live
      // content.
      return {
        entry,
        context: {
          collection,
          slug,
          ...(config.locale ? { locale: config.locale } : {}),
        },
      };
    }
    return null;
  }

  async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
    // A non-positive limit disables pre-rendering entirely — every path then
    // renders on demand via `dynamicParams`. Return before querying so a `0`
    // limit yields zero params instead of one-per-collection.
    if (staticParamsLimit <= 0) return [];
    const nextly = getInstance();
    const params: Array<{ slug: string[] }> = [];
    for (const collection of collections) {
      let page = 1;
      let collected = 0;
      for (;;) {
        let result;
        try {
          result = await nextly.find({
            collection,
            // Lifecycle-aware publish scope — a no-op on status-less collections.
            status,
            // The same locale `resolve()` reads in. Without it a localized
            // route pre-renders DEFAULT-locale slugs — paths its own resolver
            // then answers with `notFound()` — while the slugs it does serve
            // are absent from the scan and left to render on demand.
            ...(config.locale ? { locale: config.locale } : {}),
            select: { [slugField]: true },
            // `id` is unique and present on every collection; `createdAt` may be
            // absent (timestamps off) or non-unique, letting rows shift between
            // pages and duplicate or vanish across the paginated scan.
            sort: "id",
            limit: MAX_STATIC_PARAMS_PER_PAGE,
            page,
            overrideAccess,
            // The build-time scan is anonymous — pass an explicit `undefined`
            // so it can't inherit a default user configured on the reader.
            user: undefined,
          });
        } catch (error) {
          // An access-restricted collection has no PUBLIC paths to pre-render —
          // skip it (its entries render on demand, enforced per request) rather
          // than fail the build. Any non-access error still surfaces.
          // `NextlyError.is` matches across bundled package copies.
          if (NextlyError.is(error) && error.statusCode === 403) break;
          throw error;
        }
        for (const item of result.items) {
          const param = slugToStaticParam(item[slugField]);
          if (!param) continue;
          params.push(param);
          collected += 1;
          if (collected >= staticParamsLimit) break;
        }
        if (collected >= staticParamsLimit || !result.meta.hasNext) break;
        page += 1;
      }
    }
    return params;
  }

  async function generateMetadata(args: ContentRouteArgs): Promise<Metadata> {
    if (!config.buildMetadata) return {};
    const slug = joinSlug(await args.params);
    if (isReservedPath(`/${slug}`)) return {};
    const resolved = await resolve(slug);
    if (!resolved) return {};
    return config.buildMetadata(resolved.entry, resolved.context);
  }

  async function ContentPage(args: ContentRouteArgs): Promise<TNode> {
    const slug = joinSlug(await args.params);
    // Never serve content at a framework/metadata path.
    if (isReservedPath(`/${slug}`)) triggerNotFound();
    const resolved = await resolve(slug);
    if (!resolved) triggerNotFound();
    return config.render(resolved.entry, resolved.context);
  }

  return { generateStaticParams, generateMetadata, ContentPage };
}

/**
 * A route over ACCESS-ENFORCED content — the secure default.
 *
 * The collections' read rules decide, so the answer depends on who is asking:
 * no read is cacheable and no path can be pre-rendered. **It therefore returns
 * no `generateStaticParams`, and that is the whole point.**
 *
 * Next classifies a route as STATIC because the export exists, and every
 * dynamic marking inside a static render is an error. An enforced route that
 * also exported one answered 500 on every path whenever its collection was
 * empty at build time — an empty param list left nothing to bail out and
 * degrade the route to dynamic, so its runtime behaviour depended on whether
 * the database had rows in it when the build ran. Not offering the function is
 * what makes that unrepresentable rather than merely discouraged.
 *
 * For public content that should be cached and pre-rendered, use
 * {@link createPublicContentRoute}.
 */
export function createContentRoute<TNode>(
  config: ContentRouteConfig<TNode>
): ContentRoute<TNode> {
  const { generateMetadata, ContentPage } = buildRoute(config, "restricted");
  return { generateMetadata, ContentPage };
}

/**
 * A route over PUBLIC content: trusted reads, cacheable, pre-renderable.
 *
 * Access rules are not consulted — the site has stated that everything in these
 * collections is public — which is what makes a read cacheable and a path
 * pre-renderable. Returns `generateStaticParams` for the route file to export.
 *
 * **Two functions rather than one flag, and the reason is measured.** Deciding
 * this through an option meant the return type had to vary with a value, which
 * costs contextual typing: every callback in the config object
 * (`render`, `buildMetadata`, `metadata`) loses its parameter types the moment
 * the config's type depends on an inferred generic. Choosing the posture by
 * calling a differently-named function keeps both signatures concrete, so
 * inference is untouched — and the name states the decision at the call site
 * rather than burying it in a string three lines down.
 */
export function createPublicContentRoute<TNode>(
  config: ContentRouteConfig<TNode>
): StaticContentRoute<TNode> {
  // Refused at construction, not tolerated at request time. Both of these make
  // the route dynamic while its `generateStaticParams` still tells Next it is
  // static — the same contradiction this split exists to remove, arriving
  // through a different option. A module-scope throw names the incompatible
  // pair at build; the alternative is a 500 on a page whose config looked fine.
  if (config.draft !== undefined && config.draft !== false) {
    throw new NextlyError({
      code: "CONFIGURATION_ERROR",
      statusCode: 500,
      publicMessage: "Server configuration error.",
      logMessage:
        "createPublicContentRoute() cannot serve drafts. `draft` makes every " +
        "resolved read uncached, which marks the render dynamic — but a public " +
        "route exports `generateStaticParams`, so Next classifies it static, and " +
        "a dynamic marking inside a static render is an error. Preview needs a " +
        "dynamic route: use `createContentRoute` with `draft`.",
    });
  }
  if (config.staticParamsLimit !== undefined && config.staticParamsLimit <= 0) {
    throw new NextlyError({
      code: "CONFIGURATION_ERROR",
      statusCode: 500,
      publicMessage: "Server configuration error.",
      logMessage:
        "createPublicContentRoute() cannot pre-render nothing. " +
        "`staticParamsLimit: 0` asks for a static route that builds no paths, so " +
        "`generateStaticParams` returns `[]` — which standard App Router builds " +
        "accept but Next 16 Cache Components rejects outright " +
        "(EmptyGenerateStaticParamsError). Use `createContentRoute` to render " +
        "every path on demand.",
    });
  }
  return buildRoute(config, "public");
}

/** Join the optional-catch-all segments into a slug path (no leading slash). */
function joinSlug(params: { slug?: string[] }): string {
  return (params.slug ?? []).join("/");
}
