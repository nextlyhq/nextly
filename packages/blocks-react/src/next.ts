/**
 * `@nextlyhq/blocks-react/next` — the Next.js-coupled surface.
 *
 * Separate from the package root so importing the renderer never pulls
 * `next/*` into a consumer's module graph. Everything that touches Next
 * (routing, metadata, draft mode) belongs here and nowhere else.
 *
 * This subpath is also where the CMS may be imported. The root entry renders a
 * document with nothing behind it; turning documents into ROUTES means
 * resolving a path to an entry, and resolving media and links means reading
 * records — both the CMS's job. Confining that here is what lets the root stay
 * usable in an app that has no Nextly at all.
 *
 * @module next
 */
import {
  bindingDemand,
  bindingKindOf,
  calendarDayIn,
  COLLECTION_LIST_TYPE,
  conditionDemand,
  conditionFieldKind,
  DEFAULT_LIMITS,
  LIST_ENTRY_SLOT,
  deriveSeoFromDocument,
  hashId,
  isFetchableUrl,
  isListDay,
  isPlainRecord,
  DOCUMENT_FORMAT_VERSION,
  mayPaginateList,
  paginatedList,
  type PaginatedList,
  regionDocument,
  resolveDocumentSeo,
  safeTimeZone,
  type BindingDemand,
  type BindingRun,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type ConditionDemand,
  type SourceDemand,
  type BlockSeoContribution,
  type DefinitionsById,
  type DocumentLimits,
  type LayoutRegion,
  type RemotePatternInput,
  type SeoImageCandidate,
  type SiteSheetInput,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { Metadata } from "next";
import {
  bindingFieldShapes,
  cacheComponentsEnabled,
  cachedFind,
  createContentRoute,
  createPublicContentRoute,
  createPublicReader,
  createPublicSingleRoute,
  createSingleRoute,
  entryIdTag,
  requireNextly,
  nextlyTags,
  releaseBoundedRevalidate,
  nextlySingleTags,
  nextlySiteSettingsTags,
  readPublicSiteSettings,
  LIST_PAGE_SEGMENT,
  openNamedQueryFrame,
  slugToPath,
} from "nextly/runtime";
import type {
  ContentEntry,
  ContentRoute,
  StaticContentRoute,
  ContentRouteConfig,
  NextlyContentReader,
  NextlySingleReader,
  PublicSiteSettings,
  PublicSiteSettingsSource,
  RenderContext,
  SingleContext,
  SingleDocument,
  SingleRoute,
  SingleRouteConfig,
} from "nextly/runtime";
import type { ReactElement, ReactNode } from "react";
import { createElement, Fragment, Suspense } from "react";

import { recordedFieldShapes, shapeRefKey } from "./binding-wire";
import { itemFollowsIn } from "./blocks/list-batch";
import {
  conditionDayStart,
  listEntryCount,
  listPagesOf,
  listWillRead,
  namedListBase,
} from "./blocks/list-read";
import {
  namedQueryFailureLine,
  queryRowFields,
  readNamedList,
} from "./blocks/named-read";
import { url } from "./blocks/props";
import {
  COMPONENT_DOCUMENT_FIELD,
  COMPONENT_TAG_COLLECTION,
  definitionsFor,
  EMPTY_DEFINITIONS,
  type ComponentSource,
} from "./component-source";
import {
  createDefaultDataProvider,
  createQueryBudget,
  createStandaloneContext,
  DEFAULT_MAX_QUERIES,
  isBindingIssue,
} from "./context";
import type {
  BindingIssuesHandler,
  BlockHostPolicy,
  BlocksDataProvider,
  PageIssue,
  BlocksDataProviderFactory,
  BlocksFieldShapeRef,
  BlocksFieldShapes,
  BlocksPublicReader,
  BlocksSiteSettings,
  ListPageContext,
  NamedQueryHost,
  NamedQueryLookup,
  PageBindings,
  ListBatchReads,
  PageContext,
  QueryBudget,
  ReadClaim,
  ReadKind,
  ResolvedMedia,
} from "./context";
import { resolveLucideIcon } from "./icons/lucide";
import {
  anyListWhere,
  listCollections,
  listCollectionsWhere,
  listPropsAsBound,
} from "./list-collections";
import {
  cappedLifetime,
  checkedLayoutsProvider,
  DEFAULT_LAYOUTS_COLLECTION,
  regionsFor,
  type BlocksLayoutsProvider,
  type LayoutRowReader,
} from "./next-layouts";
import { layoutPartSheets, type PagePart } from "./page-parts";
import { PageRenderer } from "./page-renderer";
import {
  heldConditionsOf,
  holdsBackConditions,
  pageBindingRun,
  prepareDocument,
  readingViewOf,
  readStagesFor,
  regateDocument,
  type PreparedDocument,
} from "./prepare-document";
import { registeredBlocks } from "./resolver";
import type { BlockResolver } from "./resolver";
import type { PageStyles } from "./styles";
import {
  conditionAllows,
  entrySubjectOf,
  type ConditionGate,
} from "./visibility";

// The default stays published here too, where a route's `maxQueries` is set.
export { DEFAULT_MAX_QUERIES };

/**
 * Marker for the subpath's existence and its build wiring.
 *
 * A real export rather than an empty file: an entry that exports nothing is
 * dropped by treeshaking, so the subpath would build to nothing and its
 * `exports` map would point at a missing file — a packaging error that only
 * surfaces for a consumer after publish.
 */
export const BLOCKS_REACT_NEXT_ENTRY = "@nextlyhq/blocks-react/next";

/**
 * Keys the CMS sets on the row it returns.
 *
 * Read rather than asked of the caller: both are decided by the read that
 * produced the entry, so requiring a route to restate them is requiring it to
 * guess at something it was already told.
 */
const WORKING_DRAFT_KEY = "_isWorkingDraft";

/** What ordinary Nextly media is tagged under for cache invalidation. */
const MEDIA_TAG_COLLECTION = "media";

/**
 * The site-wide style inputs a route accepts: a full `SiteSheetInput` less the
 * breakpoint requirement, which may instead fall back to `styleContext`'s.
 */
export type SiteStylesInput = Omit<SiteSheetInput, "breakpoints"> &
  Partial<Pick<SiteSheetInput, "breakpoints">>;

/** A provider rather than a plain value: it states what its read depends on. */
function isSiteStylesProvider(
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
  /** Resolve an entry reference to a path, instead of reading its slug. */
  resolveEntryPath?: (collection: string, id: string) => Promise<string | null>;
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

export type { BlocksLayoutsProvider } from "./next-layouts";

/**
 * Percent-encode a slug path, keeping its `/` separators.
 *
 * Next hands this route the DECODED segments while the request used their
 * encoded form, and a slug is ordinary stored text — so `faq?all` interpolated
 * raw produces a path a URL consumer reads as a query. Shared by the canonical
 * and by reference links, because a page describing itself one way and linking
 * to itself another is the disagreement this exists to prevent.
 */
function emitPath(slug: string): string | null {
  // The route's OWN answer, not a second opinion: the path its static params
  // pre-render, which the route's redirects name too. It collapses repeated
  // and edge slashes — Next answers `/a//b` with a 308 to `/a/b`, and the
  // lookup then asks for a slug the entry does not have — refuses reserved
  // paths, and refuses the segments URL resolution removes.
  //
  // An empty slug is the HOMEPAGE, which the route resolves at `/` and
  // pre-renders as `{ slug: [] }`. Treating it as missing would strip the
  // destination from every button pointing at the site root.
  return slugToPath(slug);
}

/**
 * The slug of page `page` of the list on the entry at `slug`: the entry's
 * own for page 1, `<slug>/page/<n>` for a later one, as the route serves it.
 */
function listPageSlug(slug: string, page: number | undefined): string {
  if (page === undefined || page <= 1) return slug;
  return [slug, LIST_PAGE_SEGMENT, String(page)]
    .filter(part => part !== "")
    .join("/");
}

/**
 * The list a page's address pages, found in the page's own document as the
 * renderer presents it: repaired, and held to the route's caps on nodes and
 * depth. A list the renderer would drop (malformed, past a cap) therefore
 * pages nothing, so the route never serves a later page whose HTML has no
 * list. The page's own nodes only, its components left out: a component or a
 * Layout region shows on many pages, so a list in one never pages an
 * address. The one finding the route's count and the render share.
 */
function pagedListOf(
  document: BlockDocument,
  page: DrawnDocument,
  maxNodes: number,
  /** The page's binding pass, so a bound query prop is read as drawn. */
  run: BindingRun | undefined
): PaginatedList | undefined {
  if (page.prepared === null) return undefined;
  // The page's own lists, walked in its stored order, an instance's exposed
  // slot included, never one a component's definition brings, which shows
  // on every page placing it. Each is judged by its props as the page's
  // binding pass fills them, the ones it is drawn with, read from that very
  // list in the page as drawn (found by its id, so a component's own list
  // cannot stand in for it): a limit, offset, collection or split bound to
  // the entry counts as the page shows it, so a list split into pages only
  // by a bound value pages too, and the route serves exactly the pages the
  // list's links name. Both walks are held to the route's node cap, as the
  // renderer's own reading is.
  const drawn = listsById(page.prepared.presented.nodes, maxNodes);
  return paginatedList(document.nodes, maxNodes, stored => {
    const list =
      typeof stored.id === "string" ? drawn.get(stored.id) : undefined;
    return list === undefined ? {} : listPropsAsBound(list, run);
  });
}

/**
 * The collection lists in `nodes`, as drawn, by id: the first of each id in
 * document order. Bounded by `maxNodes`.
 */
function listsById(
  nodes: readonly BlockNode[],
  maxNodes: number
): Map<string, BlockNode> {
  const lists = new Map<string, BlockNode>();
  const stack: BlockNode[] = [...nodes].reverse();
  let left = maxNodes;
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (left <= 0) break;
    left -= 1;
    if (node.type === COLLECTION_LIST_TYPE && !lists.has(node.id)) {
      lists.set(node.id, node);
    }
    for (const children of Object.values(node.slots ?? {}).reverse()) {
      for (let at = children.length - 1; at >= 0; at -= 1) {
        const child = children[at];
        if (child !== undefined) stack.push(child);
      }
    }
  }
  return lists;
}

/**
 * Which page of its paginated list a render draws, and the address of each
 * page, or nothing when the page splits no list into pages.
 */
function listPageFor(
  list: PaginatedList | undefined,
  context: RenderContext
): ListPageContext | undefined {
  // The route's own addresses, its mount included: present where it serves
  // a list's later pages, so the links name exactly the pages it answers.
  const listPagePath = context.listPagePath;
  if (listPagePath === undefined || list === undefined) return undefined;
  return {
    nodeId: list.id,
    page: context.page ?? 1,
    href: listPagePath,
    // The route's count, where it served this later page by one.
    ...(context.listPages === undefined ? {} : { pages: context.listPages }),
  };
}

/**
 * The page of its paginated list a render draws, with the list's first read
 * claimed for it, or nothing where the route serves no later pages (a
 * Single's gives no addresses, so its list shows one page and claims its
 * own read) or the list's read cannot be claimed, as the route then serves
 * none of its later pages either.
 *
 * Claimed only for a list that reads: one with no collection yet, or a
 * stored query it cannot run, spends nothing another list needs. A custom
 * source claims nothing ahead: its run claims each read it makes, as the
 * route's count of its pages claimed them.
 */
function claimedListPage(
  list: PaginatedList | undefined,
  context: RenderContext,
  budget: QueryBudget
): ListPageContext | undefined {
  if (
    list === undefined ||
    context.listPagePath === undefined ||
    !listWillRead(list.props)
  ) {
    return undefined;
  }
  if (namedListBase(list.props) !== undefined) {
    return listPageFor(list, context);
  }
  if (!budget.take({ kind: "entries", nodeId: list.id })) return undefined;
  const page = listPageFor(list, context);
  return page === undefined ? undefined : { ...page, claimed: true };
}

/**
 * The instance this route reads through.
 *
 * Resolved the same way `createContentRoute` resolves its own — the caller's
 * `nextly` when given, the process instance otherwise — so the page and the
 * records it embeds come from ONE place. On a per-tenant setup a second
 * instance is a second database, and the mismatch surfaces as missing relations
 * rather than as an error.
 *
 * Read here rather than taken off the render context. Carrying it there meant
 * publishing a trusted reader to every third-party callback, and every attribute
 * that makes it trusted — access, both identity channels, lifecycle, locale —
 * had to be re-bound, each failing independently. These resolvers pass all of
 * them explicitly on every call, so they never depended on those defaults.
 */
function readerFor(config: BlocksPageConfig): NextlyContentReader {
  return config.nextly ?? requireNextly();
}

/**
 * The public reader a page's lists read through, for one render.
 *
 * Each read is cached like the page around it, keyed by the route's cache
 * scope, the page's language and the whole read, and tagged with its
 * collection or Single so a write there refreshes the page. The read is the
 * same for every visitor (anonymous, published), so one entry serves them all.
 * A change to an access rule is not a write and refreshes nothing until the
 * entry revalidates.
 *
 * The cache holds the public reader's whole answer, not the instance's row:
 * the reader then judges which fields the public may see inside the cached
 * read. Under Cache Components a page is prerendered, and a prerender refuses
 * a read outside the cache that takes the current time, as that judgement
 * does when it checks the access rules are current.
 */
function publicReaderFor(
  config: BlocksPageConfig,
  locale: string | undefined,
  window: number | false | undefined
): BlocksPublicReader {
  const nextly = readerFor(config);
  const singles = singleReaderOf(nextly);
  const reader = createPublicReader(
    {
      find: async args => await nextly.find(args),
      ...(singles === undefined
        ? {}
        : { findSingle: singles.findSingle.bind(singles) }),
    },
    locale === undefined ? {} : { locale }
  );
  const cached = async <T>(
    kind: string,
    tags: string[],
    query: object,
    read: () => Promise<T>
  ): Promise<T> =>
    await cachedFind(read, {
      tags,
      keyParts: [
        kind,
        config.cacheScope ?? "",
        locale ?? "",
        JSON.stringify(query),
      ],
      // The route's own window bounds it too, so a read never outlives the
      // page around it.
      revalidate: await releaseBoundedRevalidate(window),
    });
  const findSingle = reader.findSingle.bind(reader);
  return {
    find: async query =>
      await cached(
        "nextly-public-list",
        nextlyTags(query.collection),
        query,
        async () => await reader.find(query)
      ),
    count: async query =>
      await cached(
        "nextly-public-count",
        nextlyTags(query.collection),
        query,
        async () => await reader.count(query)
      ),
    ...(singles === undefined
      ? {}
      : {
          findSingle: async query =>
            await cached(
              "nextly-public-single",
              nextlySingleTags(query.slug),
              query,
              async () => await findSingle(query)
            ),
        }),
  };
}

/**
 * The most tags a named query's cached result carries: Next keeps 128 per
 * cache entry, and nextly's reads keep to it (`readTags`).
 */
const NAMED_QUERY_CACHE_TAGS = 128;

/** This process's own identity, for a deployment that names none. */
const PROCESS_IDENTITY = `process:${globalThis.crypto.randomUUID()}`;

/**
 * Which deployment this code is: the one the platform names
 * (`NEXT_DEPLOYMENT_ID`, which Next sets from its `deploymentId`, or
 * Vercel's), else this process's own identity. A named query's cached
 * result is kept under it, because a deployment can change what `run`
 * computes (an imported helper, a constant) without changing a character of
 * its source: a result is never served across deployments. With no
 * deployment named, it is never served across processes either, which
 * costs a fresh run after a restart and never serves stale rows.
 */
function deploymentIdentity(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const named = [
    env.NEXT_DEPLOYMENT_ID,
    env.VERCEL_DEPLOYMENT_ID,
    env.VERCEL_GIT_COMMIT_SHA,
  ].find(value => value !== undefined && value.trim() !== "");
  return named === undefined ? PROCESS_IDENTITY : `deployment:${named}`;
}

/**
 * The site's time zone, for a named query's day: the route's, else the one
 * the site settings name, UTC only when they name none. Settings that could
 * not be read (the page's reads spent, or the read failing) are not settings
 * that name no zone: that refuses, and the list draws its empty state rather
 * than run a query on another zone's day.
 */
async function siteZone(
  config: BlocksPageConfig,
  budget: QueryBudget,
  window: number | false | undefined
): Promise<string | undefined> {
  if (config.timeZone !== undefined) return config.timeZone;
  const site = await readSite(
    siteSettingsSourceFor(config),
    config.cacheScope,
    budget,
    window
  );
  if (site === undefined) {
    throw new Error(
      "The site settings could not be read, so the site's time zone, and today in it, is not known."
    );
  }
  return site.timezone ?? undefined;
}

/** How long a cached "today" may live before it is asked again, in seconds. */
const TODAY_LIFETIME = 60;

/**
 * Today in the site's time zone, for a named query: cached, because a
 * prerender under Cache Components refuses the current time outside the
 * cache, and tagged with the site settings, whose time zone it is read in.
 */
async function todayFor(zone: string | undefined): Promise<string> {
  const safe = safeTimeZone(zone).zone;
  return await cachedFind(
    () => Promise.resolve(calendarDayIn(safe, new Date())),
    {
      tags: nextlySiteSettingsTags(),
      keyParts: ["nextly-named-query-today", safe],
      revalidate: TODAY_LIFETIME,
    }
  );
}

/**
 * How a published page runs its lists' named queries: over the route's
 * public reader, as an anonymous visitor reads, each run inside nextly's
 * named-query frame, which refuses a trusted Direct API call from developer
 * code. A run's result is cached like the page around it, keyed by its
 * query, inputs and window, and tagged by everything the query DECLARES, so
 * a write to any collection, Single or setting it may read refreshes the
 * page, whether or not this run happened to read it.
 */
function namedQueryHostFor(args: {
  readonly config: BlocksPageConfig;
  readonly locale: string | undefined;
  readonly window: number | false | undefined;
  readonly budget: QueryBudget;
  readonly context: RenderContext;
}): NamedQueryHost {
  const { config, locale, window, budget, context } = args;
  const reader = publicReaderFor(config, locale, window);
  let today: Promise<string> | undefined;
  return {
    // The site's own queries, as the route was handed them: none when it
    // was handed none, so a list naming one shows its empty state.
    definitionOf: name => config.namedQueries?.definitionOf(name),
    reader: {
      ...reader,
      // The route's own instance's settings, as the page's own read takes
      // them, so a process serving several sites never hands a query
      // another site's name or zone. The reader already counted this read.
      siteSettings: async () => {
        const from = siteSettingsSourceFor(config);
        if (from instanceof ProcessSiteSettings) warnOfStandIn(from);
        const settings = await cachedFind(
          async () => await readPublicSiteSettings(from),
          {
            tags: nextlySiteSettingsTags(),
            keyParts: ["nextly-public-site-settings", config.cacheScope ?? ""],
            revalidate: await releaseBoundedRevalidate(window),
          }
        );
        return { ...settings };
      },
    },
    today: () => {
      today ??= (async () =>
        await todayFor(await siteZone(config, budget, window)))();
      return today;
    },
    fieldsOf: async collection =>
      await cachedFieldShapes(
        { collection },
        { scope: config.cacheScope ?? "", locale, window }
      ),
    // nextly's frame: inside it the Direct API refuses every call, and the
    // query's reader reads through the frame's own door.
    frame: name => openNamedQueryFrame(name),
    cache: async ({ declaration, key, read }) => {
      const tags = [
        ...(declaration.reads.collections ?? []).flatMap(slug =>
          nextlyTags(slug)
        ),
        ...(declaration.reads.singles ?? []).flatMap(slug =>
          nextlySingleTags(slug)
        ),
        ...(declaration.reads.site === true ? nextlySiteSettingsTags() : []),
      ];
      // A result is kept only when every source it declares can expire it.
      // The cache keeps a bounded number of tags per entry, and a read past
      // the bound would stay cached after a write to a source left off. The
      // registry bounds a query's reads below this; this holds it whatever
      // a tag costs.
      if (new Set(tags).size > NAMED_QUERY_CACHE_TAGS) return await read();
      const route = await releaseBoundedRevalidate(window);
      const own = declaration.revalidate;
      return await cachedFind(read, {
        tags,
        keyParts: [
          "nextly-named-query",
          config.cacheScope ?? "",
          deploymentIdentity(),
          ...key,
        ],
        revalidate:
          own === undefined
            ? route
            : route === false
              ? own
              : Math.min(route, own),
      });
    },
    // The log names the page, the list and the query, under the reference
    // an author is shown in place of the error, and the error by its code or
    // class only: its message may hold whatever the query's code put in it.
    report: failure => {
      console.warn(
        namedQueryFailureLine(
          failure,
          `"${context.collection}" page "${context.slug}"`
        )
      );
    },
  };
}

/**
 * How many pages a paginated list whose source is a named query has, from
 * its run's total by the list's own window (`listPagesOf`, the collection
 * list's count), or `undefined` for a list with another source.
 *
 * The run is the one the list's first page makes: the same host (frame,
 * reader and cache), window, inputs and language, so a result the host
 * kept serves both, and its reads are claimed from `budget` as the render
 * claims them, as they are made or replayed. A run that fails, or returns
 * no total, gives one page: the list draws its empty state, so no later
 * page exists, and no count is guessed. The failure is logged here, through
 * the host's own report: the later page asked for is then not found, so no
 * render follows that would log it.
 */
async function namedListPages(
  list: PaginatedList,
  host: NamedQueryHost,
  budget: QueryBudget,
  locale: string | undefined
): Promise<number | undefined> {
  const base = namedListBase(list.props);
  if (base === undefined) return undefined;
  if ("blocking" in base) return 1;
  const outcome = await readNamedList(
    base.named,
    { limit: base.limit, offset: base.offset },
    {
      ...createStandaloneContext({ locale, queries: budget }),
      namedQueries: host,
    },
    list.id,
    { counted: true }
  );
  return outcome.failed || outcome.total === undefined
    ? 1
    : listPagesOf(list.props, outcome.total);
}

/** The instance's Single read, when the reader the route holds has one. */
function singleReaderOf(reader: object): NextlySingleReader | undefined {
  return "findSingle" in reader && typeof reader.findSingle === "function"
    ? (reader as NextlySingleReader)
    : undefined;
}

/**
 * The process's registered instance, standing in for the site settings of a
 * reader of the app's own that offers no site-settings read.
 *
 * It reads what such a route read before an instance could be asked, so a
 * single-site app whose reader predates `publicSiteSettings` keeps its site
 * name and time zone. It is a stand-in rather than a quiet fallback because on
 * a process serving several sites it is another site's settings: the read
 * that uses one says so, naming the reader's missing line.
 *
 * Whether a process serves several sites cannot be asked of Nextly. Every
 * handle `getNextly`, `getCachedNextly` and `requireNextly` give out is one
 * process-wide instance over one service container, both kept on
 * `globalThis`, so a process never holds two instances to count; its other
 * sites are readers of the app's own, which nothing here can see.
 */
class ProcessSiteSettings implements PublicSiteSettingsSource {
  constructor(readonly reader: object) {}

  async publicSiteSettings(): Promise<PublicSiteSettings> {
    return await readPublicSiteSettings();
  }
}

/** The readers already warned about, so each is named once per process. */
const warnedReaders = new WeakSet<object>();

/**
 * Said once per reader, in every environment, when a page reads the site
 * settings through a stand-in: a production log is where a site showing
 * another site's name would otherwise go unexplained.
 */
function warnOfStandIn(standIn: ProcessSiteSettings): void {
  if (warnedReaders.has(standIn.reader)) return;
  warnedReaders.add(standIn.reader);
  console.warn(
    "[blocks] This route's `nextly` reader has no `publicSiteSettings`, so its pages show the site settings of the process's registered Nextly instance. On a process serving several sites those are another site's name and time zone. Add one line to the reader: `publicSiteSettings: async () => (await instance()).publicSiteSettings()`."
  );
}

/**
 * Where a route's pages read the site settings: the instance the route reads
 * its records through, chosen by {@link readerFor} and nowhere else, so a
 * page's site name and time zone come from the same instance as its content.
 * A route given no instance reads the process's, as its records do. A reader
 * of the app's own without a site-settings read gets the process's registered
 * instance as a {@link ProcessSiteSettings} stand-in.
 */
function siteSettingsSourceFor(
  config: BlocksPageConfig
): PublicSiteSettingsSource {
  const reader: object = readerFor(config);
  return "publicSiteSettings" in reader &&
    typeof reader.publicSiteSettings === "function"
    ? (reader as PublicSiteSettingsSource)
    : new ProcessSiteSettings(reader);
}

/** The route's data provider for one render: the caller's, or the default. */
function dataFor(
  factory: BlocksDataProviderFactory | undefined,
  config: BlocksPageConfig,
  locale: string | undefined,
  window: number | false | undefined
): BlocksDataProvider {
  return (factory ?? createDefaultDataProvider)(
    publicReaderFor(config, locale, window)
  );
}

/** An empty page, for a field that exists and holds no document yet. */
function emptyDocument(): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes: [] };
}

