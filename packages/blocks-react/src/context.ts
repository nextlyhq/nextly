/**
 * What a block render receives, and where the renderer gets its data.
 *
 * `BlockRenderArgs<P, C>` in the engine leaves `ctx: C` deliberately unnamed —
 * "what a context CONTAINS is the renderer's to say" — so defining it is this
 * package's contractual obligation, not optional polish.
 *
 * Everything the renderer needs from the outside world arrives through these
 * interfaces rather than through imports. That is what keeps the package usable
 * without the CMS, but the standalone case is the smaller half of the argument:
 * the canvas renders the same documents against different data access, and a
 * test wants fixtures instead of a database. One seam serves every host, and a
 * host that resolves data some other way is a different implementation of these
 * interfaces rather than a change to the renderer.
 *
 * @module context
 */

/** A query the renderer asks its host to answer. Shapes stay deliberately
 * narrow: this is the subset dynamic blocks need today, and widening it is a
 * deliberate act rather than a side effect of a new block. */
export interface BlocksQuery {
  collection: string;
  limit?: number;
  offset?: number;
  sort?: string;
  locale?: string;
}

/** What a host returns for a {@link BlocksQuery}. */
export interface BlocksResult {
  items: ReadonlyArray<Record<string, unknown>>;
  total?: number;
}

/**
 * The data seam. The CMS supplies an implementation backed by its own read
 * path; a standalone consumer or a test supplies fixtures.
 *
 * Async by contract even where a host could answer synchronously, because a
 * host that later needs to await must not force every caller to change.
 */
export interface BlocksDataProvider {
  find(query: BlocksQuery): Promise<BlocksResult>;
}

/**
 * A resolved media item.
 *
 * An object rather than a URL string because an image block needs alt text and
 * intrinsic dimensions to render without layout shift, and those travel with
 * the URL or they get looked up separately and inconsistently. This mirrors the
 * shape the existing renderer already settled on.
 */
export interface ResolvedMedia {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

/**
 * A provider that answers nothing.
 *
 * The default, so that rendering a document containing a dynamic block without
 * a configured host produces an empty result rather than a crash — the
 * forgiving-render posture the document model already takes for unknown block
 * types.
 */
export const emptyDataProvider: BlocksDataProvider = {
  find: () => Promise.resolve({ items: [], total: 0 }),
};

/**
 * The context every block render receives.
 *
 * Resolver functions rather than raw maps: a host that resolves media through a
 * CDN, a signed URL, or a local folder differs only in the function it passes,
 * and none of that reaches a block author.
 */
export interface PageContext {
  /**
   * The entry the page renders, when there is one. `null` in standalone use,
   * where a document is rendered with no surrounding record.
   */
  entry: Record<string, unknown> | null;
  /** The locale being rendered, when the host is localized. */
  locale?: string;
  /**
   * True when the entry being rendered is an unpublished working draft rather
   * than its live content. Surfaced so a host can show a preview banner; the
   * renderer itself does not change behaviour on it.
   */
  isWorkingDraft?: boolean;
  /** Data access for dynamic blocks. */
  data: BlocksDataProvider;
  /**
   * Resolve a media id, or `null` when it cannot be resolved.
   *
   * Async because a real host cannot answer synchronously: a CMS-backed
   * context reads the media record from its database, and a storage adapter
   * that issues signed URLs performs network work to produce one. A
   * synchronous signature would force every such host to pre-resolve every
   * media id on every render, or to lie.
   */
  resolveMedia(id: string): Promise<ResolvedMedia | null>;
  /**
   * Resolve an entry reference to a path, or `null` when it has none.
   *
   * Async for the same reason: the path depends on the referenced entry's slug
   * and status, which is a read.
   */
  resolveEntryPath(collection: string, id: string): Promise<string | null>;
}

/** A context with nothing wired up: the standalone default. */
export function createStandaloneContext(
  overrides: Partial<PageContext> = {}
): PageContext {
  const defaults: PageContext = {
    entry: null,
    data: emptyDataProvider,
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };

  // Spreading `overrides` wholesale would let an explicit `undefined` replace a
  // default: `exactOptionalPropertyTypes` is off, so
  // `createStandaloneContext({ data: maybeProvider })` typechecks and then
  // produces a context whose `data` is undefined, which crashes at the first
  // dynamic block instead of falling back. Only defined values win.
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as Partial<PageContext>;

  return { ...defaults, ...defined };
}
