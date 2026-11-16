/**
 * The SEO a page's own blocks derive: its title, description, shared title,
 * canonical path and the first image that resolves, worked out for the
 * route's metadata and for a page-metadata provider.
 *
 * @module next-seo
 */
import {
  mapForest,
  deriveSeoFromDocument,
  hasItemBindings,
  isFetchableUrl,
  resolveDocumentSeo,
  type BindingRun,
  type BlockDocument,
  type BoundValues,
  type DefinitionsById,
  type DocumentLimits,
  type RemotePatternInput,
  type SeoImageCandidate,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { PageMetadataValues } from "nextly/runtime";

import { fillItemBindings, type ItemPlacement } from "./blocks/list-batch";
import { url } from "./blocks/props";
import type {
  BindingIssuesHandler,
  PageBindings,
  ResolvedMedia,
} from "./context";
import { emitPath } from "./next-entry-paths";
import type { DerivedPageSeo } from "./next-page-config";
import {
  heldConditionsOf,
  pageBindingRun,
  readingViewOf,
  readStagesFor,
  type DocumentReadStages,
  type PreparedDocument,
} from "./prepare-document";
import { registeredBlocks } from "./resolver";
import type { BlockResolver } from "./resolver";
import { conditionAllows } from "./visibility";

/**
 * What a page's blocks offer for its head, as a page-metadata provider takes
 * it: the title, description, shared title and picture. The canonical is left out, since
 * the provider works out the page's address itself and is never told one by
 * the content.
 */
export function metadataValuesOf(derived: DerivedPageSeo): PageMetadataValues {
  return {
    ...(derived.title === undefined ? {} : { title: derived.title }),
    ...(derived.description === undefined
      ? {}
      : { description: derived.description }),
    ...(derived.socialTitle === undefined
      ? {}
      : { socialTitle: derived.socialTitle }),
    ...(derived.image === undefined ? {} : { image: { url: derived.image } }),
  };
}

/** What each node's bound props hold, by node id, from a page's read. */
function boundValuesOf(
  stages: DocumentReadStages | null
): (nodeId: string) => BoundValues | undefined {
  return nodeId => stages?.boundValues.get(nodeId);
}

/** A node outside every list: no item to draw it for. */
const OUTSIDE_ANY_LIST: ItemPlacement = {};

/**
 * The document the metadata walk reads, and what each node's bound props
 * hold, as the page draws the blocks that walk asks about.
 *
 * The walk never enters a list's per-entry slot (a list declares it
 * conditional), so every block it asks that holds a list-item binding is
 * drawn outside any list: through the same item fill the renderer runs, with
 * no item, which gives the binding's fallback or the prop's own value. Read
 * from the page's pass alone, such a block would offer its stored value, a
 * picture the page never draws. Blocks inside a list are filled the same way
 * and never read. The fill's issues are the render's to report, so none are
 * reported twice.
 */
function metadataReadOf(
  prepared: BlockDocument,
  run: BindingRun | undefined,
  stages: DocumentReadStages | null
): {
  document: BlockDocument;
  boundOf: (nodeId: string) => BoundValues | undefined;
} {
  const fromPage = boundValuesOf(stages);
  if (run === undefined) return { document: prepared, boundOf: fromPage };
  const filled = new Map<string, BoundValues>();
  const nodes = mapForest(prepared.nodes, node => {
    if (!hasItemBindings(node)) return node;
    const fill = fillItemBindings(node, OUTSIDE_ANY_LIST, run);
    if (fill.bound === undefined) return node;
    filled.set(node.id, { ...fromPage(node.id), ...fill.bound });
    return { ...node, props: fill.props };
  });
  return {
    document: nodes === prepared.nodes ? prepared : { ...prepared, nodes },
    boundOf: nodeId => filled.get(nodeId) ?? fromPage(nodeId),
  };
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
export async function derivePageSeo(
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
  // What each bound prop holds, as the render is given it, so a bound image
  // offers the picture the page draws, a list item's binding outside a list
  // included.
  const read = metadataReadOf(prepared, run, stages);
  const { image: blockImages, ...derived } = deriveSeoFromDocument(
    read.document,
    type => resolver.get(type),
    node => conditionAllows(node, {}, { held }),
    read.boundOf
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
    ...(own.socialTitle === undefined ? {} : { socialTitle: own.socialTitle }),
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
 * How many media lookups may be in flight at once.
 *
 * Small on purpose. This runs inside `generateMetadata`, so the work competes
 * with producing the page rather than happening beside it, and the candidates
 * are a page's images rather than a dataset. The number only has to stop a
 * chain of deleted references from being paid one round trip at a time.
 */
const MEDIA_LOOKUP_BATCH = 5;

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