/**
 * The document stored at `field`, or an empty page.
 *
 * The two nothing-cases are deliberately NOT treated alike. A field absent from
 * the row is a wiring mistake — a typo, or a route pointed at a collection that
 * has no such field — and it can only ever render blank, so it throws naming
 * both the field and the collection. A field present and null is an entry
 * nobody has authored yet, which is ordinary, and renders empty.
 *
 * Anything else goes to the renderer as-is rather than being inspected here:
 * the renderer already repairs a malformed document forgivingly, and a second
 * opinion about shape in front of it could only disagree with the first.
 */
function readDocument(
  entry: ContentEntry,
  field: string,
  context: RenderContext
): BlockDocument {
  if (!(field in entry)) {
    throw new Error(
      `createBlocksPage: no field "${field}" on an entry from "${context.collection}". ` +
        "Name the field that holds the block document."
    );
  }
  const value = entry[field];
  if (value === null || value === undefined) return emptyDocument();
  return value as BlockDocument;
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
 * The document's own metadata, with any media id resolved to a URL.
 *
 * The image arrives as a media id because a block cannot resolve one — the
 * contribution is synchronous by design, so generating metadata never puts a
 * network call between a crawler and the page title. Resolution happens here,
 * through the SAME resolver the rendered image uses, so the picture in a link
 * preview and the picture on the page cannot disagree.
 */
async function derivePageSeo(
  document: BlockDocument,
  blocks: BlockResolver | undefined,
  resolveMedia: (id: string) => Promise<ResolvedMedia | null>,
  slug: string,
  limits: DocumentLimits | undefined,
  styleContext: StyleCompileContext | undefined,
  /**
   * The host's fetch list, applied to the preview image exactly as the renderer
   * applies it to the picture on the page.
   *
   * A link preview is a THIRD fetching channel, and the easiest one to forget:
   * the image never appears in the document's markup, so a page that correctly
   * refuses to render an unlisted host would still publish that host in its
   * Open Graph tags, where every crawler and chat client that unfurls the link
   * then fetches it.
   */
  remotePatterns: readonly RemotePatternInput[] | undefined,
  /**
   * The components this page embeds, resolved by the caller.
   *
   * Handed in rather than fetched here, because this function is synchronous
   * about content by design and the caller already owns a query budget. What
   * matters is that it is the SAME set the render inlines: the preparation
   * below is shared with the renderer precisely so the two describe one page,
   * and definitions are the one input that can differ while every pass agrees.
   */
  definitions: DefinitionsById | undefined,
  /**
   * What the page's bindings read, read for this invocation. The same
   * preparation fills them as the render's, so a bound heading's text is the
   * title the page claims.
   */
  bindings: PageBindings | undefined,
  locale: string | undefined,
  /**
   * The document as the caller already prepared it for its reads, so the
   * pipeline runs once for this invocation.
   */
  preparation: PreparedDocument | undefined,
  /**
   * Where the document's own metadata bindings that could not be used are
   * reported. They are no node's, so the render's report never holds them.
   */
  reportIssues?: BindingIssuesHandler
): Promise<DerivedPageSeo> {
  const resolver = blocks ?? registeredBlocks();
  // Spread rather than assigned, so an unaddressable slug OMITS the key instead
  // of carrying `undefined`. The result is spread over a caller's own fallbacks,
  // where a present-but-undefined key erases a canonical they already knew.
  const path = emitPath(slug);
  const canonical = path === null ? {} : { canonical: path };

  // One binding pass for the blocks and the document's own metadata, so a
  // bound title segment and a bound heading read the same value.
  const run =
    bindings === undefined
      ? undefined
      : pageBindingRun(bindings, locale, resolver);

  // One authoritative preparation, shared with the renderer rather than
  // restated here. Hand-copying the passes is what let metadata describe a
  // different page than the HTML: the copy drifted on the format guard, the
  // configured caps, duplicate-id repair and placeholder subtrees, each a
  // separate way to publish content the page withholds.
  const stages = readStagesFor(
    document,
    {
      resolver,
      limits,
      styleContext,
      // Spread conditionally, matching the renderer: an absent map says the
      // caller never fetched, an empty one says it fetched and found none, and
      // the pipeline reports those differently.
      ...(definitions === undefined || definitions.size === 0
        ? {}
        : { definitions }),
      ...(run === undefined ? {} : { bindings: run }),
    },
    preparation
  );
  const prepared = stages === null ? null : readingViewOf(stages);
  // Nothing readable means nothing to describe. The page renders a placeholder,
  // and metadata claiming a title it does not show would be worse than silence.
  if (prepared === null) return canonical;

  // The blocks the HTML draws, by the rule the renderer draws them with: one
  // whose conditions held for the entry describes the page, one a list's item
  // decides does not, since no one item speaks for the page.
  const held = heldConditionsOf(preparation);
  const { image: blockImages, ...derived } = deriveSeoFromDocument(
    prepared,
    type => resolver.get(type),
    node => conditionAllows(node, {}, { held })
  );
  // What the document states for the page as a whole wins over what its
  // blocks offer, field by field; its image is tried first, and a block's
  // still answers when it yields no picture.
  const own = resolveDocumentSeo(prepared, run);
  if (own.issues.length > 0) reportIssues?.(own.issues);
  const text = {
    ...derived,
    ...(own.title === undefined ? {} : { title: own.title }),
    ...(own.description === undefined ? {} : { description: own.description }),
  };
  const imageCandidates =
    own.image === undefined ? blockImages : [own.image, ...(blockImages ?? [])];
  const image = await firstUsableImage(
    imageCandidates,
    resolveMedia,
    remotePatterns
  );
  return image === undefined
    ? { ...text, ...canonical }
    : { ...text, ...canonical, image };
}

/**
 * The first candidate that yields a picture.
 *
 * Ordered rather than first-wins-outright because the block's preference and
 * the block's fallback are both in the list: an image carrying a media id AND a
 * typed URL renders the media when it resolves and the URL when it does not, so
 * metadata that stopped at the unresolvable media id would disagree with the
 * page it describes.
 *
 * A failed resolution costs the preview image, never the route: metadata runs
 * before the render, so letting a media read throw would fail the page over a
 * picture.
 */
/**
 * How many media lookups may be in flight at once.
 *
 * Small on purpose. This runs inside `generateMetadata`, so the work competes
 * with producing the page rather than happening beside it, and the candidates
 * are a page's images rather than a dataset. The number only has to stop a
 * chain of deleted references from being paid one round trip at a time.
 */
const MEDIA_LOOKUP_BATCH = 5;

/**
 * Whether a resolution actually yielded a picture.
 *
 * `resolveMedia` may be the caller's own, so its answer is third-party data
 * however the type reads: a JavaScript implementation returning a missing
 * `Map.get` answers `undefined`, and one built from a partial record answers an
 * object with no usable `url`. The RENDERER treats both as unresolved and falls
 * back to the block's own `src`, so a check that counted them as a hit would end
 * the search here and leave the page described by no image at all — while it
 * displays one.
 */
function usableMedia(media: ResolvedMedia | null): boolean {
  return (
    media !== null &&
    media !== undefined &&
    typeof media.url === "string" &&
    media.url.trim() !== ""
  );
}

async function firstUsableImage(
  candidates: SeoImageCandidate[] | undefined,
  resolveMedia: (id: string) => Promise<ResolvedMedia | null>,
  remotePatterns: readonly RemotePatternInput[] | undefined
): Promise<string | undefined> {
  // A candidate the host would not fetch is not usable, whichever route
  // produced it: a URL written on the block and a URL a media record resolved
  // to are the same kind of value here, exactly as they are in `core/image`.
  // BOTH filters, in the order the renderer applies them. The host list alone
  // is not the whole rule: a resolver can return `javascript:alert(1)` from a
  // media record a person filled in, and a site with no `remotePatterns` would
  // then publish it as the link preview while the page correctly refuses to
  // render it. `url()` is the same scheme guard every block prop passes through.
  // Returns the value as the guard NORMALISED it, not merely whether it passed.
  // `url()` trims, and the renderer publishes the trimmed form — so answering
  // yes/no here and then emitting the original would put a different string in
  // the link preview than in the page, which is the disagreement this filter was
  // added to remove.
  const usable = (value: string): string | undefined => {
    const safe = url(value);
    if (safe === undefined) return undefined;
    return remotePatterns === undefined || isFetchableUrl(safe, remotePatterns)
      ? safe
      : undefined;
  };
  // A refused direct URL is removed from the LIST rather than rejected where it
  // is reached, so scanning simply continues to the next candidate in document
  // order. Rejecting it at the point of use would stop the search at a value
  // that was never going to be published.
  const list: SeoImageCandidate[] = [];
  for (const candidate of candidates ?? []) {
    if (candidate.kind !== "url") {
      list.push(candidate);
      continue;
    }
    const safe = usable(candidate.value);
    // Kept in its NORMALISED form, so the value that reaches the tag is the one
    // the guard actually approved rather than the one it was handed.
    if (safe !== undefined) list.push({ kind: "url", value: safe });
  }

  for (let start = 0; start < list.length; start += MEDIA_LOOKUP_BATCH) {
    const batch = list.slice(start, start + MEDIA_LOOKUP_BATCH);

    // A candidate that is not a media id needs no lookup, and it is a usable
    // answer the moment it is reached — so an earlier one settles the whole
    // question before any request is issued for the ids after it.
    const direct = batch.findIndex(c => c.kind === "url");
    const lookups = (direct === -1 ? batch : batch.slice(0, direct)).map(
      c => c.value
    );

    // Resolved together rather than one at a time. Serially, a page whose
    // first images all reference deleted media paid a round trip each before
    // reaching a usable one, inside metadata generation — enough of them and
    // the page times out instead of rendering with a later, perfectly good
    // image.
    const pending = lookups.map(id => resolveMedia(id).catch(() => null));

    // Scanned in DOCUMENT order, not completion order. The earliest usable
    // candidate is the one the renderer would show, and picking whichever
    // request happened to finish first would publish a different picture than
    // the page displays — silently, and only under load.
    // Awaited IN ORDER though started together. The batch exists to stop the
    // round trips being serial, and `Promise.all` turned that into a dependency
    // the other way: a first candidate that resolved immediately still waited on
    // a fourth that hung, inside `generateMetadata`, so a page could time out
    // with its preview image already in hand. Awaiting one at a time returns as
    // soon as the earliest usable candidate settles and never waits on the ones
    // after it, while still picking in DOCUMENT order rather than completion
    // order — the renderer shows the earliest usable image, and metadata that
    // took whichever finished first would describe a different picture.
    for (const lookup of pending) {
      const media = await lookup;
      // The resolved URL cannot be filtered up front, because nothing knows it
      // until the record is read. A refused one falls through to the next
      // candidate exactly as an unresolvable one does.
      if (media === null) continue;
      const safe = usable(media.url);
      if (safe !== undefined) return safe;
    }
    if (direct !== -1) return batch[direct]?.value;
  }
  return undefined;
}

/**
 * Read a media record and describe it the way a block expects.
 *
 * The names are mapped rather than assumed to line up: a block asks for `alt`
 * and the record stores `altText`, and letting that fall through would render
 * the file name as alt text, which is an accessibility defect rather than a
 * cosmetic one.
 *
 * Read with access overridden because this resolves an asset the page already
 * renders — the entry's own read has settled whether the page may be seen, and
 * a second anonymous check here would blank the images on a page that passed it.
 */
/** The media surface the default resolver reads through. */
interface MediaReader {
  findByID(args: {
    id: string;
    disableErrors?: boolean;
  }): Promise<Record<string, unknown> | null>;
}

/**
 * The instance's media reader, when it has one.
 *
 * Media is a SYSTEM table with its own namespace, not a dynamic collection, so
 * `findByID({ collection: "media" })` goes through the collections handler and
 * finds nothing — the image block then catches the rejection and renders no
 * image, which is a default resolver that cannot resolve the default case.
 *
 * Detected structurally rather than by widening `NextlyContentReader`, which is
 * `Pick<Nextly, "find" | "findByID">` and shared with `resolveContent`: adding a
 * member there would oblige every caller injecting a stand-in — including tests
 * that legitimately have no media — to supply one.
 */
function mediaNamespaceOf(
  reader: NextlyContentReader
): MediaReader | undefined {
  const candidate = (reader as { media?: unknown }).media;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const findByID = (candidate as { findByID?: unknown }).findByID;
  return typeof findByID === "function"
    ? (candidate as MediaReader)
    : undefined;
}

/**
 * One row from a named media collection, read under a lifecycle scope.
 *
 * `findByID` accepts no `status`, so a scoped by-id read has to be expressed as
 * a `find` on the id. Kept beside its only caller rather than generalized: the
 * posture here is stated explicitly on every field, which is what makes it
 * legible — a general helper would put the same decisions somewhere a reader of
 * this resolver cannot see.
 */
async function mediaByQuery(
  reader: NextlyContentReader,
  args: {
    collection: string;
    id: string;
    status: "published" | "draft" | "all";
    overrideAccess: boolean;
    disableErrors: boolean;
    // Both identity channels are part of this call's shape, so a caller cannot
    // build a read here that omits one.
    user?: undefined;
    req?: undefined;
    locale?: string;
  }
): Promise<Record<string, unknown> | undefined> {
  const { id, ...rest } = args;
  const found = await reader.find({
    ...rest,
    where: { id: { equals: id } },
    limit: 1,
  });
  return found.items[0];
}

/**
 * The route's component source: one batched, tagged, posture-carrying read.
 *
 * TAGGED PER ID and never with the collection tag. `nextlyTags` always
 * prepends it, so using it here would make publishing any component rebuild
 * every page on the site that embeds any component at all — the exact opposite
 * of what a component store is for. The id tags attach to the PAGE's cache
 * entry because this read happens inside the page's render, so one component
 * publish invalidates exactly the pages that embedded it.
 *
 * The identity channels are cleared and the scope is the route's, for the
 * reasons `mediaResolver` clears them: `mergeConfig` spreads the reader's
 * defaults UNDER the call, so an omitted `user` or `req` restores whatever
 * identity the instance was booted with — on a read this route performs for an
 * anonymous visitor, into a page that is then cached. And the lifecycle scope
 * is the entry read's, not a second opinion: a route serving published content
 * must not inline a draft component, and a preview route must.
 *
 * The row is handed over WHOLE and unjudged. Whether that field holds a
 * readable component document is the pipeline's question, and it answers it
 * with reasons a store cannot: an id present with an unreadable value is a
 * definition somebody published and cannot be read, and an id absent is one
 * nobody published.
 */
function componentSource(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  budget: QueryBudget,
  locale: string | undefined
): ComponentSource {
  if (config.resolveComponents) {
    const custom = config.resolveComponents;
    // Charged like every other read on this path, for the reason
    // `mediaResolver` charges a host's own resolver: a site's source is the
    // one most likely to be database- or network-backed, and exempting it
    // bounds the reader we wrote while leaving unbounded the one a site
    // supplies. A nested chain asks it once per level, so an uncharged source
    // is `MAX_COMPOSED_DEPTH` unbounded reads on a route that stated a limit.
    return async ids =>
      budget.take(COMPONENT_CLAIM) ? await custom(ids) : EMPTY_DEFINITIONS;
  }
  const collection = config.componentCollection ?? COMPONENT_TAG_COLLECTION;
  const field = config.componentField ?? COMPONENT_DOCUMENT_FIELD;
  const status = embeddedStatus(config);
  const overlayDrafts = overlaysDrafts(config);

  return async (ids: readonly string[]) => {
    // Dropped before anything is built from them, not repaired. `entryIdTag`
    // refuses a blank segment by THROWING — correctly, because a bare
    // `nextly:components:id:` tag would over-invalidate — and a stored
    // `componentId` of `"   "` is a nonempty string that `componentIdsIn`
    // reports as a reference. Left in, one malformed instance takes the whole
    // page down before a block boundary exists to contain it; left out, it is
    // an id nobody supplied a definition for, which is exactly what it is.
    const wanted = usableIds(ids);
    if (wanted.length === 0) return EMPTY_DEFINITIONS;

    const found = new Map<string, BlockDocument>();
    if (overlayDrafts) {
      return await readDraftDefinitions(wanted, {
        reader,
        collection,
        field,
        locale,
        budget,
      });
    }
    for (const chunk of chunked(wanted, COMPONENT_BATCH_SIZE)) {
      // One claim per QUERY. A page embedding twenty components spends one
      // read because that is what it costs; charging per definition would
      // refuse a page for an allowance it never spent, and charging nothing
      // would leave the read on this path that grows with the page unbounded.
      if (!budget.take(COMPONENT_CLAIM)) break;
      const page = await readRowsChunk(chunk, {
        reader,
        collection,
        status,
        locale,
        cacheScope: config.cacheScope,
        keyName: "nextly-components",
      });
      for (const [id, document] of definitionsById(page.items, field)) {
        found.set(id, document);
      }
    }
    return found;
  };
}

/** Distinct ids with something in them; see `componentSource` for why. */
function usableIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(id => id.trim().length > 0);
}

