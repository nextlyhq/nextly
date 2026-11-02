/**
 * The slice of the managed collection service the sitemap reads through.
 *
 * The sitemap builder enumerates published entries as `system`, because the
 * sitemap is a public document. The identity a read is asked under is the type
 * parameter, so the shape says nothing about who reads. The dashboard card and
 * its Needs attention line do not read through this: they read through the
 * services core hands a widget, bound to the person asking (`widget-source`).
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
 * `Opts` is whatever that caller passes as the trailing `ServiceOpts`, such as
 * the fixed `{ as: "system" }` the sitemap reads a public document with.
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
