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
 * the canvas renders the same documents with different data access, tests want
 * fixtures instead of a database, and the binding system planned for a later
 * phase already assumes a provider. One seam serves all four.
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
  /** Resolve a media id to a URL, or `null` when it cannot be resolved. */
  resolveMediaUrl(id: string): string | null;
  /** Resolve an entry reference to a path, or `null` when it has none. */
  resolveEntryPath(collection: string, id: string): string | null;
}

/** A context with nothing wired up: the standalone default. */
export function createStandaloneContext(
  overrides: Partial<PageContext> = {}
): PageContext {
  return {
    entry: null,
    data: emptyDataProvider,
    resolveMediaUrl: () => null,
    resolveEntryPath: () => null,
    ...overrides,
  };
}