/**
 * The lifecycle scope a route reads what its page EMBEDS at: the components it
 * places and the Layout it is drawn inside. The entry read's own scope, not a
 * second opinion.
 */
function embeddedStatus(
  config: BlocksPageConfig
): "published" | "draft" | "all" {
  return config.status ?? (config.draft === true ? "all" : "published");
}

/**
 * Whether this route may surface PENDING edits of what its page embeds.
 *
 * One answer for components and Layouts alike, so a preview never draws a
 * draft header around a page whose draft components it refused, or the
 * reverse.
 */
function overlaysDrafts(config: BlocksPageConfig): boolean {
  const status = embeddedStatus(config);
  // Whether this route may surface a component's PENDING edits.
  //
  // Both halves are load-bearing, and both are about what this read can
  // HONESTLY promise.
  //
  // Only the LITERAL `draft` counts. A per-path `draft` function answers about
  // the one entry a visitor asked for and says nothing about the components
  // inside it, so a route whose gate is such a function keeps reading published
  // definitions rather than inheriting a grant that was never about them.
  //
  // And the scope must be the unnarrowed one. `findByID` accepts no `status`,
  // and under `overrideAccess` an absent status is no filter at all, so the
  // per-id read cannot express a lifecycle scope and falls back to the live row
  // when no pending snapshot exists. A route that named `status: "draft"` would
  // then receive a PUBLISHED component it had excluded. Which states are public
  // is the workflow's question, answered in the query service, so this narrows
  // by declining the per-id route rather than by re-deciding that rule here —
  // `status: "all"` is the only scope that excludes nothing and can therefore
  // be served by an unfiltered read.
  return config.draft === true && status === "all";
}

/**
 * The route's Layout read: the rows for some ids, at the posture the route
 * reads what its page embeds, tagged per id and never with the collection.
 *
 * The component read's machinery, not a copy of it: the same batched, cached,
 * release-bounded read on a published route, and the same uncached per-id
 * draft read on a route that overlays drafts. Only `id` and `areas` are
 * selected, which is all a region needs.
 */
function layoutRowReader(
  config: BlocksPageConfig,
  provider: BlocksLayoutsProvider,
  reader: NextlyContentReader,
  budget: QueryBudget,
  locale: string | undefined
): LayoutRowReader {
  const collection = provider.collection ?? DEFAULT_LAYOUTS_COLLECTION;
  const status = embeddedStatus(config);
  const overlayDrafts = overlaysDrafts(config);
  return async (ids, options) => {
    const wanted = usableIds(ids);
    if (wanted.length === 0) return [];
    if (overlayDrafts) {
      return await readDraftRows(wanted, {
        reader,
        collection,
        locale,
        budget,
        // Depth zero, as on the published read below.
        depth: 0,
      });
    }
    if (!budget.take(COMPONENT_CLAIM)) return [];
    const found = await readRowsChunk(wanted, {
      reader,
      collection,
      status,
      locale,
      cacheScope: config.cacheScope,
      // A capped read is its own entry, so the cap reaches only the pages
      // whose answer it gives.
      keyName:
        options?.maxLifetime === undefined
          ? "nextly-layouts"
          : `nextly-layouts:${String(options.maxLifetime)}`,
      select: { id: true, areas: true },
      // Depth zero: a region needs only the component ids `areas` stores, and
      // the components are read once more, at the route's posture, by the
      // component read. A populated read would load them, and whatever they
      // relate to, for nothing.
      depth: 0,
      ...(options?.maxLifetime === undefined
        ? {}
        : { maxLifetime: options.maxLifetime }),
    });
    return found.items;
  };
}

/**
 * How many definitions one query may ask for.
 *
 * The smaller of two caps that are enforced elsewhere and silent when crossed.
 * Nextly clamps a collection query to 500 rows (`PAGINATION_DEFAULTS.maxLimit`),
 * so a larger `limit` returns a SUBSET and the components missing from it are
 * reported as though nobody had published them. Next drops cache tags past
 * `NEXT_CACHE_TAG_MAX_ITEMS`, 128 in the version this package builds against,
 * so a component whose tag was dropped is never invalidated by its own publish
 * and stays stale until some unrelated write busts the entry.
 *
 * 128 satisfies both. A page embedding more components than that costs one
 * extra query per 128, which is the honest price of staying invalidatable.
 */
const COMPONENT_BATCH_SIZE = 128;

/** What a read of components or Layout rows claims as. */
const COMPONENT_CLAIM: ReadClaim = { kind: "component" };

/**
 * The caps this route holds its documents to, resolved the way the pipeline
 * resolves them.
 *
 * One answer, because two would be a disagreement about which nodes exist: the
 * fetch decides what to load and the renderer decides what to draw, and a page
 * whose instances sit past one cap but inside the other loses exactly the
 * blocks between them.
 */
function effectiveLimits(config: BlocksPageConfig): DocumentLimits {
  return config.limits ?? config.styleContext?.limits ?? DEFAULT_LIMITS;
}

/** Successive slices of at most `size`. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The definitions a DRAFT-mode route reads, one query per component.
 *
 * PER ID because that is the only shape the working draft is reachable in. The
 * overlay is applied in `collection-query-service.getEntry`; the list path has
 * no equivalent, so a batched `find` returns the LIVE row however wide its
 * `status` — `status: "all"` widens which rows match and never reaches a
 * pending edit. A route previewing an edit would then draw the last published
 * component, and the form and the picture beside it would disagree about the
 * document the author is looking at.
 *
 * UNCACHED, for the reason `resolve-content` gives for never caching a draft
 * entry read: a working draft changes on every save while cache tags are burst
 * by writes to the LIVE row, so a cached draft shows an editor their previous
 * save and calls it a preview. That also means there is no tag or key to get
 * right here — the staleness a key could not fix is the whole objection.
 *
 * The price is one query per component instead of one per page, and it is paid
 * ONLY here. Draft mode is the editor iframe: one author, one request, no
 * shared cache entry to protect. The published path serves every visitor and
 * keeps its batch, which is what the `overlayDrafts` gate above is for.
 *
 * `draft: true` is an opt-in the service still gates on an update-capability
 * probe, which `overrideAccess` satisfies — the same trust the batched read
 * already carries, and the same identity channels cleared for the same reason.
 */
async function readDraftDefinitions(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    field: string;
    locale: string | undefined;
    budget: QueryBudget;
  }
): Promise<DefinitionsById> {
  const { field, ...rest } = args;
  // Through the SAME reader the batched path uses, so a row is judged readable
  // by one rule. A second unwrapping here is how the two paths would come to
  // disagree about which stored value counts as a definition.
  return definitionsById(await readDraftRows(wanted, rest), field);
}

/**
 * The working-draft rows for `wanted`, one uncached query per id.
 *
 * The per-id half of {@link readDraftDefinitions}, kept apart so the Layout
 * read on a draft route takes the same path, at the same price and with the
 * same identity channels cleared, as the component read beside it.
 */
async function readDraftRows(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    locale: string | undefined;
    budget: QueryBudget;
    /** Relationship depth, for a read that needs only the ids it stores. */
    depth?: number;
  }
): Promise<Record<string, unknown>[]> {
  const { reader, collection, locale, budget, depth } = args;
  const rows: Record<string, unknown>[] = [];
  for (const id of wanted) {
    // One claim per QUERY, exactly as the batched path charges. Here that is
    // one per row, which is the honest price of this read rather than a
    // penalty: a page whose reads outrun the allowance stops fetching and the
    // remainder resolve as missing, with a marker, instead of the route
    // issuing unbounded reads.
    if (!budget.take()) break;
    const row = await reader.findByID({
      collection,
      id,
      draft: true,
      overrideAccess: true,
      disableErrors: true,
      user: undefined,
      req: undefined,
      ...(locale ? { locale } : {}),
      ...(depth === undefined ? {} : { depth }),
    });
    if (row !== null && row !== undefined) rows.push(row);
  }
  return rows;
}

/**
 * One batched, tagged, posture-carrying read of at most a full chunk.
 *
 * Shared by the component read and the Layout read, which ask the same
 * question of different collections: these ids, at the route's posture, tagged
 * per id. `keyName` keeps their cache entries apart, and `select` narrows a
 * read that needs only some columns.
 */
async function readRowsChunk(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    status: "published" | "draft" | "all";
    locale: string | undefined;
    cacheScope: string | undefined;
    keyName: string;
    select?: Record<string, boolean>;
    /** A cap, in seconds, on top of the release bound. */
    maxLifetime?: number;
    /** Relationship depth, for a read that needs only the ids it stores. */
    depth?: number;
  }
): Promise<{ items: Record<string, unknown>[] }> {
  const {
    reader,
    collection,
    status,
    locale,
    cacheScope,
    keyName,
    select,
    maxLifetime,
    depth,
  } = args;
  // How long this read may live, bounded by the next scheduled release —
  // asked for the reason `release-cache-window` states about the two callers
  // it already had: a release member names a scope, and a bound applied to
  // some cached reads and not others leaves the unwired one serving its
  // pre-release content. This is a third such read, so it is a third place
  // that has to ask.
  //
  // Without it the entry is created with `revalidate: false`, so at the
  // release instant the page read around it refreshes while this one stays a
  // cache hit — and the page keeps drawing the pre-release component until
  // some unrelated write happens to bust its id tag.
  const release = await releaseBoundedRevalidate(undefined);
  const revalidate =
    maxLifetime === undefined ? release : cappedLifetime(release, maxLifetime);
  return await cachedFind(
    async () =>
      await reader.find({
        collection,
        where: { id: { in: [...wanted] } },
        limit: wanted.length,
        status,
        overrideAccess: true,
        disableErrors: true,
        user: undefined,
        req: undefined,
        ...(locale ? { locale } : {}),
        ...(select === undefined ? {} : { select }),
        ...(depth === undefined ? {} : { depth }),
      }),
    {
      tags: wanted.map(id => entryIdTag(collection, id)),
      keyParts: [
        keyName,
        collection,
        status,
        locale ?? "",
        // The tenant discriminator, exactly as `resolveContent` keys its own
        // read. Two deployments pointed at different databases ask for the
        // same component ids under the same collection, status and locale —
        // so without this the first to warm the entry serves its definitions
        // to the other's pages.
        cacheScope ?? "",
        // Sorted, so two pages embedding the same components in a different
        // order share one entry rather than filling two with one answer.
        ...[...wanted].sort(),
      ],
      revalidate,
    }
  );
}

/** The rows a batched read returned, keyed by id, with the block field taken. */
function definitionsById(
  items: readonly Record<string, unknown>[],
  field: string
): DefinitionsById {
  const found = new Map<string, BlockDocument>();
  for (const item of items) {
    const id = item.id;
    if (typeof id !== "string") continue;
    // Whatever the field held. A row present with an unusable value is what
    // lets the pipeline say `unreadable` rather than `missing`, so nothing is
    // filtered out here.
    found.set(id, item[field] as BlockDocument);
  }
  return found;
}

