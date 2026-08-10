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
  DOCUMENT_FORMAT_VERSION,
  migrateDocument,
} from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  BlockSeoContribution,
  DocumentLimits,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { Metadata } from "next";
import { createContentRoute } from "nextly/runtime";
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
import type { BlocksDataProvider, PageContext, ResolvedMedia } from "./context";
import { PageRenderer } from "./page-renderer";
import { migrationSourceFor, registeredBlocks } from "./resolver";
import type { BlockResolver } from "./resolver";
import { sanitizeDocument } from "./sanitize";
import type { PageStyles } from "./styles";
import { pruneHiddenNodes } from "./visibility";

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
const LOCALE_KEY = "_locale";

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
export interface DerivedPageSeo extends BlockSeoContribution {
  /** The path the page renders at, for a canonical URL. */
  canonical: string;
}

/**
 * Whether a candidate is already a URL rather than a media id.
 *
 * A media id is a UUID, so anything carrying a scheme, a leading slash, or a
 * path separator or dot is a URL — `assets/hero.png` and `hero.png` both render
 * fine through the image block and must not be sent to the media collection,
 * where the lookup misses and the preview image is dropped.
 */
function looksLikeUrl(value: string): boolean {
  if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  return value.includes("/") || value.includes(".");
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
  limits: DocumentLimits | undefined
): Promise<DerivedPageSeo> {
  const resolver = blocks ?? registeredBlocks();
  const canonical = `/${slug}`;

  // The SAME three passes the renderer runs, in the same order, before reading
  // anything out of the document. Metadata that described a different tree than
  // the page would be wrong in three separate ways:
  //
  // - a stored row can predate validation or be hand-edited, and walking one
  //   unrepaired throws INSIDE `generateMetadata`, which fails the route rather
  //   than rendering the placeholder the render path would have shown;
  // - a node behind its definition's schema version would have its current
  //   `seo` hook called with the old prop shape, so metadata silently takes a
  //   stale value or none;
  // - a node hidden by `visibility.conditions` is deliberately absent from the
  //   HTML, and deriving from it would publish the withheld content as the
  //   page's title or preview image — the same leak PB-D25 closed for CSS.
  const prepared = pruneHiddenNodes(
    migrateDocument(sanitizeDocument(document, limits ?? DEFAULT_LIMITS), {
      ...migrationSourceFor(resolver),
    }).doc
  );

  const { image: imageCandidates, ...text } = deriveSeoFromDocument(
    prepared,
    type => resolver.get(type)
  );
  const image = await firstUsableImage(imageCandidates, resolveMedia);
  return image === undefined
    ? { ...text, canonical }
    : { ...text, canonical, image };
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
async function firstUsableImage(
  candidates: string[] | undefined,
  resolveMedia: (id: string) => Promise<ResolvedMedia | null>
): Promise<string | undefined> {
  for (const candidate of candidates ?? []) {
    if (looksLikeUrl(candidate)) return candidate;
    const media = await resolveMedia(candidate).catch(() => null);
    if (media) return media.url;
  }
  return undefined;
}

/** A string property of the row, when it is one. */
function stringField(entry: ContentEntry, key: string): string | undefined {
  const value = entry[key];
  return typeof value === "string" ? value : undefined;
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
  findByID(args: { id: string }): Promise<Record<string, unknown> | null>;
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
  if (config.resolveMedia) return config.resolveMedia;
  return async (id: string) => {
    const record = config.mediaCollection
      ? // An explicitly named collection IS a dynamic collection — a site
        // storing its images somewhere of its own — so it reads as one.
        await reader.findByID({
          collection: config.mediaCollection,
          id,
          overrideAccess: true,
        })
      : await mediaNamespaceOf(reader)?.findByID({ id });
    if (!record) return null;
    const { url, altText, width, height } = record;
    if (typeof url !== "string") return null;
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
  return async (collection: string, id: string) => {
    // Read under the ROUTE's own policy, not with access overridden. A link is
    // only useful if the path it names resolves, and this route resolves
    // published entries anonymously by default — so a reference to an
    // unpublished or restricted entry would otherwise emit an href that the
    // same route answers with `notFound()`. No path is a better answer than a
    // broken one, and it also stops a restricted entry's slug from being
    // published to anyone who loads the page.
    const record = await reader.findByID({
      collection,
      id,
      overrideAccess: config.overrideAccess ?? false,
    });
    if (!record) return null;
    // `findByID` carries no lifecycle scope, so the route's own is applied
    // here. A no-op on a status-less collection, which has no such field.
    const scope = config.status ?? "published";
    const status = record.status;
    if (scope !== "all" && typeof status === "string" && status !== scope) {
      return null;
    }
    const slug = record[slugField];
    if (typeof slug !== "string") return null;
    // An empty slug is the HOMEPAGE, which the content route resolves at `/`
    // and pre-renders as `{ slug: [] }`. Treating it as missing would strip the
    // destination from every button pointing at the site root.
    return slug === "" ? "/" : `/${slug}`;
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
              limits
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
        locale: stringField(entry, LOCALE_KEY),
        isWorkingDraft: entry[WORKING_DRAFT_KEY] === true,
        data,
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
      });
    },
  });
}
