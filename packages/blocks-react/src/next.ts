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
  deriveSeoFromDocument,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  BlockSeoContribution,
  DocumentLimits,
  SeoImageCandidate,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { Metadata } from "next";
import {
  createContentRoute,
  nextlyTags,
  slugToStaticParam,
} from "nextly/runtime";
import type {
  ContentEntry,
  ContentRoute,
  ContentRouteConfig,
  NextlyContentReader,
  RenderContext,
} from "nextly/runtime";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";

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
   * A dynamic collection to resolve media ids against, for a site storing its
   * images in one of its own.
   *
   * Omit it for ordinary Nextly media: those live in a system table with its
   * own reader, not in a dynamic collection, so the default path asks the
   * media namespace rather than naming a collection at all.
   */
  mediaCollection?: string;
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
  // Normalization CHANGED the slug, so the path it yields is not the slug the
  // route will look up. `resolveContent` matches the stored column against the
  // joined incoming segments, and Next answers `/a//b` with a 308 to `/a/b` — so
  // the request arrives asking for `a/b`, which this entry does not have.
  // Emitting the normalized path would name a page the route answers with
  // `notFound()`; emitting the raw one would name a path that redirects away
  // from it. Neither is a destination, so there is none to give.
  if (param.slug.join("/") !== slug) return null;
  // Encoded per segment: Next hands this route DECODED segments while the
  // request used their encoded form, so `faq?all` emitted raw is read as a path
  // plus a query.
  return `/${param.slug.map(encodeURIComponent).join("/")}`;
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
  styleContext: StyleCompileContext | undefined
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
  });
  // Nothing readable means nothing to describe. The page renders a placeholder,
  // and metadata claiming a title it does not show would be worse than silence.
  if (prepared === null) return canonical;

  const { image: imageCandidates, ...text } = deriveSeoFromDocument(
    prepared,
    type => resolver.get(type),
    isUnconditional
  );
  const image = await firstUsableImage(imageCandidates, resolveMedia);
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
  let remaining = max;
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
  resolveMedia: (id: string) => Promise<ResolvedMedia | null>
): Promise<string | undefined> {
  const list = candidates ?? [];

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
    const resolved = await Promise.all(
      lookups.map(id => resolveMedia(id).catch(() => null))
    );

    // Scanned in DOCUMENT order, not completion order. The earliest usable
    // candidate is the one the renderer would show, and picking whichever
    // request happened to finish first would publish a different picture than
    // the page displays — silently, and only under load.
    // The resolver already applies `usableMedia`, so this re-check is about the
    // batch's own contract rather than the record's: a rejected lookup arrives
    // as `null` and must not end the search.
    const hit = resolved.findIndex(media => media !== null);
    if (hit !== -1) return resolved[hit]?.url;
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

function mediaResolver(
  config: BlocksPageConfig,
  reader: NextlyContentReader
): (id: string) => Promise<ResolvedMedia | null> {
  if (config.resolveMedia) {
    const custom = config.resolveMedia;
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
        // storing its images somewhere of its own — so it reads as one.
        await reader.findByID({
          collection: config.mediaCollection,
          id,
          overrideAccess: true,
          disableErrors: true,
          // Cleared for the same reason the entry and reference reads clear it:
          // `mergeConfig` spreads the reader's defaults under the call, so an
          // omitted `user` restores whatever identity the reader was booted
          // with. On an `overrideAccess: true` route a user-sensitive
          // `afterRead` hook would then bake a personalized URL or alt text
          // into the PUBLIC cached page.
          user: undefined,
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
  reader: NextlyContentReader
): (collection: string, id: string) => Promise<string | null> {
  if (config.resolveEntryPath) return config.resolveEntryPath;
  const slugField = config.slugField ?? "slug";
  const routeCollections = [...new Set(config.collections)];
  // A route mounted behind the app's own auth (`draft: true`) serves drafts
  // through a trusted, lifecycle-widened read, so a reference to an
  // unpublished page DOES resolve when visited and must keep its href. A
  // per-path `draft` function cannot be consulted here — it answers about a
  // slug this lookup has not found yet — so only the unconditional form
  // widens, and the conditional form stays on the safe published read.
  const alwaysDraft = config.draft === true;
  const overrideAccess = alwaysDraft || (config.overrideAccess ?? false);
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

    // The referenced row's identity AS THE PROBE WILL SEE IT — read back off the
    // row rather than taken from the argument, so both sides of the comparison
    // below have been through the same `afterRead`.
    //
    // Refused when it is not a usable value, which is what a hook DROPPING `id`
    // produces: two rows would then compare equal on `undefined` and a
    // shadowing entry could claim this link. Identity that cannot be
    // established is not identity, and no link beats a link to the wrong page.
    const referenceIdValue = record.id;
    if (
      typeof referenceIdValue !== "string" &&
      typeof referenceIdValue !== "number"
    ) {
      return null;
    }
    const referenceId = String(referenceIdValue);

    // The route serves the FIRST entry whose STORED slug matches, searching its
    // collections in order — so that is the question to ask, rather than
    // whether some earlier collection happens to shadow this one. Asking it
    // this way answers both failures with one lookup per collection:
    //
    // - an earlier collection owns the slug, so the link would open a different
    //   document under this URL;
    // - the slug does not find this record AT ALL, which is what an `afterRead`
    //   hook rewriting the slug field produces. `resolveContent` matches the
    //   stored column while the read above returns the hook's value, so a
    //   rewritten slug names a path this same route answers with `notFound()`.
    for (const candidate of routeCollections) {
      // Same lifecycle scope and access semantics the route resolves with, so
      // a draft-only row cannot suppress a valid link on a published route.
      // An access denial is treated as "no such entry", which is how
      // `resolveContent` reads one — a probe that threw would take down a link
      // whose own read succeeded.
      const match = await reader
        .find({
          collection: candidate,
          where: { [slugField]: { equals: slug } },
          limit: 1,
          // Nextly permits two entries in one collection to share a slug, and
          // `resolveContent` settles which one the URL opens by sorting on `id`.
          // An unsorted `limit: 1` may return either row, so without this the
          // probe can answer with the referenced entry while the route serves
          // the other — a link that opens a different document than it names.
          sort: "id",
          status: scope,
          overrideAccess,
          user: undefined,
          ...(config.locale ? { locale: config.locale } : {}),
        })
        .catch(() => ({ items: [] as Record<string, unknown>[] }));
      const first = match.items[0];
      if (!first) continue;
      // The first collection that answers this slug decides what the URL opens.
      // This link is honest only when that is this very record — same
      // collection, same row. A duplicate slug inside the collection lands here
      // too, and is refused for the same reason.
      //
      // Compared against the REFERENCED ROW's identity rather than the id this
      // resolver was handed. Both rows here come back through `afterRead`, so a
      // hook that rewrites `id` rewrites it on each of them alike, while the
      // argument is the stored value the hook never saw. Comparing those two
      // spellings made every link on such a site disappear.
      return candidate === collection && String(first.id) === referenceId
        ? path
        : null;
    }

    // No collection serves this slug, so there is no path to offer.
    return null;
  };
}

/**
 * Turn a collection of block documents into rendered pages.
 *
 * The composition `createContentRoute` was built to carry: it resolves a path
 * to an entry and owns `generateStaticParams`, `generateMetadata` and the
 * not-found decisions, and this fills in the render with the block renderer
 * over a context wired to the CMS.
 *
 * Wire the result into `app/[[...slug]]/page.tsx`:
 *
 * ```tsx
 * const { ContentPage, generateMetadata, generateStaticParams } =
 *   createBlocksPage({ collections: ["pages"], field: "content" });
 *
 * export { generateMetadata, generateStaticParams };
 * export default ContentPage;
 * ```
 *
 * Draft preview needs no argument here. `createContentRoute` owns the `draft`
 * decision and this passes it through untouched, so a preview arrives as an
 * ordinary entry that happens to be the pending one.
 */
export function createBlocksPage(
  config: BlocksPageConfig
): ContentRoute<ReactElement> {
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

  return createContentRoute<ReactElement>({
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
    ],
    // Supplied only when asked for, so a route without it keeps whatever
    // `buildMetadata` the caller passed straight through to the content route.
    ...(metadata
      ? {
          buildMetadata: async (entry, context) => {
            const document = readDocument(entry, field, context);
            const derived = await derivePageSeo(
              document,
              blocks,
              mediaResolver(config, context.reader),
              context.slug,
              limits,
              styleContext
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
      const resolveMedia = mediaResolver(config, context.reader);
      const resolveEntryPath = entryPathResolver(config, context.reader);

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
        queries: createQueryBudget(config.maxQueries ?? DEFAULT_MAX_QUERIES),
        resolveMedia,
        resolveEntryPath,
      });

      return createElement(PageRenderer, {
        document,
        context: pageContext,
        blocks,
        styles: resolved,
        styleContext,
        blockFallback,
        limits,
        // Spread conditionally: `PageRenderer` distinguishes an absent policy
        // from one present and undefined, and passing the second would state a
        // posture the site never chose.
        ...(config.hostPolicy === undefined
          ? {}
          : { hostPolicy: config.hostPolicy }),
      });
    },
  });
}