/**
 * How one render reads its images, by id, as each image block asks: one
 * answer per id per render, so an image the page draws twice, or a list's
 * template image drawn for each entry, is read once.
 *
 * There is no batch: the system media library's Direct API reads one id at a
 * time, and a bound image is filled only once it carries its whole media
 * object, which is a relation read, not this one.
 */
interface MediaReads {
  readonly resolve: (
    id: string,
    claim?: ReadClaim
  ) => Promise<ResolvedMedia | null>;
}

function mediaResolver(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  budget: QueryBudget
): MediaReads {
  const known = new Map<string, Promise<ResolvedMedia | null>>();
  const readOne = mediaReadOne(config, reader);
  return {
    resolve: (id: string, claim?: ReadClaim) => {
      const kept = known.get(id);
      if (kept !== undefined) return kept;
      // A read is a read: a page whose images all resolve through the media
      // library spends the same budget a loop does, and an exhausted budget
      // resolves to no picture rather than to an unbounded page. A refusal
      // is not kept, so each block it reaches is named as unread.
      if (!budget.take({ ...claim, kind: "image" })) {
        return Promise.resolve(null);
      }
      const reading = readOne(id);
      known.set(id, reading);
      return reading;
    },
  };
}

/** How many ids one read ahead asks for: the readers' own page cap. */
const AHEAD_BATCH_SIZE = 100;

/**
 * A batch's rows by the ids asked for, or `undefined` when they cannot be
 * matched to those ids with certainty: the database's own count must equal
 * the rows returned, and every row must carry a distinct id that was asked
 * for. A read hook that rewrote or dropped an id fails that, and the batch
 * is not trusted; the per-id path, which never matches by a returned id,
 * answers instead.
 */
function rowsById(
  found: { readonly items: readonly unknown[]; readonly meta?: unknown },
  asked: readonly string[]
): Map<string, Record<string, unknown>> | undefined {
  const total = isPlainRecord(found.meta) ? found.meta.total : undefined;
  if (typeof total !== "number" || total !== found.items.length) {
    return undefined;
  }
  const wanted = new Set(asked);
  const rows = new Map<string, Record<string, unknown>>();
  for (const item of found.items) {
    if (!isPlainRecord(item)) return undefined;
    const id = item.id;
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    const key = String(id);
    if (!wanted.has(key) || rows.has(key)) return undefined;
    rows.set(key, item);
  }
  return rows;
}

/**
 * The lifecycle and identity a named media collection is read under, by id or
 * in a batch alike.
 */
function mediaPosture(config: BlocksPageConfig): {
  status: "published" | "draft" | "all";
  overrideAccess: true;
  disableErrors: true;
  user: undefined;
  req: undefined;
  locale?: string;
} {
  return {
    // The SAME scope the entry and reference reads use, not a second
    // opinion. A route configured `draft: true` widens its entry reads,
    // and a preview referencing a never-published image would otherwise
    // render no picture on a page explicitly serving drafts.
    status: config.status ?? (config.draft === true ? "all" : "published"),
    overrideAccess: true,
    disableErrors: true,
    // Cleared for the same reason the entry and reference reads clear it:
    // `mergeConfig` spreads the reader's defaults under the call, so an
    // omitted `user` restores whatever identity the reader was booted
    // with. On an `overrideAccess: true` route a user-sensitive
    // `afterRead` hook would then bake a personalized URL or alt text
    // into the PUBLIC cached page.
    user: undefined,
    // Both identity channels, not just the obvious one. Access rules
    // are written against `req.user`, and `mergeConfig` spreads the
    // instance's defaults UNDER the call — so an omitted `req`
    // restores whatever identity the instance was booted with, on a
    // read this route performs for an anonymous visitor.
    req: undefined,
    // A named collection is an ordinary collection, so its URL and alt
    // fields can be localized. Omitting the locale reads the DEFAULT
    // one's record on a route configured for another — the wrong file, or
    // alt text in the wrong language. The entry and reference reads pass
    // it for the same reason.
    ...(config.locale ? { locale: config.locale } : {}),
  };
}

/** One image's read by id, claimed by the caller. */
function mediaReadOne(
  config: BlocksPageConfig,
  reader: NextlyContentReader
): (id: string) => Promise<ResolvedMedia | null> {
  if (config.resolveMedia) {
    const custom = config.resolveMedia;
    // Charged like every other read on this path. A host's resolver is the one
    // most likely to be database- or network-backed, and it is called once per
    // image — so a template inside nested loops invokes it thousands of times.
    // Exempting it bounds the resolver we wrote and leaves unbounded the one a
    // site supplies, which is the wrong way round.
    // Normalized here rather than trusted, because this ONE function answers
    // both the render and the metadata. Left raw, a record carrying a blank URL
    // was rejected by the derivation — which moved on to the block's own `src`
    // or a later image — while `renderImage` took the same non-nullish value and
    // emitted it, so the preview picture and the page picture disagreed. The
    // usability rule has to live where both callers meet it.
    return async (id: string) => {
      const record = await custom(id);
      return usableMedia(record) ? record : null;
    };
  }
  return async (id: string) => {
    // `disableErrors` on both paths, because `PageContext.resolveMedia`
    // promises `null` for an id it cannot resolve and the readers THROW
    // not-found otherwise. The core image block happens to catch that, so the
    // contract looked kept; a custom block reading the same context would get a
    // rejected promise instead of the documented answer.
    const record = config.mediaCollection
      ? // An explicitly named collection IS a dynamic collection — a site
        // storing its images somewhere of its own — so it reads as one, and
        // that means it has a LIFECYCLE. Issued as a `find` on the id rather
        // than `findByID`, which takes no `status`: a draft image in a site's
        // own collection must not reach a published page, and the query is the
        // only place that scope can be applied before an `afterRead` hook could
        // rewrite the field a post-read check would judge.
        await mediaByQuery(reader, {
          collection: config.mediaCollection,
          id,
          ...mediaPosture(config),
        })
      : await mediaNamespaceOf(reader)?.findByID({ id, disableErrors: true });
    return record ? drawnMedia(record) : null;
  };
}

/** A media record as an image draws it, or `null` for one with no address. */
function drawnMedia(record: Record<string, unknown>): ResolvedMedia | null {
  const { url, altText, width, height } = record;
  // Blank counts as unresolved, not as resolved-to-nothing. A record with an
  // empty URL would otherwise be preferred over the block's own `src`, and an
  // `<img src="">` re-requests the current page in some browsers; metadata
  // would likewise stop here instead of trying the next candidate.
  if (typeof url !== "string" || url.trim() === "") return null;
  return {
    url,
    ...(typeof altText === "string" ? { alt: altText } : {}),
    ...(typeof width === "number" ? { width } : {}),
    ...(typeof height === "number" ? { height } : {}),
  };
}

/**
 * How one render settles its links to entries: one link at a time, as each
 * linking block asks, and in batches, as a list asks for its entries' links
 * before drawing them. One answer per entry per render, which a batch fills.
 */
interface EntryPathReads {
  readonly resolve: (
    collection: string,
    id: string,
    claim?: ReadClaim
  ) => Promise<string | null>;
  readonly ahead: (
    refs: readonly { readonly collection: string; readonly id: string }[],
    claim: ReadClaim
  ) => Promise<void>;
}

/** A filter as the route's trusted reader takes it. */
type RouteWhere = NonNullable<
  Parameters<NextlyContentReader["find"]>[0]["where"]
>;

/** A link whose path waits on the ownership checks. */
interface LinkCandidate {
  readonly id: string;
  readonly slug: string;
  readonly path: string;
}

/** The key one entry's path is kept under for a render. */
function entryKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

/**
 * Resolve a referenced entry to the path it renders at.
 *
 * Uses the route's own `slugField`, so a link points where this route would
 * resolve it. The alternative is a second opinion about where content lives,
 * and a link that 404s while the page it names renders fine.
 */
function entryPathResolver(
  config: BlocksPageConfig,
  isPublic: boolean,
  reader: NextlyContentReader,
  budget: QueryBudget
): EntryPathReads {
  if (config.resolveEntryPath) {
    const custom = config.resolveEntryPath;
    // Charged against the budget like the built-in path. A custom resolver is
    // usually database-backed, and it is called once per reference — so a
    // template inside a nested loop invokes it thousands of times. Exempting it
    // would bound the resolver we wrote and leave unbounded the one a site
    // supplies, which is the wrong way round. It takes one reference, so it
    // has no batch.
    return {
      resolve: async (collection, id, claim) => {
        if (!budget.take({ ...claim, kind: "link" })) return null;
        return custom(collection, id);
      },
      ahead: () => Promise.resolve(),
    };
  }
  const slugField = config.slugField ?? "slug";
  const routeCollections = [...new Set(config.collections)];
  // A route mounted behind the app's own auth (`draft: true`) serves drafts
  // through a trusted, lifecycle-widened read, so a reference to an
  // unpublished page DOES resolve when visited and must keep its href. A
  // per-path `draft` function cannot be consulted here — it answers about a
  // slug this lookup has not found yet — so only the unconditional form
  // widens, and the conditional form stays on the safe published read.
  const alwaysDraft = config.draft === true;
  // The route's own posture, handed in: a public route reads trusted, so a
  // reference lookup on that route must too, or a page resolves an href its
  // own renderer would refuse.
  const overrideAccess = alwaysDraft || isPublic;
  // An EXPLICIT status wins over draft widening, because that is the order
  // `createContentRoute` resolves in: it passes the configured status through
  // to `resolveContent`, where it beats the draft widening. Forcing `all`
  // whenever `draft: true` was set would offer an href for an entry the same
  // route refuses — a never-published target on `{ draft: true, status:
  // "published" }` being the case that shows it.
  const scope = config.status ?? (alwaysDraft ? "all" : "published");

  // Every read on this path, by id or in a batch, under the ROUTE's own
  // policy, not with access overridden. A link is only useful if the path it
  // names resolves, and this route resolves published entries anonymously by
  // default — so a reference to an unpublished or restricted entry would
  // otherwise emit an href that the same route answers with `notFound()`.
  // `find` rather than `findByID`, because the lifecycle scope has to be
  // applied BY THE READER: judging a returned `status` property would treat
  // an ordinary string field named `status` as the lifecycle column.
  const routeFind = async (
    collection: string,
    // Taken from the reader's own signature rather than restated, so a filter
    // this package builds cannot drift from the one the reader accepts.
    where: NonNullable<Parameters<NextlyContentReader["find"]>[0]["where"]>,
    limit: number
  ) =>
    await reader.find({
      collection,
      where,
      limit,
      status: scope,
      overrideAccess,
      // Passed explicitly, even as `undefined`. `mergeConfig` spreads the
      // reader's defaults under the call's arguments, so OMITTING this
      // inherits whatever identity the reader was booted with — and this
      // route resolves anonymously. `resolveContent` passes it likewise.
      user: undefined,
      // Both identity channels, not just the obvious one. Access rules
      // are written against `req.user`, and `mergeConfig` spreads the
      // instance's defaults UNDER the call — so an omitted `req`
      // restores whatever identity the instance was booted with, on a
      // read this route performs for an anonymous visitor.
      req: undefined,
      // A localized slug is read per locale, so omitting this returns the
      // DEFAULT-locale slug while the route resolves paths in the configured
      // one — a link to a path this very route cannot find.
      ...(config.locale ? { locale: config.locale } : {}),
    });

  /**
   * The path a slug renders at, or `null` for none: a slug is stored TEXT, so
   * it can start with `/` — and `//evil.example` interpolates to
   * `///evil.example`, which every browser reads as a protocol-relative URL to
   * another host. Refused rather than stripped: a slug shaped like an address
   * is not a path this route serves under any reading. Then the route's own
   * rule decides, which also refuses the reserved paths `ContentPage` will not
   * serve, the `.`/`..` segments URL resolution removes, and the slugs whose
   * normalized form the lookup would not match.
   */
  const pathOf = (slug: unknown): string | null => {
    if (typeof slug !== "string" || slug.startsWith("/")) return null;
    return emitPath(slug);
  };

  const one = async (
    collection: string,
    id: string,
    take: () => boolean
  ): Promise<string | null> => {
    // Never throws: a stale reference resolves to no rows rather than a
    // rejection, which is what `resolveEntryPath` promises its callers.
    if (!take()) return null;
    const found = await routeFind(collection, { id: { equals: id } }, 1).catch(
      () => ({ items: [] as Record<string, unknown>[] })
    );
    const record = found.items[0];
    if (!record) return null;
    const slug = record[slugField];
    const path = pathOf(slug);
    // Asked BEFORE the ownership probes below, so an unaddressable slug
    // costs no queries.
    if (path === null || typeof slug !== "string") return null;

    // Which entry a URL opens is settled entirely on STORED columns from here
    // down. Every read on this path returns rows through `afterRead`, so any
    // answer derived from a returned `id` is an answer about the hook's output
    // rather than about the database: a hook that rewrites ids breaks the
    // comparison, one that drops them makes two rows identical, and one that
    // maps several rows onto a single public value makes two DIFFERENT rows
    // compare equal. The argument `id` is the stored value the block recorded,
    // so asking the database about it directly is immune to all three.
    //
    // A shared probe: same lifecycle scope and access semantics the route
    // resolves with, so a draft-only row cannot suppress a valid link on a
    // published route. An access denial reads as "no such entry", which is how
    // `resolveContent` treats one — a probe that threw would take down a link
    // whose own read succeeded.
    const probe = async (
      collectionName: string,
      where: NonNullable<Parameters<NextlyContentReader["find"]>[0]["where"]>
    ): Promise<boolean> => {
      // Each probe is its own read. An exhausted budget answers "something else
      // owns this slug", which withholds the link — the same direction every
      // other uncertainty here takes, since no link beats a wrong one.
      if (!take()) return true;
      const probed = await routeFind(collectionName, where, 1).catch(() => ({
        items: [] as Record<string, unknown>[],
      }));
      return probed.items.length > 0;
    };

    // 1. This row really is stored at this slug. It is the returned slug that
    //    was read above, and an `afterRead` hook may have produced it — while
    //    `resolveContent` matches the stored column. Asking for both together
    //    settles it without trusting either value alone.
    if (
      !(await probe(collection, {
        [slugField]: { equals: slug },
        id: { equals: id },
      }))
    ) {
      return null;
    }

    // 2. No row in this collection shares the slug with a LOWER id. That is
    //    exactly the row `resolveContent` would serve instead, since it settles
    //    duplicates with `sort: "id"` — asked as a range over the stored column
    //    rather than by comparing identities the hooks have already touched.
    if (
      await probe(collection, {
        [slugField]: { equals: slug },
        id: { less_than: id },
      })
    ) {
      return null;
    }

    // 3. No EARLIER collection carries the slug. The route searches its
    //    collections in order and serves the first match, so a slug an earlier
    //    one owns belongs to that one, and this link would navigate to a
    //    different document under the same URL.
    for (const earlier of earlierThan(collection)) {
      if (await probe(earlier, { [slugField]: { equals: slug } })) return null;
    }

    return path;
  };

  const earlierThan = (collection: string): string[] =>
    routeCollections.slice(0, routeCollections.indexOf(collection));

  /**
   * How many stored rows match, as the database counts them: the count is
   * made on stored columns, so it answers the probes' questions for many
   * links at once without matching any returned value to a link. `undefined`
   * when the read fails or reports no count, which settles nothing.
   */
  const storedCount = async (
    collection: string,
    where: RouteWhere
  ): Promise<number | undefined> => {
    const found = await routeFind(collection, where, 1).catch(() => undefined);
    const meta: unknown = found?.meta;
    const total = isPlainRecord(meta) ? meta.total : undefined;
    return typeof total === "number" ? total : undefined;
  };

  /**
   * Many links' rows split into those with no path (no row this route can
   * read, or a slug it does not serve) and those whose path the ownership
   * checks must still clear. The database counted exactly these rows, so an
   * id with no row is an entry this route cannot read: no link, as `one`
   * answers.
   */
  const linkRows = (
    rows: ReadonlyMap<string, Record<string, unknown>>,
    ids: readonly string[]
  ): { settled: Map<string, string | null>; candidates: LinkCandidate[] } => {
    const settled = new Map<string, string | null>();
    const candidates: LinkCandidate[] = [];
    for (const id of ids) {
      const slug = rows.get(id)?.[slugField];
      const path = pathOf(slug);
      if (path === null || typeof slug !== "string") settled.set(id, null);
      else candidates.push({ id, slug, path });
    }
    return { settled, candidates };
  };

  /**
   * The three ownership checks of `one`, asked for many links into one
   * collection at once, each as a count the database must answer with
   * `expected`:
   * 1. every (slug, id) pair is stored as read: as many stored rows match
   *    the pairs as there are pairs, each id naming one row;
   * 2. no lower id in this collection shares any of the slugs;
   * 3. no earlier collection of the route carries any of them.
   */
  const ownershipChecks = (
    collection: string,
    candidates: readonly LinkCandidate[]
  ): { collection: string; where: RouteWhere; expected: number }[] => {
    const slugs = [...new Set(candidates.map(({ slug }) => slug))];
    return [
      {
        collection,
        expected: candidates.length,
        where: {
          or: candidates.map(({ id, slug }) => ({
            [slugField]: { equals: slug },
            id: { equals: id },
          })),
        },
      },
      {
        collection,
        expected: 0,
        where: {
          or: candidates.map(({ id, slug }) => ({
            [slugField]: { equals: slug },
            id: { less_than: id },
          })),
        },
      },
      ...earlierThan(collection).map(earlier => ({
        collection: earlier,
        expected: 0,
        where: { [slugField]: { in: slugs } },
      })),
    ];
  };

  /** Whether every check holds, each one read; `spent` once reads run out. */
  const allHold = async (
    checks: readonly {
      collection: string;
      where: RouteWhere;
      expected: number;
    }[],
    take: () => boolean
  ): Promise<boolean | "spent"> => {
    for (const check of checks) {
      if (!take()) return "spent";
      const count = await storedCount(check.collection, check.where);
      if (count !== check.expected) return false;
    }
    return true;
  };

  /**
   * The paths of many links into one collection, settled with a constant
   * number of reads: their rows by `id in`, then each ownership check asked
   * for all of them at once, as a count. Only a batch every count clears is
   * kept; any other leaves each link to `one`, which asks the checks link by
   * link, so a batch never answers differently from it.
   */
  const batch = async (
    collection: string,
    ids: readonly string[],
    take: () => boolean,
    known: Map<string, Promise<string | null>>
  ): Promise<"spent" | undefined> => {
    if (!take()) return "spent";
    const found = await routeFind(
      collection,
      { id: { in: [...ids] } },
      ids.length
    ).catch(() => undefined);
    const rows = found === undefined ? undefined : rowsById(found, ids);
    if (rows === undefined) return undefined;
    const { settled, candidates } = linkRows(rows, ids);
    if (candidates.length > 0) {
      const held = await allHold(ownershipChecks(collection, candidates), take);
      if (held !== true) return held === "spent" ? "spent" : undefined;
      for (const { id, path } of candidates) settled.set(id, path);
    }
    for (const [id, path] of settled) {
      known.set(entryKey(collection, id), Promise.resolve(path));
    }
    return undefined;
  };

  const known = new Map<string, Promise<string | null>>();
  return {
    resolve: (collection, id, claim) => {
      // A collection this route does not serve has no path THIS route can
      // produce: `createContentRoute` searches only its configured
      // collections, so the href would 404 or open an unrelated entry that
      // happens to share the slug. Mapping across routes is what
      // `resolveEntryPath` is for.
      if (!routeCollections.includes(collection)) return Promise.resolve(null);
      const key = entryKey(collection, id);
      const kept = known.get(key);
      if (kept !== undefined) return kept;
      // Kept for the render, and dropped again when a read it needed was
      // refused: a refused probe withholds the link, which is this render's
      // answer for want of reads, not the entry's.
      let refused = false;
      const reading = one(collection, id, () => {
        const granted = budget.take({ ...claim, kind: "link" });
        if (!granted) refused = true;
        return granted;
      });
      known.set(key, reading);
      void reading.then(
        () => {
          if (refused) known.delete(key);
        },
        () => known.delete(key)
      );
      return reading;
    },
    ahead: async (refs, claim) => {
      const take = () => budget.take({ ...claim, kind: "link" });
      const byCollection = new Map<string, Set<string>>();
      for (const { collection, id } of refs) {
        if (!routeCollections.includes(collection) || id.trim() === "")
          continue;
        if (known.has(entryKey(collection, id))) continue;
        const ids = byCollection.get(collection) ?? new Set<string>();
        byCollection.set(collection, ids.add(id));
      }
      for (const [collection, ids] of byCollection) {
        for (const chunk of chunked([...ids], AHEAD_BATCH_SIZE)) {
          if ((await batch(collection, chunk, take, known)) === "spent") return;
        }
      }
    },
  };
}

