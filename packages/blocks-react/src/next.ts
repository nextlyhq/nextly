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
  DEFAULT_LIMITS,
  deriveSeoFromDocument,
  isFetchableUrl,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  DefinitionsById,
  BlockSeoContribution,
  DocumentLimits,
  RemotePatternInput,
  SeoImageCandidate,
  SiteSheetInput,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { Metadata } from "next";
import {
  cachedFind,
  createContentRoute,
  createPublicContentRoute,
  createPublicSingleRoute,
  createSingleRoute,
  entryIdTag,
  getNextly,
  nextlyTags,
  releaseBoundedRevalidate,
  nextlySingleTags,
  slugToStaticParam,
} from "nextly/runtime";
import type {
  ContentEntry,
  ContentRoute,
  StaticContentRoute,
  ContentRouteConfig,
  NextlyContentReader,
  NextlySingleReader,
  RenderContext,
  SingleContext,
  SingleDocument,
  SingleRoute,
  SingleRouteConfig,
} from "nextly/runtime";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";

import { url } from "./blocks/props";
import {
  COMPONENT_DOCUMENT_FIELD,
  COMPONENT_TAG_COLLECTION,
  definitionsFor,
  EMPTY_DEFINITIONS,
  type ComponentSource,
} from "./component-source";
import { createStandaloneContext } from "./context";
import type {
  BlockHostPolicy,
  BlocksDataProvider,
  PageContext,
  QueryBudget,
  ResolvedMedia,
} from "./context";
import { PageRenderer } from "./page-renderer";
import { prepareDocumentForRead } from "./prepare-document";
import { registeredBlocks } from "./resolver";
import type { BlockResolver } from "./resolver";
import type { PageStyles } from "./styles";
import { isUnconditional } from "./visibility";

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
   * The single slugs `read` consults, so a write to one busts this page.
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
  /** Data access for dynamic blocks. */
  data?: BlocksDataProvider;
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
}

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
  // The route's OWN answer, not a second opinion. `slugToStaticParam` is what
  // `generateStaticParams` pre-renders from, so deriving the path any other way
  // is how a canonical or a link comes to name somewhere the route does not
  // serve. It collapses repeated and edge slashes — Next answers `/a//b` with a
  // 308 to `/a/b`, and the lookup then asks for a slug the entry does not have —
  // refuses reserved paths, and refuses the segments URL resolution removes.
  //
  // An empty slug is the HOMEPAGE, which the route resolves at `/` and
  // pre-renders as `{ slug: [] }`. Treating it as missing would strip the
  // destination from every button pointing at the site root.
  const param = slugToStaticParam(slug);
  if (param === null) return null;
  if (param.slug.length === 0) return "/";
  // Encoded per segment: Next hands this route DECODED segments while the
  // request used their encoded form, so `faq?all` emitted raw is read as a path
  // plus a query.
  return `/${param.slug.map(encodeURIComponent).join("/")}`;
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
  return config.nextly ?? getNextly();
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
  definitions: DefinitionsById | undefined
): Promise<DerivedPageSeo> {
  const resolver = blocks ?? registeredBlocks();
  // Spread rather than assigned, so an unaddressable slug OMITS the key instead
  // of carrying `undefined`. The result is spread over a caller's own fallbacks,
  // where a present-but-undefined key erases a canonical they already knew.
  const path = emitPath(slug);
  const canonical = path === null ? {} : { canonical: path };

  // One authoritative preparation, shared with the renderer rather than
  // restated here. Hand-copying the passes is what let metadata describe a
  // different page than the HTML: the copy drifted on the format guard, the
  // configured caps, duplicate-id repair and placeholder subtrees, each a
  // separate way to publish content the page withholds.
  const prepared = prepareDocumentForRead(document, {
    resolver,
    limits,
    styleContext,
    // Spread conditionally, matching the renderer: an absent map says the
    // caller never fetched, an empty one says it fetched and found none, and
    // the pipeline reports those differently.
    ...(definitions === undefined || definitions.size === 0
      ? {}
      : { definitions }),
  });
  // Nothing readable means nothing to describe. The page renders a placeholder,
  // and metadata claiming a title it does not show would be worse than silence.
  if (prepared === null) return canonical;

  const { image: imageCandidates, ...text } = deriveSeoFromDocument(
    prepared,
    type => resolver.get(type),
    isUnconditional
  );
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
 * Reads one page render may perform when the route was given no number.
 *
 * Generous for a page and small against a database: a document would have to
 * nest loops to approach it, which is the shape the budget exists to bound. A
 * page that exceeds it renders what it could reach rather than failing, so the
 * cost of the default being low is visible content, while the cost of having no
 * default at all is an unbounded read amplification reachable by URL.
 */
export const DEFAULT_MAX_QUERIES = 500;

/**
 * A budget for ONE page render.
 *
 * Created per render rather than per route: the counter is spent, so a single
 * budget shared across requests would exhaust on the first few pages and serve
 * every later request truncated — a fault that grows with uptime and disappears
 * on restart, which is the hardest kind to attribute.
 */
function createQueryBudget(max: number): QueryBudget {
  // `NaN` is what `Number(process.env.MAX_QUERIES)` produces for an unset or
  // malformed variable, and every comparison against it is false — so
  // `remaining <= 0` never fires and the budget silently becomes unlimited.
  // That is the failure this exists to prevent, reached by a configuration
  // mistake rather than by a document.
  let remaining = Number.isNaN(max) ? DEFAULT_MAX_QUERIES : max;
  return {
    take: () => {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  };
}

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
    return async ids => (budget.take() ? await custom(ids) : EMPTY_DEFINITIONS);
  }
  const collection = config.componentCollection ?? COMPONENT_TAG_COLLECTION;
  const field = config.componentField ?? COMPONENT_DOCUMENT_FIELD;
  const status = config.status ?? (config.draft === true ? "all" : "published");

  return async (ids: readonly string[]) => {
    // Dropped before anything is built from them, not repaired. `entryIdTag`
    // refuses a blank segment by THROWING — correctly, because a bare
    // `nextly:components:id:` tag would over-invalidate — and a stored
    // `componentId` of `"   "` is a nonempty string that `componentIdsIn`
    // reports as a reference. Left in, one malformed instance takes the whole
    // page down before a block boundary exists to contain it; left out, it is
    // an id nobody supplied a definition for, which is exactly what it is.
    const wanted = [...new Set(ids)].filter(id => id.trim().length > 0);
    if (wanted.length === 0) return EMPTY_DEFINITIONS;

    const found = new Map<string, BlockDocument>();
    for (const chunk of chunked(wanted, COMPONENT_BATCH_SIZE)) {
      // One claim per QUERY. A page embedding twenty components spends one
      // read because that is what it costs; charging per definition would
      // refuse a page for an allowance it never spent, and charging nothing
      // would leave the read on this path that grows with the page unbounded.
      if (!budget.take()) break;
      const page = await readComponentChunk(chunk, {
        reader,
        collection,
        status,
        locale,
        cacheScope: config.cacheScope,
      });
      for (const [id, document] of definitionsById(page.items, field)) {
        found.set(id, document);
      }
    }
    return found;
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

/** One batched, tagged, posture-carrying read of at most a full chunk. */
async function readComponentChunk(
  wanted: readonly string[],
  args: {
    reader: NextlyContentReader;
    collection: string;
    status: "published" | "draft" | "all";
    locale: string | undefined;
    cacheScope: string | undefined;
  }
): Promise<{ items: Record<string, unknown>[] }> {
  const { reader, collection, status, locale, cacheScope } = args;
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
  const revalidate = await releaseBoundedRevalidate(undefined);
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
      }),
    {
      tags: wanted.map(id => entryIdTag(collection, id)),
      keyParts: [
        "nextly-components",
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

function mediaResolver(
  config: BlocksPageConfig,
  reader: NextlyContentReader,
  budget: QueryBudget
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
      if (!budget.take()) return null;
      const record = await custom(id);
      return usableMedia(record) ? record : null;
    };
  }
  return async (id: string) => {
    // A read is a read: a page whose images all resolve through the media
    // library spends the same budget a loop does, and an exhausted budget
    // resolves to no picture rather than to an unbounded page.
    if (!budget.take()) return null;
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
          // The SAME scope the entry and reference reads use, not a second
          // opinion. A route configured `draft: true` widens its entry reads,
          // and a preview referencing a never-published image would otherwise
          // render no picture on a page explicitly serving drafts.
          status:
            config.status ?? (config.draft === true ? "all" : "published"),
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
        })
      : await mediaNamespaceOf(reader)?.findByID({ id, disableErrors: true });
    if (!record) return null;
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
  };
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
): (collection: string, id: string) => Promise<string | null> {
  if (config.resolveEntryPath) {
    const custom = config.resolveEntryPath;
    // Charged against the budget like the built-in path. A custom resolver is
    // usually database-backed, and it is called once per reference — so a
    // template inside a nested loop invokes it thousands of times. Exempting it
    // would bound the resolver we wrote and leave unbounded the one a site
    // supplies, which is the wrong way round.
    return async (collection: string, id: string) => {
      if (!budget.take()) return null;
      return custom(collection, id);
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

  return async (collection: string, id: string) => {
    // A collection this route does not serve has no path THIS route can
    // produce: `createContentRoute` searches only its configured collections,
    // so the href would 404 or open an unrelated entry that happens to share
    // the slug. Mapping across routes is what `resolveEntryPath` is for.
    if (!routeCollections.includes(collection)) return null;

    // Read under the ROUTE's own policy, not with access overridden. A link is
    // only useful if the path it names resolves, and this route resolves
    // published entries anonymously by default — so a reference to an
    // unpublished or restricted entry would otherwise emit an href that the
    // same route answers with `notFound()`. No path is a better answer than a
    // broken one, and it also stops a restricted entry's slug from being
    // published to anyone who loads the page.
    // `find` rather than `findByID`, because the lifecycle scope has to be
    // applied BY THE READER. Reading the row and then judging its `status`
    // property treats an ordinary string field named `status` — which Nextly
    // explicitly supports on a status-less collection — as the lifecycle
    // column, so an entry the route happily serves lost its link for holding
    // `status: "archived"`. Through the reader the scope is a no-op exactly
    // where it should be.
    //
    // Also never throws: a stale reference resolves to no rows rather than a
    // rejection, which is what `resolveEntryPath` promises its callers.
    if (!budget.take()) return null;
    const found = await reader
      .find({
        collection,
        where: { id: { equals: id } },
        limit: 1,
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
      })
      .catch(() => ({ items: [] as Record<string, unknown>[] }));
    const record = found.items[0];
    if (!record) return null;
    const slug = record[slugField];
    if (typeof slug !== "string") return null;

    // A slug is stored TEXT, so it can start with `/` — and `//evil.example`
    // interpolates to `///evil.example`, which every browser reads as a
    // protocol-relative URL to another host. An "internal" entry reference then
    // navigates off-site. Refused rather than stripped: a slug shaped like an
    // address is not a path this route serves under any reading, and silently
    // rewriting it would invent a destination the author never wrote.
    if (slug.startsWith("/")) return null;

    // Where this slug renders, decided by the route's own rule — which also
    // refuses the reserved paths `ContentPage` will not serve, the `.`/`..`
    // segments URL resolution removes, and the slugs whose normalized form the
    // lookup would not match. Asked BEFORE the ownership probes below, so an
    // unaddressable slug costs no queries.
    const path = emitPath(slug);
    if (path === null) return null;

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
      // Taken from the reader's own signature rather than restated, so a filter
      // this package builds cannot drift from the one the reader accepts.
      where: NonNullable<Parameters<NextlyContentReader["find"]>[0]["where"]>
    ): Promise<boolean> => {
      // Each probe is its own read. An exhausted budget answers "something else
      // owns this slug", which withholds the link — the same direction every
      // other uncertainty here takes, since no link beats a wrong one.
      if (!budget.take()) return true;
      const found = await reader
        .find({
          collection: collectionName,
          where,
          limit: 1,
          status: scope,
          overrideAccess,
          user: undefined,
          // Both identity channels, not just the obvious one. Access rules
          // are written against `req.user`, and `mergeConfig` spreads the
          // instance's defaults UNDER the call — so an omitted `req`
          // restores whatever identity the instance was booted with, on a
          // read this route performs for an anonymous visitor.
          req: undefined,
          ...(config.locale ? { locale: config.locale } : {}),
        })
        .catch(() => ({ items: [] as Record<string, unknown>[] }));
      return found.items.length > 0;
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
    for (const earlier of routeCollections.slice(
      0,
      routeCollections.indexOf(collection)
    )) {
      if (await probe(earlier, { [slugField]: { equals: slug } })) return null;
    }

    return path;
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
function blocksRouteConfig(
  config: BlocksPageConfig,
  isPublic: boolean
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
    ...routeConfig
  } = config;

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
            // The same components the render will inline. Without them the
            // preparation below replaces every instance with a placeholder, so
            // a page whose heading or hero image comes from a component
            // published a title and a preview picture that its own HTML
            // contradicts — for exactly the pages components exist to build.
            const definitions = await definitionsFor(
              document,
              componentSource(
                config,
                readerFor(config),
                budget,
                context.locale
              ),
              effectiveLimits(config)
            );
            const derived = await derivePageSeo(
              document,
              blocks,
              mediaResolver(config, readerFor(config), budget),
              context.slug,
              limits,
              styleContext,
              config.hostPolicy?.remotePatterns,
              definitions
            );
            return metadata(entry, context, derived);
          },
        }
      : {}),
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
      const budget = createQueryBudget(
        config.maxQueries ?? DEFAULT_MAX_QUERIES
      );
      const resolveMedia = mediaResolver(config, readerFor(config), budget);
      const resolveEntryPath = entryPathResolver(
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
        // Reported by the route, not read off the row: the companion overlay
        // copies localized values onto the entry without stamping which locale
        // produced them, so inferring it here finds nothing on exactly the
        // localized pages that need it.
        locale: context.locale,
        isWorkingDraft: entry[WORKING_DRAFT_KEY] === true,
        data,
        // Fresh for THIS render. `core/collection-loop` claims from it before
        // each read, and an absent budget reads as unlimited — the loop's own
        // check is `ctx.queries?.take() === false` — so a routed page without
        // one is unbounded by construction.
        queries: budget,
        resolveMedia,
        resolveEntryPath,
      });

      // Resolved per render when the config states a provider, so style
      // inputs living in storage reach the next page view rather than the
      // next deploy; a plain value passes through unchanged.
      const configuredSiteStyles = isSiteStylesProvider(config.siteStyles)
        ? await config.siteStyles.read()
        : config.siteStyles;
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

      return createElement(PageRenderer, {
        document,
        context: pageContext,
        blocks,
        styles: resolved,
        // Spread conditionally, matching `hostPolicy` below: a page holding no
        // instance resolves to an empty map, and handing `PageRenderer` an
        // empty map rather than nothing states that definitions WERE fetched
        // and none was found — which is the honest answer for a page that
        // references none, and the wrong one for a caller that never asked.
        ...(definitions.size === 0 ? {} : { definitions }),
        styleContext,
        blockFallback,
        limits,
        ...(siteStyles === undefined ? {} : { siteStyles }),
        // Spread conditionally: `PageRenderer` distinguishes an absent policy
        // from one present and undefined, and passing the second would state a
        // posture the site never chose.
        ...(config.hostPolicy === undefined
          ? {}
          : { hostPolicy: config.hostPolicy }),
      });
    },
  };
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
   */
  nextly?: NextlyContentReader & NextlySingleReader;
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
    ...blocksOptions
  } = config;

  const routeConfig = blocksRouteConfig(
    { ...blocksOptions, collections: [slug] },
    isPublic
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
 * A Single rendered as a blocks page, over ACCESS-ENFORCED content.
 *
 * The secure default, and the one to reach for unless the Single is wholly
 * public: it reads as the visitor would and marks the render dynamic, so the
 * build touches no database.
 */
export function createSinglePage(
  config: BlocksSinglePageConfig
): SingleRoute<ReactElement> {
  return createSingleRoute<ReactElement>(blocksSingleConfig(config, false));
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
  return createPublicSingleRoute<ReactElement>(
    blocksSingleConfig(config, true)
  );
}

export function createBlocksPage(
  config: BlocksPageConfig
): ContentRoute<ReactElement> {
  return createContentRoute<ReactElement>(blocksRouteConfig(config, false));
}

/**
 * A blocks page over PUBLIC content: trusted reads, cacheable, pre-renderable.
 *
 * Returns `generateStaticParams` for the route file to export.
 */
export function createPublicBlocksPage(
  config: BlocksPageConfig
): StaticContentRoute<ReactElement> {
  return createPublicContentRoute<ReactElement>(
    blocksRouteConfig(config, true)
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
