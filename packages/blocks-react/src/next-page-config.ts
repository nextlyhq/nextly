/**
 * What a Page Builder route is configured with: the blocks page's config, the
 * Single page's, the site content page's, and the site style inputs and the
 * derived SEO a route's callbacks are handed.
 *
 * Types, plus the one check that tells a site styles provider from a plain
 * value. The entry (`next.ts`) re-exports the public ones.
 *
 * @module next-page-config
 */
import type {
  BlockSeoContribution,
  DocumentLimits,
  SiteSheetInput,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { Metadata } from "next";
import type {
  ContentEntry,
  ContentRouteConfig,
  NextlyContentReader,
  NextlySingleReader,
  PublicSiteSettingsSource,
  RenderContext,
  SingleRouteConfig,
} from "nextly/runtime";
import type { ReactElement, ReactNode } from "react";

import type { ComponentSource } from "./component-source";
import type {
  BlockHostPolicy,
  BlocksDataProviderFactory,
  NamedQueryLookup,
  ResolvedMedia,
} from "./context";
import type { ImageCopies } from "./image-slot";
import type { BlocksLayoutsProvider } from "./next-layouts";
import type { BlockResolver } from "./resolver";
import type { PageStyles } from "./styles";

/**
 * The site-wide style inputs a route accepts: a full `SiteSheetInput` less the
 * breakpoint requirement, which may instead fall back to `styleContext`'s.
 */
export type SiteStylesInput = Omit<SiteSheetInput, "breakpoints"> &
  Partial<Pick<SiteSheetInput, "breakpoints">>;

/** A provider rather than a plain value: it states what its read depends on. */
export function isSiteStylesProvider(
  value: SiteStylesInput | SiteStylesProvider | undefined
): value is SiteStylesProvider {
  // A function is refused rather than falling through to the style-value
  // branch. TypeScript already rejects it, but a JavaScript caller following
  // older documentation would otherwise have their provider treated as
  // configuration: never invoked, its singles never tagged, and the page
  // quietly serving config defaults for ever. Failing at boot is the one
  // outcome that cannot be mistaken for working.
  if (typeof value === "function") {
    throw new TypeError(
      "siteStyles must be a value or { read, singles }; a bare function no longer states the singles its read depends on, so a cached page could not be invalidated."
    );
  }
  return typeof value === "object" && value !== null && "read" in value;
}

/**
 * A per-render site-style read, together with what it depends on.
 *
 * ONE unit, deliberately. Being called per render is not the same as being read
 * per render: a public blocks route is cacheable, so the whole render is what
 * is cached and only a tag the page carries rebuilds it — while a Direct API
 * read inside `read` contributes no tag at all. A provider whose dependencies
 * were a separate optional property left the unsafe configuration legal, and an
 * omission that silently serves a stale sheet is the kind of rule this codebase
 * asks to be enforced rather than documented.
 *
 * A plain value needs none of this: it cannot change after the module loaded,
 * so there is nothing for a write to invalidate.
 */
export interface SiteStylesProvider {
  /** Called once per render. Returning `undefined` means what omitting means. */
  read: () =>
    | SiteStylesInput
    | undefined
    | Promise<SiteStylesInput | undefined>;
  /**
   * The single slugs `read` consults, so a write to one busts this page. On a
   * public route the read is cached, tagged with these, and named by the route
   * and by this provider: these slugs and the source text of `read`. Two
   * providers one function makes over different inputs, on routes over the
   * same content, need their own `cacheScope`.
   *
   * Nextly's write path revalidates `nextly:single:<slug>`; naming the slug
   * here is what puts that tag on the route, exactly as `mediaCollection` does
   * for the media reader. An empty array is a statement rather than an
   * omission: this provider reads no singles.
   */
  singles: readonly string[];
}

/**
 * Config for {@link createBlocksPage}.
 *
 * Everything {@link ContentRouteConfig} accepts, minus `render` — supplying
 * that is the whole point of this helper — plus what the renderer needs.
 */
export interface BlocksPageConfig
  extends Omit<ContentRouteConfig<ReactElement>, "render"> {
  /**
   * The field holding the block document, e.g. `"content"`.
   *
   * Required rather than defaulted. A default would be a guess at the site's
   * schema, and guessing wrong renders a blank page instead of an error — the
   * least debuggable outcome available. Naming it costs one line and makes a
   * mismatch loud instead (see {@link readDocument}).
   */
  field: string;
  /**
   * A booted Nextly instance, or a reader of one (defaults to
   * `requireNextly()`). The page's records AND the site settings it shows,
   * its site name, address, logo and the time zone its dates and day filters
   * use, are read through it, so a process serving several sites, each
   * through an instance of its own, shows each page its own site.
   *
   * A reader of your own forwards `publicSiteSettings` from the instance, as
   * it forwards `find`. One that does not shows the process's registered
   * instance's settings, as before, and the route warns once that on a
   * process serving several sites they are another site's. Routes over
   * different instances in one process also need their own `cacheScope`: the
   * site settings are cached under it, as every public read of the route is.
   */
  nextly?: NextlyContentReader & Partial<PublicSiteSettingsSource>;
  /** Where block definitions come from. Defaults to the process registry. */
  blocks?: BlockResolver;
  /**
   * The stylesheet compiled when this entry was saved.
   *
   * A function rather than a value because the sheet belongs to the ENTRY, and
   * the route resolves a different entry per path. Returning `undefined` falls
   * through to `styleContext`.
   */
  styles?: (
    entry: ContentEntry,
    context: RenderContext
  ) => PageStyles | undefined | Promise<PageStyles | undefined>;
  /**
   * Compile the stylesheet during the render instead, for a site with no stored
   * artifact yet. Ignored for an entry whose `styles` produced a sheet.
   */
  styleContext?: StyleCompileContext;
  /**
   * The site's design tokens, fonts and named classes — the sheet every page
   * shares, emitted before the page's own.
   *
   * **A route supplies this by DEFAULT, unlike the bare renderer.** Omitting it
   * still emits the default token set, because a `{ $token }` that resolves to
   * nothing is the defect this exists to close and a framework route is exactly
   * where "it should already work" is the right answer. `PageRenderer` stays
   * opt-in because a standalone consumer owns its own `<head>` and may already
   * emit a token sheet of its own; a Nextly route owns neither.
   *
   * Making it a default was licensed by measurement rather than assumed safe:
   * no block declares a token (enforced by a ratchet over every `baseStyles`),
   * and no seeded or fixture document references one — so there is nothing whose
   * appearance can change by the definitions arriving. When that stops being
   * true, the honest move is to measure again rather than to reason about it.
   *
   * `breakpoints` falls back to `styleContext`'s, because a site that stated its
   * breakpoints once should not have to state them twice — and two answers to
   * "what are this site's breakpoints" is how the shared sheet and the page
   * sheet come to disagree about which at-rules a tier is emitted under.
   *
   * **A PROVIDER is read per render**, for a site whose style inputs live in
   * storage: a route module's config is captured once per server process, so a
   * plain value here freezes an admin's saved tokens at whatever they were when
   * the module loaded, and the edit would reach the next deploy instead of the
   * next page view.
   *
   * ```ts
   * siteStyles: {
   *   read: () => loadSiteStyle({ nextly, defaults }),
   *   singles: [SITE_STYLE_SLUG],
   * }
   * ```
   *
   * `read` returning `undefined` means what omitting the value means. `singles`
   * is required rather than optional, and that is the whole point: being called
   * per render is not the same as being READ per render. A public blocks page
   * is cacheable, so the whole render is what is cached and only a tag the page
   * carries rebuilds it — and a Direct API read inside `read` contributes none.
   * Without naming the single, an admin's save invalidates a tag no cache entry
   * holds and the page keeps serving the old sheet, which is the same gap the
   * media collection is in the tag list for. State `singles: []` for a provider
   * that genuinely reads no singles.
   *
   * A bare function is NOT a provider and is refused at boot rather than read
   * as a style value, because a JavaScript caller passing one would otherwise
   * have it silently treated as configuration and lose both the stored styles
   * and their invalidation.
   */
  siteStyles?: SiteStylesInput | SiteStylesProvider;
  /**
   * A dynamic collection to resolve media ids against, for a site storing its
   * images in one of its own.
   *
   * Omit it for ordinary Nextly media: those live in a system table with its
   * own reader, not in a dynamic collection, so the default path asks the
   * media namespace rather than naming a collection at all.
   */
  mediaCollection?: string;
  /**
   * The collection component definitions are stored in.
   *
   * Named rather than discovered, and defaulted rather than required. The
   * page-builder plugin ships the collection this defaults to, so a site using
   * it configures nothing — and `blocks-react` must not import the plugin to
   * learn the name, because the renderer is usable without it and the
   * dependency would only run the other way.
   */
  componentCollection?: string;
  /**
   * The field a component definition's blocks live in.
   *
   * Its own option for the same reason `field` is one for the page: a default
   * would be a guess at the site's schema, and guessing wrong inlines nothing
   * while reporting every reference as unreadable.
   */
  componentField?: string;
  /**
   * Where definitions come from, for a host that does not store them in a
   * Nextly collection at all.
   *
   * Mirrors `resolveMedia`. Given one, this route reads nothing itself — so a
   * host supplying this owns the posture and the cache tags too, exactly as a
   * host supplying `resolveMedia` owns them for images.
   */
  resolveComponents?: ComponentSource;
  /** Resolve a media id yourself, instead of reading the media collection. */
  resolveMedia?: (id: string) => Promise<ResolvedMedia | null>;
  /**
   * Resolve an entry reference to a path, instead of reading its slug. Handed
   * the language the page is drawn in, where it has one, so the path is the
   * one the target is served at in that language.
   */
  resolveEntryPath?: (
    collection: string,
    id: string,
    locale?: string
  ) => Promise<string | null>;
  /**
   * How a page's lists read, as a function from the route's public reader to
   * a data provider.
   *
   * The reader is bound per render to the route's language and reads as an
   * anonymous visitor: published entries and public fields only, whatever the
   * provider asks. Absent, lists read through it directly
   * (`createDefaultDataProvider`). A provider object is refused when the route
   * is built, since one holding its own reader would decide who sees what by
   * itself.
   *
   * @example
   * ```ts
   * data: reader => createDefaultDataProvider(reader, { collections: ["posts"] }),
   * ```
   */
  data?: BlocksDataProviderFactory;
  /**
   * How many reads one page render may perform, shared by the whole page.
   *
   * Defaults to {@link DEFAULT_MAX_QUERIES}. A budget is not optional here the
   * way it is on a hand-built context: depth in a document becomes
   * MULTIPLICATION in reads, so three nested `core/collection-loop` blocks over
   * a hundred entries each is a million reads from one page view — and a route
   * helper is exactly where a page becomes reachable by anyone with a URL.
   *
   * A fresh budget is created PER RENDER. One shared across requests would
   * spend itself on the first few pages and serve every later request truncated.
   *
   * Pass `Infinity` to opt out, which is a deliberate statement that this route's
   * documents cannot nest loops.
   */
  maxQueries?: number;
  /**
   * Site-operator decisions the blocks enforce, such as which frame origins may
   * keep `allow-same-origin`.
   *
   * Forwarded to the renderer untouched. These are security posture rather than
   * content: a page editor must not be able to grant them from a prop, and a
   * document moved behind this route helper must not silently lose what the
   * standalone renderer was given.
   */
  hostPolicy?: BlockHostPolicy;
  /** Shown in place of an asynchronous block until its output arrives. */
  blockFallback?: ReactNode;
  /**
   * The time zone a bound date-time is shown in, as an IANA name such as
   * `Europe/Paris`. A calendar date is shown as its own day whatever this is.
   *
   * Absent, date-times are shown in UTC; a zone the runtime does not know is
   * logged and UTC is used. Never the server's own zone, which differs from
   * one host to the next.
   *
   * @experimental
   */
  timeZone?: string;
  /**
   * The site's named queries, which its pages' collection lists may take as
   * their source: `namedQueriesOf(pageBuilderPlugin)` from
   * `@nextlyhq/plugin-page-builder`, the queries that page builder
   * registered for this site. Absent, the route knows of none, and a list
   * naming one shows its empty state.
   *
   * @experimental
   */
  namedQueries?: NamedQueryLookup;
  /**
   * Resized copies of the site's images: `pageBuilderImageCopies(plugin)` from
   * `@nextlyhq/plugin-page-builder`, which asks the site's media for them.
   * Given, each Image block offers copies sized to where it sits (`srcset`
   * and `sizes`) and never sends one more than twice its widest drawn width,
   * and the images in the page's first block load first. Absent, or for an
   * image no copy can be had of, the original is drawn as it always was.
   *
   * @experimental
   */
  imageCopies?: ImageCopies;
  /**
   * The caps this site holds its documents to, used while repairing a stored
   * shape. Passed to the renderer AND used when deriving metadata, so a site
   * that raised `maxNodes` for long pages does not have its metadata derived
   * from a tree truncated against the default.
   */
  limits?: DocumentLimits;
  /**
   * Page metadata, given what the document says about itself.
   *
   * `derived` carries the title, description and image the blocks offered plus
   * the page's canonical path, so the usual call is a one-liner:
   *
   * ```ts
   * metadata: (entry, ctx, derived) => buildMetadata(entry, { fallback: derived })
   * ```
   *
   * Named `metadata` rather than `buildMetadata` because it is not that
   * function: `buildMetadata` maps an entry's SEO group and knows nothing about
   * blocks, and this is where the two are joined. Supplying it replaces the
   * route's own `buildMetadata`, which cannot see the document at all.
   */
  metadata?: (
    entry: ContentEntry,
    context: RenderContext,
    derived: DerivedPageSeo
  ) => Metadata | Promise<Metadata>;
  /**
   * Draw each page inside its Layout: the header region, the page, then the
   * footer region. OFF unless given, and a route without it renders exactly
   * what it did before.
   *
   * A PROVIDER, for the reason `siteStyles` takes one: the site's default
   * Layout is stored, so it is read per render, and the read has to state the
   * Singles it depends on so a change to the default reaches the cached pages
   * that use it. The page-builder plugin supplies one:
   *
   * ```ts
   * import { pageBuilderLayouts } from "@nextlyhq/plugin-page-builder";
   *
   * createBlocksPage({ collections: ["pages"], field: "content", layouts: pageBuilderLayouts() });
   * ```
   *
   * Which Layout a page gets is the engine's `resolvePageLayout`: no regions
   * when the page switches them off, else the Layout it names while that is
   * published, else the site's default while that is published, else none
   * (logged, and the page still renders). Each region is the component the
   * Layout names for that area, drawn read-only through the same composition
   * path as a component placed on the page, sharing the page's query budget,
   * locale and posture.
   *
   * What a page's cache entry carries is what that page read: the id of the
   * Layout it asked for (even one the read did not find, so a page falling
   * back from an unpublished Layout refreshes when it publishes), the ids of
   * the components its regions draw, and — only on pages that depend on the
   * default — the provider's Singles and the default Layout's id. Never the
   * whole Layouts collection, so publishing one Layout rebuilds only the pages
   * drawn inside it.
   *
   * Metadata never reads the regions: a header's `<h1>` does not become the
   * page's title.
   *
   * Not offered on a Single's route, which has no Layout of its own to name.
   *
   * @experimental New public surface: its name and shape may change before it
   * is marked stable.
   */
  layouts?: BlocksLayoutsProvider;
}

/**
 * What a page's own blocks say about it, for a caller composing metadata.
 *
 * Exposed rather than kept private because the derivation is useful wherever an
 * entry's SEO fields are blank, and a caller wanting it otherwise would have to
 * re-walk the document with its own copy of the rules.
 */
export interface DerivedPageSeo extends Omit<BlockSeoContribution, "image"> {
  /**
   * The resolved picture, when one resolved.
   *
   * Narrowed from the contribution's `string | readonly string[]`, which is the
   * PRE-resolution shape: candidates have already been tried in order by the
   * time a caller sees this. Leaving the union exposed made the documented
   * `buildMetadata(entry, { fallback: derived })` call fail to typecheck, since
   * that option takes a single string — a public type describing an internal
   * stage rather than what the caller holds.
   */
  image?: string;
  /**
   * The title a shared link shows, where the document's own metadata gives
   * one; the page's title otherwise. Blocks offer none.
   */
  socialTitle?: string;
  /**
   * The path the page renders at, for a canonical URL.
   *
   * Absent when the stored slug is not addressable — one holding a `.`/`..`
   * segment, or a reserved path. A canonical is a claim about where this page
   * lives, and for those slugs every candidate answer names a DIFFERENT route,
   * so saying nothing is the only honest option.
   */
  canonical?: string;
}

/**
 * Config for {@link createSinglePage} and {@link createPublicSinglePage}.
 *
 * The blocks options are the page route's, minus everything that only means
 * something when a path is being RESOLVED. A Single is not looked up by slug, so
 * `collections`, `slugField` and `staticParamsLimit` have nothing to act on, and
 * `status` is the collection lifecycle's, which a Single route does not scope.
 *
 * `draft` is omitted from the page route's set and RE-DECLARED below, because
 * the two hooks answer differently shaped questions: a collection's returns the
 * entry id the route must then compare against the row a path resolved to, and a
 * Single has no path and no id to compare.
 */
export interface BlocksSinglePageConfig
  extends Omit<
    BlocksPageConfig,
    | "collections"
    | "nextly"
    | "slugField"
    | "staticParamsLimit"
    | "status"
    | "draft"
    | "buildMetadata"
    // A Single is not a page drawn inside a Layout: it has no Layout field of
    // its own to name one, and its route is not where the site's pages live.
    | "layouts"
  > {
  /** Which Single to serve, by its slug. */
  slug: string;

  /**
   * Whether this request may read the Single's pending working draft.
   *
   * Without it the route serves the published document only, so a preview link
   * verifies, redirects, and then answers 404 from a page that looks entirely
   * correct — indistinguishable, to the reviewer who opened it, from a link that
   * had expired.
   *
   * @example
   * ```ts
   * import { previewSingleDraftGate } from "nextly/runtime";
   *
   * createSinglePage({ slug: "homepage", draft: previewSingleDraftGate() });
   * ```
   *
   * `createPublicSinglePage` refuses it, because a draft read is per-visitor and
   * uncacheable while that factory exists to be cached and pre-rendered.
   */
  draft?: SingleRouteConfig<ReactElement>["draft"];

  /**
   * The collections this route's trust extends to when it populates
   * relationships. Defaults to nothing — see
   * `SingleRouteConfig.trustedCollections`, which this forwards to verbatim.
   *
   * It matters most alongside `draft`: the grant names one document and says
   * nothing about what that document points at, so without a bound a previewed
   * Single hands its reader every related record it touches.
   */
  trustedCollections?: SingleRouteConfig<ReactElement>["trustedCollections"];
  /*
   * No `user`, deliberately, and for the same reason the page route has none:
   * these helpers read anonymously or trusted, and offering an identity here
   * would make the two sides of one pair disagree about what a route can be.
   * A page scoped to a signed-in reader builds on `createSingleRoute` directly.
   */
  /**
   * A booted Nextly instance.
   *
   * Wider than the page route's reader, and necessarily so: the Single itself is
   * read with `findSingle`, while the blocks INSIDE it resolve media and loop
   * over collections through `find`/`findByID`. A reader carrying only one of
   * the two renders either a blank page or a page with no pictures, and neither
   * says which half was missing.
   *
   * The site settings the page shows are read through it too, as on the page
   * route: a reader of your own forwards `publicSiteSettings`, or the page
   * shows the process's registered instance's and the route warns once.
   */
  nextly?: NextlyContentReader &
    NextlySingleReader &
    Partial<PublicSiteSettingsSource>;
}

/**
 * The document a path is served from, as the site's address store answers:
 * a page, or a collection's entry served under its template address.
 *
 * @experimental Settles with collection templates.
 */
export interface ContentAddressHolder {
  /** The collection holding the address. */
  readonly collection: string;
  /** The holding document's id. */
  readonly id: string;
  /**
   * `"space"` when the path is a later page of the holder's paginated list
   * rather than its own address. Absent means its own address.
   */
  readonly kind?: "address" | "space";
}

/**
 * A collection's published template, the document an entry's page is drawn
 * with.
 *
 * @experimental Settles with collection templates.
 */
export interface ContentTemplate {
  readonly id: string;
  /** The template's block document. */
  readonly document: unknown;
}

/**
 * Config for {@link createContentPage} and {@link createPublicContentPage}.
 *
 * The page builder supplies every option but `pages`:
 *
 * ```ts
 * import { pageBuilderContent } from "@nextlyhq/plugin-page-builder";
 *
 * createContentPage({
 *   pages: { collections: ["pages"], field: "content", draft: previewDraftGate() },
 *   ...pageBuilderContent(),
 * });
 * ```
 *
 * @experimental Settles with collection templates.
 */
export interface ContentPageConfig {
  /**
   * How a page is drawn, as {@link createBlocksPage} takes it. An entry's
   * page is drawn with the same options (blocks, styles, Layouts, limits,
   * metadata), with the design serving it as the document: its own published
   * design, or else its collection's published template. A stored
   * page stylesheet (`styles`) is a page's own and is not used for an entry,
   * whose sheet is compiled from `styleContext`.
   */
  readonly pages: BlocksPageConfig;
  /**
   * Who holds `path` in `locale`: the path as served (the route's
   * `mountPath` included, each segment percent-encoded), and the route's
   * `locale`, absent for the site's default. Null when nothing does, which
   * answers not found.
   */
  readonly resolveAddress: (
    locale: string | undefined,
    path: string
  ) => Promise<ContentAddressHolder | null>;
  /**
   * Each collection's published template, each entry's own published design,
   * and where both are kept.
   */
  readonly templates: {
    /** The templates collection, whose writes refresh the pages they draw. */
    readonly collection: string;
    /**
     * `collection`'s published template, as the public reads it, or null
     * when it has none.
     */
    readonly read: (
      collection: string,
      locale: string | undefined
    ) => Promise<ContentTemplate | null>;
    /**
     * What draws the entry `id` of `collection`, as the public reads it: the
     * entry's own design where it has a published one, else the collection's
     * published template, else null. A draft own design is never answered.
     * Absent, every entry is drawn with its collection's template, as
     * {@link read} answers it.
     *
     * @experimental Settles with entries' own designs.
     */
    readonly readFor?: (
      collection: string,
      id: string,
      locale: string | undefined
    ) => Promise<ContentTemplate | null>;
  };
  /**
   * The addresses collections' entries hold in `locale` under the path
   * `under` (the route's mount, as segments; none for the site's root), as
   * path segments, at most `limit` of them: what
   * {@link createPublicContentPage} pre-renders beside the pages, which the
   * pages route lists itself. Absent, it pre-renders the pages alone and
   * renders each entry on its first request.
   */
  readonly addresses?: (
    locale: string | undefined,
    limit: number,
    under: readonly string[]
  ) => Promise<readonly (readonly string[])[]>;
  /**
   * The collections whose writes change who holds an address, so the public
   * route's cached lookup of a path is refreshed by a write to any of them.
   * The pages and the templates are always among them.
   */
  readonly addressCollections?: () => Promise<readonly string[]>;
  /**
   * The path the document `id` of `collection` is served at in `locale`, or
   * null when it is served nowhere: where a block's link to it points, on a
   * page and on an entry's page alike, unless `pages.resolveEntryPath` says
   * otherwise. Absent, a link is the target's slug, as a pages route makes
   * it.
   */
  readonly entryPath?: (
    collection: string,
    id: string,
    locale: string | undefined
  ) => Promise<string | null>;
  /**
   * How the route answers a path it has nothing for, in place of Next.js's
   * `notFound()`, for a page and an entry alike: a site passes its own to do
   * something for each miss, such as logging the address. The page and
   * `generateMetadata` may both call it for one request. A handler that
   * returns is followed by Next.js's `notFound()`; without one the route
   * answers as before. `pages.notFound` is used where this is absent.
   *
   * @experimental Its name and shape may change before 1.0.
   */
  readonly notFound?: () => never | Promise<never>;
}