/**
 * Turn a collection of block documents into rendered pages.
 *
 * The composition `createContentRoute` was built to carry: it resolves a path
 * to an entry and owns `generateMetadata` and the not-found decisions, and this
 * fills in the render with the block renderer over a context wired to the CMS.
 *
 * Wire the result into `app/[[...slug]]/page.tsx`:
 *
 * ```tsx
 * const { ContentPage, generateMetadata } =
 *   createBlocksPage({ collections: ["pages"], field: "content" });
 *
 * export { generateMetadata };
 * export default ContentPage;
 * ```
 *
 * There is no `generateStaticParams` here, and its absence is the contract:
 * access rules decide who may read, so the answer depends on the visitor and no
 * path can be pre-rendered. For public content, {@link createPublicBlocksPage}
 * reads trusted and returns one to export.
 *
 * Draft preview needs no argument here. `createContentRoute` owns the `draft`
 * decision and this passes it through untouched, so a preview arrives as an
 * ordinary entry that happens to be the pending one.
 */
/**
 * The regions a page is drawn inside, and the components they draw: none when
 * the route draws no Layout.
 *
 * The regions' components come through the page's own source, so they are
 * read at the page's posture and locale, tagged by id, and charged to the
 * same budget.
 */
async function layoutRegions(args: {
  config: BlocksPageConfig;
  provider: BlocksLayoutsProvider | undefined;
  entry: ContentEntry;
  locale: string | undefined;
  budget: QueryBudget;
}): Promise<{
  regions: readonly LayoutRegion[];
  regionDefinitions: DefinitionsById;
}> {
  const { config, provider, entry, locale, budget } = args;
  if (provider === undefined) {
    return { regions: [], regionDefinitions: EMPTY_DEFINITIONS };
  }
  const regions = await regionsFor({
    provider,
    entry,
    readRows: layoutRowReader(
      config,
      provider,
      readerFor(config),
      budget,
      locale
    ),
    budget,
    cacheScope: config.cacheScope,
  });
  const regionDefinitions =
    regions.length === 0
      ? EMPTY_DEFINITIONS
      : await definitionsFor(
          regionDocument(regions),
          componentSource(config, readerFor(config), budget, locale),
          effectiveLimits(config)
        );
  return { regions, regionDefinitions };
}

/** Where the entry a page shows lives, which decides how the public reads it. */
type EntrySource = "collection" | "single";

/** What a source read needs: the reader, the page's budget, the shapes. */
interface SourceReads {
  readonly reader: BlocksPublicReader;
  readonly budget: QueryBudget;
  readonly shapes: BlocksFieldShapes;
}

/** How a read is cached: the route's scope, the page's language and window. */
interface ReadCache {
  readonly scope: string;
  readonly locale: string | undefined;
  readonly window: number | false | undefined;
}

/** A record as the public reads it; `null` for none, `undefined` for unread. */
type PublicRecord = Readonly<Record<string, unknown>> | null | undefined;

/**
 * One entry of a collection, by id, as the public reads it, with only the
 * named fields: one claim on the page's budget.
 */
async function readById(
  reads: SourceReads,
  collection: string,
  id: string | number,
  fields: readonly string[],
  kind: ReadKind
): Promise<PublicRecord> {
  if (!reads.budget.take({ kind })) return undefined;
  try {
    // An editor's reader reads by id, which alone returns the working draft
    // of an entry with one pending; a published page's reads as a list does.
    if (reads.reader.findById !== undefined) {
      return await reads.reader.findById({
        collection,
        id,
        select: fields,
      });
    }
    const { items } = await reads.reader.find({
      collection,
      filters: [{ field: "id", op: "equals", value: id }],
      limit: 1,
      select: fields,
    });
    return items[0] ?? null;
  } catch {
    return undefined;
  }
}

/** One Single as the public reads it, with only the named fields: one claim. */
async function readSingle(
  reads: SourceReads,
  slug: string,
  fields: readonly string[]
): Promise<PublicRecord> {
  const findSingle = reads.reader.findSingle?.bind(reads.reader);
  if (findSingle === undefined || !reads.budget.take({ kind: "page" })) {
    return undefined;
  }
  try {
    // The route's public reader caches it, tagged with the Single, so a write
    // to it refreshes the pages that bind it.
    return await findSingle({ slug, select: fields });
  } catch {
    return undefined;
  }
}

/** The collection a field leads to, when a path may follow it. */
function relationTarget(
  fields: readonly BindingFieldShape[] | undefined,
  name: string
): string | undefined {
  const field = fields?.find(candidate => candidate.name === name);
  if (field === undefined || field.hasMany === true) return undefined;
  const kind = bindingKindOf(field);
  return (kind === "reference" || kind === "media") &&
    typeof field.relationTo === "string"
    ? field.relationTo
    : undefined;
}

/**
 * A record with each relation its bindings follow read in place of its id,
 * through the public reader by id: one claim per relation. The public reader
 * returns a relation as its id, so this is the one hop a path may take. A
 * relation the schema does not describe, or a read that is refused, is left
 * as it was, and a binding through it shows its fallback.
 */
async function withRelations(
  record: PublicRecord,
  demand: SourceDemand,
  ref: BlocksFieldShapeRef,
  reads: SourceReads
): Promise<PublicRecord> {
  if (record === null || record === undefined) return record;
  const fields = reads.shapes.fieldsOf(ref);
  let followed: Readonly<Record<string, unknown>> = record;
  for (const [name, inner] of demand.follows) {
    const target = relationTarget(fields, name);
    const id = record[name];
    if (target === undefined) continue;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const related = await readById(reads, target, id, inner, "related");
    if (related !== undefined) followed = { ...followed, [name]: related };
  }
  return followed;
}

/**
 * The entry as the public reads it, with the fields the page binds.
 *
 * Read AGAIN rather than taken from the route: a public route resolves its
 * entry with trusted access, and a draft preview resolves the draft, so the
 * row in hand may hold fields and versions no visitor may see. A Single's page
 * reads its Single; a collection's, its entry by id.
 */
async function readPublicEntry(args: {
  demand: SourceDemand;
  slug: string;
  entryId: unknown;
  entrySource: EntrySource;
  entryRef: BlocksFieldShapeRef;
  reads: SourceReads;
}): Promise<PublicRecord> {
  const { demand, slug, reads } = args;
  let record: PublicRecord;
  if (args.entrySource === "single") {
    record = await readSingle(reads, slug, demand.fields);
  } else {
    const id = args.entryId;
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    record = await readById(reads, slug, id, demand.fields, "page");
  }
  return await withRelations(record, demand, args.entryRef, reads);
}

/** Each Single the page binds, as the public reads it; an unread one is left out. */
async function readSingles(
  demand: ReadonlyMap<string, SourceDemand>,
  reads: SourceReads
): Promise<Map<string, Readonly<Record<string, unknown>> | null>> {
  const singles = new Map<string, Readonly<Record<string, unknown>> | null>();
  for (const [slug, wanted] of demand) {
    const record = await withRelations(
      await readSingle(reads, slug, wanted.fields),
      wanted,
      { single: slug },
      reads
    );
    if (record !== undefined) singles.set(slug, record);
  }
  return singles;
}

/**
 * The site settings the public may read, from `from`, or from the process's
 * registered instance when it is `undefined`: one claim, cached under the
 * settings' own tag, so changing the site's name or time zone refreshes the
 * pages that show them. A stand-in for a reader without the read is named
 * before it is read, whether or not the cache then answers.
 *
 * The cache key holds the route's `cacheScope`, as every public read of a
 * route does: two routes over different instances in one process name their
 * own scopes, or their pages share one site's settings. The key cannot be
 * derived from the instance itself, since the cache outlives the process and
 * an instance has no name that is the same in the next one.
 */
async function readSite(
  from: PublicSiteSettingsSource | undefined,
  cacheScope: string | undefined,
  budget: QueryBudget,
  window: number | false | undefined
): Promise<BlocksSiteSettings | undefined> {
  // One read per page request: the bindings, the lists' zone and a named
  // query's day all ask the same question, and a request holds one budget,
  // so the first ask claims the read and the rest share its answer.
  const key = cacheScope ?? "";
  let asked = siteReadsByRequest.get(budget);
  if (asked === undefined) {
    asked = new Map();
    siteReadsByRequest.set(budget, asked);
  }
  const known = asked.get(key);
  if (known !== undefined) return await known;
  const reading = readSiteOnce(from, cacheScope, budget, window);
  asked.set(key, reading);
  return await reading;
}

/**
 * The site-settings reads a page request has made, by its query budget (one
 * per request) and cache scope: dropped with the request's budget.
 */
const siteReadsByRequest = new WeakMap<
  QueryBudget,
  Map<string, Promise<BlocksSiteSettings | undefined>>
>();

/** One read of the site settings, claimed from `budget`. */
async function readSiteOnce(
  from: PublicSiteSettingsSource | undefined,
  cacheScope: string | undefined,
  budget: QueryBudget,
  window: number | false | undefined
): Promise<BlocksSiteSettings | undefined> {
  if (from instanceof ProcessSiteSettings) warnOfStandIn(from);
  if (!budget.take()) return undefined;
  try {
    return await cachedFind(async () => await readPublicSiteSettings(from), {
      tags: nextlySiteSettingsTags(),
      keyParts: ["nextly-public-site-settings", cacheScope ?? ""],
      revalidate: await releaseBoundedRevalidate(window),
    });
  } catch {
    return undefined;
  }
}

/**
 * The collections whose lists need their fields' shapes while they draw: a
 * list filtering by a day, which compares in the site's zone or as a calendar
 * day by the field's shape, and a list whose entries hold a block its item's
 * fields decide the visibility of.
 */
function listsComparingDays(
  documents: readonly BlockDocument[],
  run: BindingRun | undefined,
  namedQueries: NamedQueryLookup | undefined
): Set<string> {
  return listCollectionsWhere(
    documents,
    (query, list) =>
      query.filters.some(row => isListDay(row.value)) ||
      conditionDemand(list.slots?.[LIST_ENTRY_SLOT] ?? []).any,
    run,
    namedQueries
  );
}

/**
 * Whether any list on the page compares days, and so needs the site's zone:
 * one filtering by a day, or one whose item conditions order a field its
 * collection holds as a date. A list whose item conditions match text, a
 * yes-or-no or a number needs field shapes but no zone, and must not spend
 * the page's query budget reading one. A field whose shape is unknown fails
 * its condition closed, so it compares no day either.
 */
function listsNeedZone(
  documents: readonly BlockDocument[],
  run: BindingRun | undefined,
  shapesOf: (collection: string) => readonly BindingFieldShape[] | undefined,
  namedQueries: NamedQueryLookup | undefined
): boolean {
  return (
    listCollectionsWhere(
      documents,
      (query, list, collection) =>
        query.filters.some(row => isListDay(row.value)) ||
        ordersADay(
          conditionDemand(list.slots?.[LIST_ENTRY_SLOT] ?? []).orderedFields ??
            new Set(),
          shapesOf(collection)
        ),
      run,
      namedQueries
    ).size > 0
  );
}

/**
 * Whether a list whose source is a named query with rows of its own schema
 * orders a date in its item conditions, and so needs the site's zone: such a
 * list draws no collection, so the collections' walk never asks about it.
 * Its fields are the ones its conditions are judged by (`queryRowFields`).
 */
function customRowsNeedZone(
  documents: readonly BlockDocument[],
  run: BindingRun | undefined,
  namedQueries: NamedQueryLookup | undefined
): boolean {
  if (namedQueries === undefined) return false;
  return anyListWhere(
    documents,
    (query, list) => {
      const name = query.namedQuery?.name;
      const rows =
        name === undefined ? undefined : namedQueries.definitionOf(name)?.rows;
      if (name === undefined || rows === undefined || !("fields" in rows)) {
        return false;
      }
      return ordersADay(
        conditionDemand(list.slots?.[LIST_ENTRY_SLOT] ?? []).orderedFields ??
          new Set(),
        queryRowFields(namedQueries, name, () => undefined)
      );
    },
    run
  );
}

/** Whether any of `fields` is a date in `shapes`, as a condition reads it. */
function ordersADay(
  fields: ReadonlySet<string>,
  shapes: readonly BindingFieldShape[] | undefined
): boolean {
  if (fields.size === 0 || shapes === undefined) return false;
  return shapes.some(
    shape => fields.has(shape.name) && conditionFieldKind(shape) === "date"
  );
}

/**
 * The site's zone and the field shapes of the collections whose lists filter
 * by a day or decide a block's conditions per entry; nothing when no list
 * does. The zone is read only where a list compares days. The page's
 * bindings' answers are used where they were already read.
 */
async function listDayInputs(args: {
  config: BlocksPageConfig;
  documents: readonly BlockDocument[];
  bindings: PageBindings | undefined;
  resolver: BlockResolver;
  budget: QueryBudget;
  window: number | false | undefined;
  context: RenderContext;
}): Promise<Pick<PageContext, "timeZone" | "fieldShapes">> {
  // The page's binding pass, so a list whose collection is bound is asked
  // about the collection it will draw.
  const run =
    args.bindings === undefined
      ? undefined
      : pageBindingRun(args.bindings, args.context.locale, args.resolver);
  // A custom source's items are read as its rows' collection's.
  const namedQueries = args.config.namedQueries;
  const collections = listsComparingDays(args.documents, run, namedQueries);
  const customDays = customRowsNeedZone(args.documents, run, namedQueries);
  if (collections.size === 0 && !customDays) return {};
  const cache: ReadCache = {
    scope: args.config.cacheScope ?? "",
    locale: args.context.locale,
    window: args.window,
  };
  const known = new Map<string, readonly BindingFieldShape[] | undefined>();
  for (const collection of collections) {
    try {
      known.set(collection, await cachedFieldShapes({ collection }, cache));
    } catch {
      known.set(collection, undefined);
    }
  }
  // Asked once the shapes are known, so only a date compared needs the zone.
  const timeZone =
    customDays ||
    listsNeedZone(
      args.documents,
      run,
      collection => known.get(collection),
      namedQueries
    )
      ? await listZone(args)
      : undefined;
  return {
    ...(timeZone === undefined ? {} : { timeZone }),
    fieldShapes: {
      fieldsOf: ref =>
        "collection" in ref ? known.get(ref.collection) : undefined,
    },
  };
}

