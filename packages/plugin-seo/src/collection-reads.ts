/**
 * The slice of the managed collection service this plugin reads through.
 *
 * Two callers need the same shape and must not each declare it: the sitemap
 * builder enumerates published entries as `system`, and the SEO issues source
 * scans them as the caller. They ask the same two questions of the same
 * service; only the identity they ask under differs, which is what the type
 * parameter carries.
 *
 * Declared structurally rather than as `Pick<PluginCollectionService, ...>` so
 * a test can satisfy it with a plain object, while the real, richer service
 * stays assignable to it.
 *
 * @module collection-reads
 */

/** How one page of entries comes back. */
export interface EntriesPage {
  data: unknown[];
  pagination: { hasMore: boolean };
}

/** The query one page is asked for. */
export interface EntriesQuery {
  where?: Record<string, unknown>;
  depth?: number;
  /**
   * Field projection passed to the managed service. It trims the returned rows
   * to what the reader consumes; note the current service applies it to the
   * response, not the SQL, so it does not yet avoid reading the columns at the
   * database layer.
   */
  select?: Record<string, boolean>;
  /**
   * A stable, unique sort, so consecutive pages neither overlap nor skip rows:
   * the managed service adds `ORDER BY` only when `sort` is passed.
   */
  sort?: { field: string; direction: "asc" | "desc" };
  /**
   * Paged by 1-indexed `page`. The managed service reads a page from `page`,
   * not `offset`, and derives its window as `(page - 1) * limit` -- so a loop
   * MUST advance `page` to progress, and must not narrow `limit` partway
   * through or the window moves backwards.
   */
  pagination?: { limit?: number; page?: number };
}

/**
 * Reading entries under one identity.
 *
 * `Opts` is whatever that caller passes as the trailing `ServiceOpts`: a fixed
 * `{ as: "system" }` for a public document, or `callerReadOptions(caller)` for
 * a read that must be scoped to whoever asked.
 */
export interface CollectionReads<Opts> {
  collections: {
    /**
     * Collection metadata -- read only to check the built-in draft/published
     * lifecycle flag (`status: true`). Typed as `unknown` and narrowed at the
     * call site, because the core `Collection` type does not surface `status`.
     * The context argument is unused by the read; pass `{}`.
     */
    getCollection(
      slug: string,
      context: Record<string, never>
    ): Promise<unknown>;
    listEntries(
      slug: string,
      query: EntriesQuery,
      opts: Opts
    ): Promise<EntriesPage>;
  };
}