/** The zone a page's lists compare days in, the site read only when needed. */
async function listZone(args: {
  config: BlocksPageConfig;
  bindings: PageBindings | undefined;
  budget: QueryBudget;
  window: number | false | undefined;
  context: RenderContext;
}): Promise<string | undefined> {
  const site =
    args.bindings?.site ??
    (args.config.timeZone === undefined
      ? await readSite(
          siteSettingsSourceFor(args.config),
          args.config.cacheScope,
          args.budget,
          args.window
        )
      : undefined);
  return (
    args.bindings?.timeZone ??
    pageTimeZone(args.config.timeZone, site ?? undefined, args.context)
  );
}

/**
 * One source's field shapes, as `bindingFieldShapes` answers them in the
 * page's language, cached like the page and tagged with the source.
 *
 * Cached because the answer judges which fields the public may read, and that
 * judgement takes the current time to check the access rules are current: a
 * prerender under Cache Components refuses that outside the cache. `null`
 * stands for "no shapes" inside the cache, which keeps values as JSON.
 */
async function cachedFieldShapes(
  ref: BlocksFieldShapeRef,
  cache: ReadCache
): Promise<readonly BindingFieldShape[] | undefined> {
  const shapes = await cachedFind(
    async () =>
      (await bindingFieldShapes(
        ref,
        cache.locale === undefined ? {} : { locale: cache.locale }
      )) ?? null,
    {
      tags:
        "collection" in ref
          ? nextlyTags(ref.collection)
          : nextlySingleTags(ref.single),
      keyParts: [
        "nextly-binding-field-shapes",
        cache.scope,
        cache.locale ?? "",
        shapeRefKey(ref),
      ],
      revalidate: await releaseBoundedRevalidate(cache.window),
    }
  );
  return shapes ?? undefined;
}

/**
 * The field shapes every binding on the page is checked against: the entry's,
 * each Single's, each collection a path follows into, and each list's items'.
 * Read in the page's language, as the visitor sees them; a source it cannot
 * answer for has none, and its bindings are judged by their values.
 */
async function readFieldShapes(
  entryRef: BlocksFieldShapeRef,
  demand: BindingDemand,
  lists: readonly string[],
  cache: ReadCache,
  /** The relations the lists' items follow, whose targets are read too. */
  itemFollows: ReadonlySet<string> = new Set()
): Promise<BlocksFieldShapes> {
  const known = new Map<string, readonly BindingFieldShape[] | undefined>();
  // Lookups that failed: asked once, and not recorded. A recorded `undefined`
  // means the source has no field a visitor may read (or no such source), an
  // answer an editor's canvas acts on; a failed lookup is no answer at all.
  const failed = new Set<string>();
  const fetch = async (ref: BlocksFieldShapeRef) => {
    const key = shapeRefKey(ref);
    if (known.has(key) || failed.has(key)) return known.get(key);
    try {
      const shapes = await cachedFieldShapes(ref, cache);
      known.set(key, shapes);
      return shapes;
    } catch {
      failed.add(key);
      return undefined;
    }
  };
  const sources: [BlocksFieldShapeRef, SourceDemand][] = [
    ...(demand.entry === undefined
      ? []
      : [[entryRef, demand.entry] as [BlocksFieldShapeRef, SourceDemand]]),
    ...[...demand.singles].map(
      ([slug, wanted]) =>
        [{ single: slug }, wanted] as [BlocksFieldShapeRef, SourceDemand]
    ),
  ];
  for (const [ref, wanted] of sources) {
    const fields = await fetch(ref);
    for (const name of wanted.follows.keys()) {
      const target = relationTarget(fields, name);
      if (target !== undefined) await fetch({ collection: target });
    }
  }
  for (const collection of lists) {
    const fields = await fetch({ collection });
    // A list item's binding through a relation is judged by the related
    // collection's public shapes, as the entry's is.
    for (const name of itemFollows) {
      const target = relationTarget(fields, name);
      if (target !== undefined) await fetch({ collection: target });
    }
  }
  // Recorded, so the shapes read can be sent whole to an editor's canvas.
  return recordedFieldShapes(known);
}

/**
 * The time zone a page's date-times are shown in: the route's, else the
 * site's, else UTC. A zone the runtime does not know is said once and UTC is
 * used.
 */
function pageTimeZone(
  routeZone: string | undefined,
  site: BlocksSiteSettings | undefined,
  where: { readonly collection: string; readonly slug: string }
): string | undefined {
  const zone = routeZone ?? site?.timezone ?? undefined;
  if (routeZone === undefined && zone !== undefined) {
    if (!safeTimeZone(zone).valid) {
      console.warn(
        `[blocks] The site's time zone "${zone}" is not one this runtime knows, so bound date-times on "${where.collection}" page "${where.slug}" are shown in UTC.`
      );
    }
  }
  return zone;
}

/**
 * What a binding-source read is given: the documents drawn, where the page's
 * entry is and who reads it.
 *
 * @experimental Settles with the editor's binding sources.
 */
export interface BindingSourcesArgs {
  /** The documents drawn, as the read pipeline prepared them. */
  readonly documents: readonly BlockDocument[];
  /**
   * What the bindings read, when the caller has worked it out already: the
   * editor's canvas works it out from the document it draws and sends only
   * that. Absent, it is read from `documents`.
   */
  readonly demand?: BindingDemand;
  /**
   * The collections the page's lists draw, whose public field shapes judge
   * their items' bindings, when the caller has worked them out already with
   * `listCollections`, as the editor's canvas does. Absent, they are read
   * from `documents`.
   */
  readonly lists?: readonly string[];
  /**
   * The site's named queries, so a custom source's list is asked about the
   * collection its rows are entries of, whose fields its items bind by,
   * where `lists` is read from `documents`. Undefined, such a list's items
   * are judged by their values.
   */
  readonly namedQueries?: NamedQueryLookup | undefined;
  /** Whether the page's entry is a collection's entry or a Single. */
  readonly entrySource: "collection" | "single";
  /** The collection, or the Single, the page's entry belongs to. */
  readonly slug: string;
  /** The entry's id, for a collection's entry. */
  readonly entryId?: unknown;
  /** The page, for what is said about it: its address or its slug. */
  readonly page: string;
  /** The language the sources are read in. */
  readonly locale?: string;
  /**
   * Who reads the entry, the Singles and each relation a path follows: a
   * published page's public reader, or an editor's reader that reads as the
   * person editing. The site settings and the field shapes are the public's
   * whoever reads: the same for everyone, and holding no one's data.
   */
  readonly reader: BlocksPublicReader;
  /** The page's read budget, which every source read claims from. */
  readonly budget: QueryBudget;
  /** The route's cache scope, for the public, shared reads. */
  readonly cacheScope?: string;
  /**
   * The instance the site settings are read from: the one the page's records
   * come from. Absent, the process's registered instance, as before.
   */
  readonly siteSettings?: PublicSiteSettingsSource;
  /** The route's own time zone, which wins over the site's. */
  readonly timeZone?: string;
  /** The release window the public, shared reads are bounded by. */
  readonly window?: number | false;
  /**
   * What the page's blocks' visibility conditions read of its entry, read in
   * the same one read of the entry as its bindings'.
   */
  readonly conditions?: ConditionDemand;
}

/**
 * What a page's bindings read, through `args.reader`, or nothing when the
 * documents it draws hold no binding.
 *
 * Asked of each document as the read pipeline prepared it: composed,
 * migrated, gated, de-duplicated and with its known placeholders removed, so
 * a node the page does not present claims no read. A published page passes
 * its public reader; the editor's canvas passes a reader that reads as the
 * person editing, so the two answer the same question by one implementation.
 *
 * @experimental Settles with the editor's binding sources.
 */
export async function readBindingSources(
  args: BindingSourcesArgs
): Promise<PageBindings | undefined> {
  // Prepared trees are already within the pipeline's caps, and a composed
  // tree may run deeper than a stored one, so no cap is applied again.
  const demand = withConditions(
    args.demand ?? bindingDemand(args.documents),
    args.conditions
  );
  if (!demand.any) return undefined;
  const entryRef: BlocksFieldShapeRef =
    args.entrySource === "single"
      ? { single: args.slug }
      : { collection: args.slug };
  const lists = args.lists ?? [
    ...listCollections(args.documents, args.namedQueries),
  ];
  const shapes = await readFieldShapes(
    entryRef,
    demand,
    lists,
    {
      scope: args.cacheScope ?? "",
      locale: args.locale,
      window: args.window,
    },
    itemFollowsIn(args.documents)
  );
  const reads: SourceReads = {
    reader: args.reader,
    budget: args.budget,
    shapes,
  };
  const entry =
    demand.entry === undefined
      ? undefined
      : await readPublicEntry({
          demand: demand.entry,
          slug: args.slug,
          entryId: args.entryId,
          entrySource: args.entrySource,
          entryRef,
          reads,
        });
  const singles = await readSingles(demand.singles, reads);
  return {
    ...(entry === undefined ? {} : { entry }),
    entryRef,
    singles,
    ...(await siteAndZone(args, demand)),
    fieldShapes: shapes,
  };
}

/**
 * A page's read demand with what its visibility conditions read added: the
 * entry fields they check, read in the same one read of the entry as its
 * bindings', and the site's zone when one orders a value, which may compare
 * days. The entry is read for conditions alone when nothing binds it, since a
 * condition the page cannot check would hide its block.
 */
function withConditions(
  demand: BindingDemand,
  conditions: ConditionDemand | undefined
): BindingDemand {
  if (conditions === undefined || !conditions.any) return demand;
  const fields = new Set([
    ...(demand.entry?.fields ?? []),
    ...conditions.entryFields,
  ]);
  return {
    ...demand,
    any: true,
    formatsDates: demand.formatsDates || conditions.ordersValues,
    ...(fields.size === 0
      ? {}
      : {
          entry: {
            fields: [...fields],
            follows: demand.entry?.follows ?? new Map(),
          },
        }),
  };
}

/**
 * Said once, when a route is built, of a `timeZone` the runtime does not know:
 * every page would otherwise show its date-times in UTC with nothing saying
 * why.
 */
function warnOfUnknownTimeZone(zone: string | undefined): void {
  if (zone === undefined || safeTimeZone(zone).valid) return;
  console.warn(
    `[blocks] timeZone "${zone}" is not a time zone this runtime knows, so bound date-times are shown in UTC.`
  );
}

/**
 * The site settings a page needs, when its bindings name one or a date-time
 * needs the site's zone, and the zone its date-times are shown in.
 */
async function siteAndZone(
  args: Pick<
    BindingSourcesArgs,
    | "slug"
    | "page"
    | "budget"
    | "cacheScope"
    | "siteSettings"
    | "timeZone"
    | "window"
  >,
  demand: BindingDemand
): Promise<{ site?: BlocksSiteSettings; timeZone?: string }> {
  const needsZone = demand.formatsDates && args.timeZone === undefined;
  const site =
    demand.site || needsZone
      ? await readSite(
          args.siteSettings,
          args.cacheScope,
          args.budget,
          args.window
        )
      : undefined;
  const timeZone = pageTimeZone(args.timeZone, site, {
    collection: args.slug,
    slug: args.page,
  });
  return {
    ...(site === undefined ? {} : { site }),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

/** One document a page draws, and the preparation its reads and render share. */
interface DrawnDocument {
  readonly document: BlockDocument;
  readonly prepared: PreparedDocument | null;
}

/** One region of the page's Layout, as drawn. */
interface DrawnRegion extends DrawnDocument {
  readonly region: LayoutRegion;
}

/** Prepare one document once, under the arguments the renderer is given. */
function drawn(
  config: BlocksPageConfig,
  resolver: BlockResolver,
  document: BlockDocument,
  definitions: DefinitionsById
): DrawnDocument {
  return {
    document,
    prepared: prepareDocument(document, {
      resolver,
      ...(config.limits === undefined ? {} : { limits: config.limits }),
      ...(config.styleContext === undefined
        ? {}
        : { styleContext: config.styleContext }),
      ...(definitions.size === 0 ? {} : { definitions }),
    }),
  };
}

/** What a page render, and its metadata, work from. */
interface PageInputs {
  readonly definitions: DefinitionsById;
  readonly page: DrawnDocument;
  readonly regions: readonly DrawnRegion[];
  readonly regionDefinitions: DefinitionsById;
  readonly bindings: PageBindings | undefined;
  /**
   * The documents as the page presents them: composed, migrated and gated,
   * the page's and each region's. What the page's reads are asked of, so a
   * list inside a component is seen where the stored page holds only the
   * component's instance.
   */
  readonly presented: readonly BlockDocument[];
}

/**
 * Everything a page reads before it renders, in ONE order shared by the
 * render and the metadata: the components the page inlines, its Layout's
 * regions and their components, then what its bindings read. Both spend the
 * budget alike, so under a tight one the page and its metadata cannot
 * disagree about a bound value. Each document is prepared once, and that
 * preparation is what the reads are taken from and what the renderer reuses.
 *
 * Metadata draws no region, so it reads the Layout only when the page holds
 * a binding, whose read must come at the same point of the budget as the
 * render's; a page with none reads nothing more for its metadata.
 */
async function readPageInputs(args: {
  config: BlocksPageConfig;
  /** The blocks the renderer is handed, the same object, so it reuses the preparation. */
  resolver: BlockResolver;
  document: BlockDocument;
  entry: ContentEntry;
  context: RenderContext;
  entrySource: EntrySource;
  layoutsProvider: BlocksLayoutsProvider | undefined;
  window: number | false | undefined;
  budget: QueryBudget;
  /** For metadata, which reads the Layout only when the page binds anything. */
  regionsOnlyWhenBound?: boolean;
}): Promise<PageInputs> {
  const { config, document, entry, context, budget } = args;
  // Read BEFORE the element is created, because the renderer's pipeline is
  // synchronous: composition is a pass of it, and a pass cannot await. The
  // route is the layer that can, which is why the fetch lives here and not
  // in the renderer.
  const definitions = await definitionsFor(
    document,
    componentSource(config, readerFor(config), budget, context.locale),
    // The SAME caps the pipeline will read this document under, resolved
    // once. `prepareDocumentReadStages` falls back to the style context's
    // when no limits are given directly, so passing the default here made
    // a route that raised `maxNodes` through `styleContext` fetch for the
    // first 5,000 nodes while the renderer kept — and tried to draw —
    // every instance after them.
    effectiveLimits(config)
  );
  const page = drawn(config, args.resolver, document, definitions);
  // Whether the page's conditions have an entry to judge. A Single's page has
  // none, as the editor and the save say, so its entry-scoped conditions fail
  // closed with nothing read, and its conditioned blocks are never kept for
  // the reads: neither their fields nor what they bind is asked for. The ONE
  // place this is decided; the reads, the skip and the decision follow it.
  const conditionsReadEntry = args.entrySource === "collection";
  // Whether the page reads anything is asked of it with every conditioned
  // block kept, as its reads are taken below: a conditioned block's bindings
  // and its conditions' entry read both spend the budget the render spends,
  // so metadata must read the Layout before them just as the render does.
  // Only metadata asks, and the kept page it prepares is reused for the reads.
  const keptPage =
    conditionsReadEntry &&
    args.regionsOnlyWhenBound === true &&
    holdsBackConditions(page.prepared)
      ? keptForReading(page)
      : undefined;
  const pageReading = keptPage ?? page;
  const skipRegions =
    args.regionsOnlyWhenBound === true &&
    (pageReading.prepared === null ||
      !readsAnything(pageReading.prepared.presented));
  const { regions, regionDefinitions } = await layoutRegions({
    config,
    provider: skipRegions ? undefined : args.layoutsProvider,
    entry,
    locale: context.locale,
    budget,
  });
  const drawnRegions = regions.map(region => ({
    region,
    ...drawn(
      config,
      args.resolver,
      regionDocument([region]),
      regionDefinitions
    ),
  }));
  const parts: DrawnDocument[] = [page, ...drawnRegions];
  // A page holding conditioned blocks is read with all of them kept: a block
  // that may show asks for what it binds, and its conditions name the entry
  // fields they check. Read once, then decided against what was read.
  const conditioned =
    conditionsReadEntry &&
    parts.some(part => holdsBackConditions(part.prepared));
  // The page kept for metadata's question above is the same reading: not
  // prepared a second time.
  const reading = conditioned
    ? parts.map((part, index) =>
        index === 0 && keptPage !== undefined ? keptPage : keptForReading(part)
      )
    : parts;
  const readingDocs = presentedOf(reading);
  const bindings = await readBindingSources({
    documents: readingDocs,
    entrySource: args.entrySource,
    slug: context.collection,
    entryId: entry.id,
    page: context.slug,
    ...(context.locale === undefined ? {} : { locale: context.locale }),
    reader: publicReaderFor(config, context.locale, args.window),
    budget,
    ...(config.cacheScope === undefined
      ? {}
      : { cacheScope: config.cacheScope }),
    // The route's instance, as its records are read through, so the page
    // shows its own site's settings and never the process's.
    siteSettings: siteSettingsSourceFor(config),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    ...(args.window === undefined ? {} : { window: args.window }),
    // A custom source's items bind as entries of its rows' collection.
    namedQueries: config.namedQueries,
    ...(conditioned
      ? { conditions: conditionDemand(readingDocs.flatMap(doc => doc.nodes)) }
      : {}),
  });
  const decided = conditioned
    ? decideConditions(parts, bindings, bindingIssueLog(context))
    : parts;
  const [decidedPage, ...decidedRegions] = decided;
  return {
    definitions,
    page: decidedPage ?? page,
    regions: drawnRegions.map((region, index) => ({
      ...region,
      prepared: decidedRegions[index]?.prepared ?? region.prepared,
    })),
    regionDefinitions,
    bindings,
    presented: presentedOf(decided),
  };
}

/**
 * Whether a presented tree reads anything at the route: a binding, or an
 * entry field a condition checks. A list's item conditions read nothing more
 * than the list does.
 */
function readsAnything(presented: BlockDocument): boolean {
  return (
    bindingDemand([presented]).any ||
    conditionDemand(presented.nodes).entryFields.size > 0
  );
}

/** The trees a set of drawn documents present, the unreadable left out. */
function presentedOf(parts: readonly DrawnDocument[]): BlockDocument[] {
  return parts.flatMap(part =>
    part.prepared === null ? [] : [part.prepared.presented]
  );
}

/** A drawn document with every conditioned block kept, for a route's reads. */
function keptForReading(part: DrawnDocument): DrawnDocument {
  const kept =
    part.prepared === null
      ? null
      : regateDocument(part.prepared, "keep-all")?.prepared;
  return kept === undefined || kept === null
    ? part
    : { ...part, prepared: kept };
}

/**
 * Each drawn document gated by its blocks' conditions against the entry the
 * page shows, as the public reads it: the entry's own published values, and
 * only the fields the public may read. A page whose entry the public may not
 * see, or that has none, fails every entry condition closed. What could not
 * be checked is reported once, through the route's own log.
 */
function decideConditions(
  parts: readonly DrawnDocument[],
  bindings: PageBindings | undefined,
  report: BindingIssuesHandler
): DrawnDocument[] {
  const gate: ConditionGate = {
    ...entrySubjectOf(bindings),
    dayStart: conditionDayStart(bindings?.timeZone),
  };
  const issues: PageIssue[] = [];
  const decided = parts.map(part => {
    const regated =
      part.prepared === null ? null : regateDocument(part.prepared, gate);
    if (regated === null) return part;
    issues.push(...regated.issues);
    return { ...part, prepared: regated.prepared };
  });
  if (issues.length > 0) report(issues);
  return decided;
}

/**
 * How a route reports the bindings a render could not use: one warning per
 * report, naming the page and counting each problem, never a value.
 */
/**
 * The page's overrun, said in the server log: the page, its cap, how many
 * reads it was refused and which blocks were drawn as if their data were
 * missing, by id. Never a value.
 *
 * Once per render, when its refusals first go quiet: they come as the page
 * streams, block by block, so the line waits for a short quiet rather than
 * for a render end it cannot see; reads refused after it are not added. And
 * at most once per page per process in {@link OVERRUN_INTERVAL_MS}, so a
 * page over its cap that is rendered on every visit says so once in a while,
 * not on every visit.
 */
function overrunLog(context: RenderContext): {
  refused(budget: QueryBudget): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let said = false;
  return {
    refused: budget => {
      if (said) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        said = true;
        const report = budget.report?.();
        const page = `${context.collection}\u0000${context.slug}`;
        if (report === undefined || !overrunMayBeSaid(page, Date.now())) {
          return;
        }
        // Each block once, whatever it missed.
        const ids = [...new Set(report.unread.map(block => block.nodeId))];
        const blocks =
          ids.length === 0
            ? "no block could be named"
            : `${String(ids.length)} block(s) drawn as if their data were missing: ${ids.join(", ")}`;
        console.warn(
          `[blocks] "${context.collection}" page "${context.slug}" needed more than its ${String(report.cap)} reads: at least ${String(report.refused)} read(s) refused; ${blocks}.`
        );
      }, OVERRUN_QUIET_MS);
      // Never what keeps a process alive.
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    },
  };
}

/** How long a page's refusals must go quiet before its overrun is logged. */
const OVERRUN_QUIET_MS = 50;

/** How long one page's overrun stays said, per process: ten minutes. */
const OVERRUN_INTERVAL_MS = 10 * 60 * 1000;

/** How many pages' last overrun line a process remembers, oldest dropped. */
const OVERRUN_PAGES_KEPT = 1000;

/** When each page's overrun was last said in this process, oldest first. */
const overrunSaid = new Map<string, number>();

/**
 * Whether a page's overrun may be said now, recording it when it may: not
 * within {@link OVERRUN_INTERVAL_MS} of the last time. The record is bounded,
 * so a site of many pages over their caps cannot grow it without end; a page
 * dropped from it may be said again early, which is the safe direction.
 */
function overrunMayBeSaid(page: string, now: number): boolean {
  const last = overrunSaid.get(page);
  if (last !== undefined && now - last < OVERRUN_INTERVAL_MS) return false;
  // Moved to the end, so the oldest page is the first one dropped.
  overrunSaid.delete(page);
  overrunSaid.set(page, now);
  if (overrunSaid.size > OVERRUN_PAGES_KEPT) {
    const oldest = overrunSaid.keys().next().value;
    if (oldest !== undefined) overrunSaid.delete(oldest);
  }
  return true;
}

/**
 * What a page's lists read ahead for their entries: relations through the
 * public reader, as the page's own bindings read them, judged by the public's
 * field shapes; links through the page's own resolver, whose answers the
 * entries' blocks then take without a read of their own.
 */
function listBatchReads(args: {
  readonly reader: BlocksPublicReader;
  readonly shapes: BlocksFieldShapes | undefined;
  readonly budget: QueryBudget;
  readonly entryPaths: EntryPathReads;
}): ListBatchReads {
  const { reader, shapes, budget } = args;
  return {
    related: async (collection, field, ids, fields, claim) => {
      // Only a relation the public's shapes say is a to-one relation to one
      // collection, as an entry binding's path may follow.
      const target = relationTarget(shapes?.fieldsOf({ collection }), field);
      if (target === undefined) return undefined;
      const wanted = [...new Set(ids.map(String))];
      const found = new Map<string, Readonly<Record<string, unknown>>>();
      for (const chunk of chunked(wanted, AHEAD_BATCH_SIZE)) {
        if (!budget.take({ ...claim, kind: "related" })) break;
        const page = await reader
          .find({
            collection: target,
            filters: [{ field: "id", op: "in", value: chunk }],
            limit: chunk.length,
            select: [...fields],
          })
          .catch(() => undefined);
        // Rows matched to ids only with certainty; otherwise these items
        // keep their ids, and their bindings show their fallbacks.
        const rows = page === undefined ? undefined : rowsById(page, chunk);
        if (rows === undefined) continue;
        for (const [id, row] of rows) found.set(id, row);
      }
      return found;
    },
    entryPaths: args.entryPaths.ahead,
  };
}

function bindingIssueLog(context: RenderContext): BindingIssuesHandler {
  return (issues: readonly PageIssue[]) => {
    const page = `on "${context.collection}" page "${context.slug}"`;
    const bindings = issues.filter(isBindingIssue);
    const conditionIssues = issues.filter(issue => !isBindingIssue(issue));
    // Blocks, not issues: one block can hold several conditions it can't use.
    const conditions = new Set(conditionIssues.map(issue => issue.nodeId)).size;
    if (bindings.length > 0) {
      console.warn(
        `[blocks] ${String(bindings.length)} binding(s) ${page} ` +
          `could not be used as stored and show a fallback or the prop's own value: ${codeSummary(bindings)}.`
      );
    }
    if (conditions > 0) {
      console.warn(
        `[blocks] ${String(conditions)} block(s) ${page} ` +
          `have visibility conditions that could not be checked, so they are left out: ${codeSummary(conditionIssues)}.`
      );
    }
  };
}

/** Each code in a report, with how many times it appears; never a value. */
function codeSummary(issues: readonly PageIssue[]): string {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  return [...counts]
    .map(([code, count]) => `${code} x${String(count)}`)
    .join(", ");
}

/**
 * The site style inputs the config states, for one render.
 *
 * Resolved per render when the config states a provider, so style inputs
 * living in storage reach the next page view rather than the next deploy; a
 * plain value passes through unchanged. A public route caches the provider's
 * read, tagged with the Singles it names, as it caches its other reads: the
 * page is prerendered, and under Cache Components a prerender refuses a read
 * outside the cache that takes the current time, as a Single's read does.
 */
async function configuredSiteStylesFor(
  config: BlocksPageConfig,
  isPublic: boolean,
  window: number | false | undefined
): Promise<SiteStylesInput | undefined> {
  const provider = config.siteStyles;
  if (!isSiteStylesProvider(provider)) return provider;
  if (!isPublic) return await provider.read();
  // `null` stands for "none" inside the cache, which keeps values as JSON.
  const read = await cachedFind(async () => (await provider.read()) ?? null, {
    tags: provider.singles.flatMap(slug => nextlySingleTags(slug)),
    keyParts: siteStylesKey(config, provider),
    revalidate: await releaseBoundedRevalidate(window),
  });
  return read ?? undefined;
}

/**
 * What names a public route's cached site style read: the route, by its scope
 * and the content it serves, and the provider, by the Singles it declares and
 * the source text of its `read`. Every part is the same on every server
 * instance of one build, which a function's identity is not, and two
 * providers that read differently differ in at least one part, unless one
 * function made both over different inputs; such routes over the same
 * content set their own `cacheScope`.
 */
function siteStylesKey(
  config: BlocksPageConfig,
  provider: SiteStylesProvider
): string[] {
  return [
    "nextly-public-site-styles",
    config.cacheScope ?? "",
    JSON.stringify([config.collections, config.field]),
    JSON.stringify([...provider.singles].sort()),
    hashId(String(provider.read)),
  ];
}

function blocksRouteConfig(
  config: BlocksPageConfig,
  isPublic: boolean,
  /**
   * How long the page's list reads may live: the route's own `revalidate`.
   * Its own argument because a Single's config withholds `revalidate` from
   * the page config it borrows, and its lists must not outlive it either.
   */
  listWindow: number | false | undefined = config.revalidate,
  /** A Single's page reads its entry as a Single, not from a collection. */
  entrySource: EntrySource = "collection"
): ContentRouteConfig<ReactElement> {
  const {
    field,
    blocks,
    styles,
    styleContext,
    data,
    blockFallback,
    limits,
    metadata,
    // Consumed by the resolvers built below rather than forwarded: passing them
    // on would hand `createContentRoute` options it does not define.
    mediaCollection: _mediaCollection,
    resolveMedia: _resolveMedia,
    resolveEntryPath: _resolveEntryPath,
    layouts: _layouts,
    timeZone: _timeZone,
    ...routeConfig
  } = config;
  if (data !== undefined && typeof data !== "function") {
    throw new Error(
      "createBlocksPage: `data` takes a function from the route's public reader " +
        "to a provider, such as `reader => createDefaultDataProvider(reader)`, " +
        "not a provider: a page's lists read only through that reader."
    );
  }
  // Checked when the route is built, not when the first page is requested: a
  // provider of the wrong shape would otherwise surface as stale regions on a
  // cached page, long after the deploy that introduced it.
  const layoutsProvider = checkedLayoutsProvider(config.layouts);
  // One resolver object for the route, handed to both the preparation and the
  // renderer: the renderer reuses a preparation only for the very resolver it
  // was made with.
  const resolver = blocks ?? registeredBlocks();
  warnOfUnknownTimeZone(config.timeZone);

  return {
    ...routeConfig,
    // The page is tagged for the records its BLOCKS read, not only for the
    // collection it was resolved from. The media and entry-path resolvers read
    // through plain `findByID`, which contributes no tag, so without this a
    // page cached under `overrideAccess` kept a stale image URL or alt text
    // until something else invalidated it. A site whose blocks reference OTHER
    // collections adds those tags itself through `tags`, which is why these are
    // merged rather than replacing what the caller passed.
    tags: [
      ...(routeConfig.tags ?? []),
      ...nextlyTags(config.mediaCollection ?? MEDIA_TAG_COLLECTION),
      ...routeConfig.collections.flatMap(collection => nextlyTags(collection)),
      // The singles a `siteStyles` provider reads, for the same reason the
      // media collection is above: that read goes through the Direct API and
      // contributes no tag of its own, so a write to the single would otherwise
      // invalidate nothing this page carries.
      ...(isSiteStylesProvider(config.siteStyles)
        ? config.siteStyles.singles
        : []
      ).flatMap(slug => nextlySingleTags(slug)),
    ],
    // Supplied only when asked for, so a route without it keeps whatever
    // `buildMetadata` the caller passed straight through to the content route.
    ...(metadata
      ? {
          buildMetadata: async (entry, context) => {
            const document = readDocument(entry, field, context);
            // Its own budget: metadata generation and the render are separate
            // invocations, so sharing one counter would let the page's reads
            // starve the preview image, or the reverse. Shared BETWEEN the two
            // reads this invocation makes, because they are one page's cost.
            const budget = createQueryBudget(
              config.maxQueries ?? DEFAULT_MAX_QUERIES
            );
            // The same reads, in the same order, as the render: the
            // components the page inlines (without them every instance would
            // be a placeholder, and a page built from components would publish
            // a title its HTML contradicts), the Layout's regions, then what
            // the bindings read. The same order spends the budget alike, so a
            // bound title cannot differ between the page and its metadata.
            const inputs = await readPageInputs({
              config,
              resolver,
              document,
              entry,
              context,
              entrySource,
              layoutsProvider,
              window: listWindow,
              budget,
              regionsOnlyWhenBound: true,
            });
            const derived = await derivePageSeo(
              document,
              resolver,
              mediaResolver(config, readerFor(config), budget).resolve,
              // A later page of the page's list is its own address, so its
              // canonical names it rather than the list's first page.
              listPageSlug(context.slug, context.page),
              limits,
              styleContext,
              config.hostPolicy?.remotePatterns,
              inputs.definitions,
              inputs.bindings,
              context.locale,
              inputs.page.prepared ?? undefined,
              bindingIssueLog(context)
            );
            return metadata(entry, context, derived);
          },
        }
      : {}),
    // The route serves the pages of the one list a page splits into pages,
    // counted as the list itself reads: the same provider, language and
    // terms for comparing days, so the route never serves a page the list's
    // own links do not name, nor refuses one they do.
    listPages: async (entry, context) => {
      const document = readDocument(entry, field, context);
      // Nothing is read for a page whose stored document neither splits a
      // list into pages nor binds a list's split: composing it cannot add
      // one its own nodes do not hold.
      if (
        mayPaginateList(document.nodes, effectiveLimits(config).maxNodes) ===
        undefined
      ) {
        return null;
      }
      // Counted under the page's read allowance, spent in the render's own
      // order up to the list: the page's inputs (its components, its Layout's
      // regions, what its bindings read), then the terms its lists compare
      // days by, then the list's own read. A page whose allowance runs out
      // before the list (`maxQueries: 0`, or spent on those reads) has no
      // later pages, since its list draws none.
      const budget = createQueryBudget(
        config.maxQueries ?? DEFAULT_MAX_QUERIES
      );
      const { page, bindings, presented } = await readPageInputs({
        config,
        resolver,
        document,
        entry,
        context,
        entrySource,
        layoutsProvider,
        window: listWindow,
        budget,
      });
      // The list as the render draws it: composed with its components'
      // definitions, repaired and held to the caps.
      const list = pagedListOf(
        document,
        page,
        effectiveLimits(config).maxNodes,
        bindings === undefined
          ? undefined
          : pageBindingRun(bindings, context.locale, resolver)
      );
      if (list === undefined) return null;
      // A list that makes no read shows one page, and claims nothing.
      if (!listWillRead(list.props)) return 1;
      const days = await listDayInputs({
        config,
        documents: presented,
        bindings,
        resolver,
        budget,
        window: listWindow,
        context,
      });
      // A custom source counts its pages from its run's total, as the
      // render runs it. Its reads claim from the allowance as they are
      // made, so nothing is claimed ahead of the run.
      const namedPages = await namedListPages(
        list,
        namedQueryHostFor({
          config,
          locale: context.locale,
          window: listWindow,
          budget,
          context,
        }),
        budget,
        context.locale
      );
      if (namedPages !== undefined) return namedPages;
      // The list's first read, claimed where the render claims it: after
      // the page's inputs and day terms, before any block is drawn.
      const claim: ReadClaim = { kind: "entries", nodeId: list.id };
      if (!budget.take(claim)) return 1;
      const counted = await listEntryCount(
        list.props,
        { locale: context.locale, ...days },
        dataFor(data, config, context.locale, listWindow),
        () => budget.take(claim)
      ).catch(() => undefined);
      // A list whose read cannot say how many entries it matches shows its
      // first page alone, as a list that fails to read shows its empty state.
      return counted === undefined
        ? 1
        : listPagesOf(list.props, counted.matching);
    },
    render: async (entry, context) => {
      const document = readDocument(entry, field, context);
      const resolved = styles ? await styles(entry, context) : undefined;

      // Built from the reader the ROUTE resolved this entry through, handed
      // over in the context. A page and the records it embeds then always come
      // from one instance, which on a per-tenant setup is one database.
      // Created before the resolvers, because they claim from it too: a loop
      // over N entries whose template holds one link performs about 3N reads
      // through `resolveEntryPath`, which is exactly the amplification this
      // bounds — and a budget only the loop claimed from would have counted the
      // one read that multiplies while ignoring the ones it multiplies INTO.
      // It says when it is outrun, so the page's overrun is logged once,
      // naming the page, the cap and the blocks drawn without their data.
      const overrun = overrunLog(context);
      const budget = createQueryBudget(
        config.maxQueries ?? DEFAULT_MAX_QUERIES,
        { onRefused: () => overrun.refused(budget) }
      );
      const media = mediaResolver(config, readerFor(config), budget);
      const entryPaths = entryPathResolver(
        config,
        isPublic,
        readerFor(config),
        budget
      );

      // `isWorkingDraft` is surfaced, not acted on: the renderer draws the
      // pending content either way, and a host that wants to say so on the page
      // has to be told which one it got.
      const pageContext: PageContext = createStandaloneContext({
        entry,
        // So a list of the entry's related entries reads the relation as the
        // public reads this entry. A Single's page has no collection entry,
        // and the provider reads no Single.
        ...(entrySource === "collection"
          ? { entryCollection: context.collection }
          : {}),
        // Reported by the route, not read off the row: the companion overlay
        // copies localized values onto the entry without stamping which locale
        // produced them, so inferring it here finds nothing on exactly the
        // localized pages that need it.
        locale: context.locale,
        isWorkingDraft: entry[WORKING_DRAFT_KEY] === true,
        // A working draft is served only to an author previewing it, so a
        // list there tells that author what it could not read as stored. A
        // published page never does.
        diagnostics: entry[WORKING_DRAFT_KEY] === true,
        data: dataFor(data, config, context.locale, listWindow),
        // Fresh for THIS render. `core/collection-loop` claims from it before
        // each read, and an absent budget reads as unlimited — the loop's own
        // check is `ctx.queries?.take() === false` — so a routed page without
        // one is unbounded by construction.
        queries: budget,
        resolveMedia: media.resolve,
        resolveEntryPath: entryPaths.resolve,
        // The published page draws the Lucide set, vendored with this package.
        resolveIcon: resolveLucideIcon,
        // A list whose source is a named query runs it as a visitor reads.
        namedQueries: namedQueryHostFor({
          config,
          locale: context.locale,
          window: listWindow,
          budget,
          context,
        }),
        // The page of its list this address draws, and where the others are.
      });

      const configuredSiteStyles = await configuredSiteStylesFor(
        config,
        isPublic,
        listWindow
      );
      // Derived ONCE, from the breakpoints the site already stated. A second
      // answer to "what are this site's breakpoints" is how the shared sheet
      // and the page sheet come to disagree about which at-rules a tier is
      // emitted under — and the disagreement is invisible, because each sheet
      // is internally consistent.
      const siteBreakpoints =
        configuredSiteStyles?.breakpoints ?? styleContext?.breakpoints;
      // A route emits the site sheet by DEFAULT: without it every `{ $token }`
      // resolves to nothing, which is the defect this closes. It needs a
      // breakpoint set to compile the block-default tier under, so a route that
      // states neither its own nor a style context gets no sheet rather than one
      // compiled against breakpoints nobody chose.
      const siteStyles =
        siteBreakpoints === undefined
          ? undefined
          : { ...configuredSiteStyles, breakpoints: siteBreakpoints };

      const {
        definitions,
        page,
        regions,
        regionDefinitions,
        bindings,
        presented,
      } = await readPageInputs({
        config,
        resolver,
        document,
        entry,
        context,
        entrySource,
        layoutsProvider,
        window: listWindow,
        budget,
      });

      // What every document drawn on this page shares: the context (so the
      // regions spend the page's ONE budget and read in its locale), the
      // blocks, the caps, the host's posture and the page's bindings.
      // What a list's date filter needs to compare whole days: the site's
      // zone and the public's field shapes, read only when a list on the
      // page filters by a day. Asked of the documents as presented, as the
      // bindings are, so a list inside a component is seen.
      const listDays = await listDayInputs({
        config,
        documents: presented,
        bindings,
        resolver,
        budget,
        window: listWindow,
        context,
      });
      // The paginated list's first read, claimed now: after the page's inputs
      // and day terms, before any block is drawn, which is the order the
      // route counted its pages in. So a block drawn before the list cannot
      // spend the read the count relied on, and the route and the page agree
      // on whether the list reads at all. Only where the route serves later
      // pages (a Single's gives no addresses, so its list shows one page and
      // claims its own read); a list whose read cannot be claimed draws no
      // links, as the route serves none of its later pages.
      const pagedList = pagedListOf(
        document,
        page,
        effectiveLimits(config).maxNodes,
        bindings === undefined
          ? undefined
          : pageBindingRun(bindings, context.locale, resolver)
      );
      const listPage = claimedListPage(pagedList, context, budget);
      // What a list reads ahead for its entries, through the page's own
      // reads: relations as the public reads them, links as the blocks drawn
      // inside the entries would read them one by one.
      const listReads = listBatchReads({
        reader: publicReaderFor(config, context.locale, listWindow),
        shapes: bindings?.fieldShapes,
        budget,
        entryPaths,
      });
      const shared: SharedRendererProps = {
        context: {
          ...pageContext,
          ...listDays,
          ...(listPage === undefined ? {} : { listPage }),
          listReads,
        },
        blocks: resolver,
        styleContext,
        blockFallback,
        limits,
        // Spread conditionally: `PageRenderer` distinguishes an absent policy
        // from one present and undefined, and passing the second would state a
        // posture the site never chose.
        ...(config.hostPolicy === undefined
          ? {}
          : { hostPolicy: config.hostPolicy }),
        ...(bindings === undefined
          ? {}
          : { bindings, onBindingIssues: bindingIssueLog(context) }),
      };
      const pageProps: PageRendererElementProps = {
        ...shared,
        document,
        styles: resolved,
        // Spread conditionally: a page holding no instance resolves to an
        // empty map, and handing `PageRenderer` an empty map rather than
        // nothing states that definitions WERE fetched and none was found —
        // which is the honest answer for a page that references none, and the
        // wrong one for a caller that never asked.
        ...(definitions.size === 0 ? {} : { definitions }),
        // Prepared once above, for the reads; the renderer reuses it.
        ...(page.prepared === null ? {} : { prepared: page.prepared }),
      };

      if (regions.length === 0) {
        return createElement(PageRenderer, {
          ...pageProps,
          ...(siteStyles === undefined ? {} : { siteStyles }),
        });
      }
      return createElement(
        Fragment,
        null,
        ...drawWithRegions({
          regions,
          page: pageProps,
          shared,
          siteStyles,
          definitions: regionDefinitions,
        })
      );
    },
  };
}

/** The renderer props every document drawn on one page shares. */
type SharedRendererProps = Pick<
  Parameters<typeof PageRenderer>[0],
  | "context"
  | "blocks"
  | "styleContext"
  | "blockFallback"
  | "limits"
  | "hostPolicy"
  | "bindings"
  | "onBindingIssues"
>;

/** The page's own renderer props, less the site sheet decision. */
type PageRendererElementProps = Omit<
  Parameters<typeof PageRenderer>[0],
  "siteStyles"
>;

/**
 * The header region, the page, then the footer region, as sibling elements.
 *
 * Each region is wrapped in its landmark, `<header>` or `<footer>`, carrying
 * `data-nextly-region` naming its area. A landmark rather than a plain `div`
 * because that is what a header and a footer ARE to a screen reader moving by
 * region, and the Layout is the only place that knows which is which; the
 * attribute is the stable hook for a host's own CSS or a test, independent of
 * the markup a component draws inside. Neither wrapper adds a style: the
 * region's own page root carries every rule the component compiled to.
 *
 * The site sheet is emitted ONCE, by whichever document is drawn first. Every
 * document's own rules are anchored at one specificity and settled by source
 * order, so the site sheet (block defaults, named classes) has to come before
 * all of them: emitted by the page with a header above it, the block defaults
 * would land AFTER the header's own rules and beat them. The other documents
 * are rendered with `siteStyles={false}` and the page compile context that
 * sheet implies, so their own rules compile exactly as they would beside it.
 *
 * A region's styles reach the page the way a placed component's do: a
 * composed document never matches a stored stylesheet, so its sheet is
 * compiled during the render from the route's compile context.
 */
function drawWithRegions(args: {
  regions: readonly DrawnRegion[];
  page: PageRendererElementProps;
  shared: SharedRendererProps;
  siteStyles: SiteSheetInput | undefined;
  definitions: DefinitionsById;
}): ReactElement[] {
  const { regions, page, shared, siteStyles, definitions } = args;
  const header = regions.find(part => part.region.area === "header");
  const footer = regions.find(part => part.region.area === "footer");
  // In the order they are drawn: header, page, footer.
  const parts: (DrawnRegion | "page")[] = [
    ...(header === undefined ? [] : [header]),
    "page" as const,
    ...(footer === undefined ? [] : [footer]),
  ];
  // One answer for every surface drawing a page inside its Layout: which part
  // emits the site sheet, and the scope each part compiles under.
  const sheets = layoutPartSheets({
    parts: parts.map(
      (part): PagePart => (part === "page" ? part : part.region.area)
    ),
    styleContext: shared.styleContext,
    siteStyles,
    pageScope:
      typeof page.styles?.scope === "string" ? page.styles.scope : undefined,
  });
  return parts.map((part, index) => {
    const sheet = sheets[index] ?? {};
    if (part === "page") {
      return createElement(PageRenderer, { ...page, ...sheet, key: "page" });
    }
    const area = part.region.area;
    return createElement(
      area,
      { key: area, "data-nextly-region": area },
      createElement(PageRenderer, {
        ...shared,
        ...sheet,
        // The document the region was prepared from, so the renderer reuses
        // that preparation rather than running the pipeline again.
        document: part.document,
        ...(definitions.size === 0 ? {} : { definitions }),
        ...(part.prepared === null ? {} : { prepared: part.prepared }),
      })
    );
  });
}

/**
 * A blocks page over ACCESS-ENFORCED content — the secure default.
 *
 * Returns no `generateStaticParams`, because an enforced route answers per
 * visitor and has no set of paths to build. See
 * {@link createContentRoute} for why offering one anyway is a defect rather
 * than an unused convenience.
 */
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
 * Turn a Single config into the route config, reusing the PAGE route's render.
 *
 * The render is borrowed rather than rebuilt. It carries the query budget, the
 * media and entry-path resolvers, the style compilation and the SEO derivation,
 * and a second copy of that for Singles would agree on the day it was written
 * and drift afterwards — silently, because both would still draw a page.
 *
 * The borrowed callbacks expect a resolved-path context. A Single has no
 * resolved path, so one is synthesised from its slug: it reaches `readDocument`,
 * whose error names where a missing field was looked for, and the SEO
 * derivation, which uses it as the page's own identity.
 */
/**
 * The options a Single route takes verbatim from a blocks config.
 *
 * Split out because they are pure passthrough — every one is "state it only if
 * the caller did" — while the function below assembles the parts that are
 * DERIVED from the page route. Keeping the two apart means adding a passthrough
 * costs a line here rather than another branch in the assembly.
 *
 * Spread rather than assigned: an explicit `undefined` is not the same as an
 * absent key, because the route's own defaults are what an absent key selects.
 */
function singlePassthrough(
  config: BlocksSinglePageConfig
): Partial<SingleRouteConfig<ReactElement>> {
  const { locale, depth, nextly, revalidate, draft, trustedCollections } =
    config;
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(depth === undefined ? {} : { depth }),
    ...(nextly === undefined ? {} : { nextly }),
    ...(revalidate === undefined ? {} : { revalidate }),
    // Passed straight to the Single route, which is where the refusal lives:
    // `createPublicSingleRoute` rejects a draft hook at construction, so
    // `createPublicSinglePage` inherits that rather than restating it.
    ...(draft === undefined ? {} : { draft }),
    ...(trustedCollections === undefined ? {} : { trustedCollections }),
  };
}

function blocksSingleConfig(
  config: BlocksSinglePageConfig,
  isPublic: boolean
): SingleRouteConfig<ReactElement> {
  // `draft` and `trustedCollections` are pulled out rather than left in the
  // rest, because what follows hands `blocksOptions` to the PAGE route's config
  // builder, whose `draft` hook has the collection shape — resolving an entry id
  // this route has nothing to compare against.
  const {
    slug,
    tags,
    revalidate: _revalidate,
    draft: _draft,
    trustedCollections: _trustedCollections,
    // Withheld even from a JavaScript caller who passes it anyway, which the
    // type above refuses: a Single route draws no regions.
    layouts: _layouts,
    ...blocksOptions
  } = config as BlocksSinglePageConfig & { layouts?: unknown };

  const routeConfig = blocksRouteConfig(
    {
      ...blocksOptions,
      collections: [slug],
      // The LITERAL intent, carried; the hook, still not. `draft: true` is a
      // statement about what this route serves, and the reads it governs here —
      // the components a page embeds and the media they reference — are the
      // page's own, not the Single's. Dropped along with the hook, a Single
      // serving its working draft still drew every embedded component from the
      // published read, and referenced a never-published image as no picture at
      // all. A FUNCTION is still withheld: it resolves an entry id this route
      // has nothing to compare against.
      ...(config.draft === true ? { draft: true } : {}),
    },
    isPublic,
    config.revalidate,
    "single"
  );

  const contextFor = (context: SingleContext) => ({
    collection: slug,
    slug,
    ...(context.locale === undefined ? {} : { locale: context.locale }),
  });

  return {
    slug,
    ...singlePassthrough(config),
    // The media tag comes from the page route's own tag set, which is computed
    // for a collection this route does not have. Taking it from there rather
    // than recomputing keeps one answer to "what does a blocks page depend on".
    tags: [...(routeConfig.tags ?? []), ...(tags ?? [])],
    render: (document, context) =>
      routeConfig.render(document, contextFor(context)),
    ...(routeConfig.buildMetadata
      ? {
          buildMetadata: (document: SingleDocument, context: SingleContext) =>
            // Non-null asserted by the branch: this arm exists only when the
            // page route produced one.
            routeConfig.buildMetadata?.(document, contextFor(context)) ?? {},
        }
      : {}),
  };
}

/**
 * Whether this app builds with Cache Components on.
 *
 * Read here, in code the app bundles, because Next.js inlines
 * `process.env.__NEXT_CACHE_COMPONENTS` only into that; nextly, loaded as a
 * server external, cannot see it. The value is a build-time constant, so the
 * factories decide once, when they build a route.
 */
function underCacheComponents(): boolean {
  return cacheComponentsEnabled(process.env.__NEXT_CACHE_COMPONENTS);
}

/**
 * A route's page body inside a Suspense boundary the page provides, which
 * only Cache Components needs.
 *
 * What a page reads at request time (the draft gate's cookie, an enforced read,
 * a param the build did not list) is read in the body, so under Cache
 * Components the boundary is where the prerender stops, and everything above
 * it is a static shell.
 *
 * Without Cache Components the factories return the route's own page instead.
 * A boundary there would let the shell stream before the body's read, so a page
 * that calls `notFound()` (an unknown or unpublished entry) would answer 200
 * with the not-found page rather than a 404.
 *
 * The pages below build this before awaiting anything, because a read above
 * the boundary is the one Cache Components refuses to prerender. They still
 * return a promise, so each keeps the type of the route page it wraps.
 */
function withinBoundary(body: ReactElement): ReactElement {
  return createElement(Suspense, { fallback: null }, body);
}

function singleWithinBoundary(
  route: SingleRoute<ReactElement>
): SingleRoute<ReactElement> {
  if (!underCacheComponents()) return route;
  return {
    ...route,
    SinglePage: () =>
      Promise.resolve(withinBoundary(createElement(route.SinglePage))),
  };
}

function contentWithinBoundary<R extends ContentRoute<ReactElement>>(
  route: R
): R {
  if (!underCacheComponents()) return route;
  return {
    ...route,
    ContentPage: args =>
      Promise.resolve(withinBoundary(createElement(route.ContentPage, args))),
  };
}

/**
 * A Single rendered as a blocks page, over ACCESS-ENFORCED content.
 *
 * The secure default, and the one to reach for unless the Single is wholly
 * public: it reads as the visitor would and waits for the request, so the
 * build touches no database.
 */
export function createSinglePage(
  config: BlocksSinglePageConfig
): SingleRoute<ReactElement> {
  return singleWithinBoundary(
    createSingleRoute<ReactElement>(blocksSingleConfig(config, false))
  );
}

/**
 * A Single rendered as a blocks page, over PUBLIC content: trusted, cached,
 * pre-renderable.
 *
 * Busted by a write to the Single, so publishing updates the live page without
 * a rebuild — but it is rendered during `next build`, so the build needs a
 * reachable database.
 */
export function createPublicSinglePage(
  config: BlocksSinglePageConfig
): SingleRoute<ReactElement> {
  return singleWithinBoundary(
    createPublicSingleRoute<ReactElement>(blocksSingleConfig(config, true))
  );
}

export function createBlocksPage(
  config: BlocksPageConfig
): ContentRoute<ReactElement> {
  return contentWithinBoundary(
    createContentRoute<ReactElement>(blocksRouteConfig(config, false))
  );
}

/**
 * A blocks page over PUBLIC content: trusted reads, cacheable, pre-renderable.
 *
 * Returns `generateStaticParams` for the route file to export.
 */
export function createPublicBlocksPage(
  config: BlocksPageConfig
): StaticContentRoute<ReactElement> {
  return contentWithinBoundary(
    createPublicContentRoute<ReactElement>(blocksRouteConfig(config, true))
  );
}

/**
 * `BlockSeoContribution` and `BlockSeoImage` are NOT re-exported here even
 * though `DerivedPageSeo` extends the first and this entry's SEO derivation is
 * their only consumer.
 *
 * They are exported from the package root instead, which resolves without the
 * `next` and `nextly` peers this entry's declarations import. A caller of
 * `createBlocksPage` can always reach the root; a block author on a standalone
 * install could not reach this entry, and two import paths for one type costs
 * more than the one path both audiences already have.
 */
