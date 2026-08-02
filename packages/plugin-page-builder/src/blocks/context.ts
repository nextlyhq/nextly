/**
 * What this renderer hands every block it draws.
 *
 * Declared by augmenting the SDK's `BlockRenderContext`, so a block author
 * writes `defineBlock<MyProps>` and `ctx` is already typed as what a page
 * render provides. Nobody names a context type by hand, and there is one
 * description of it for the whole app rather than one per block.
 *
 * The data seam is an interface the host implements rather than a runtime this
 * module imports. That is what keeps the block library import-safe: a block can
 * be loaded, inspected and unit-tested without a database, a request, or any
 * part of the CMS being present.
 *
 * @module blocks/context
 */

/** A read against one collection. */
export interface FindArgs {
  collection: string;
  /** A filter, passed to the data layer unchanged. */
  where?: unknown;
  /** A sort expression, passed to the data layer unchanged. */
  sort?: string;
  limit?: number;
}

/**
 * The reads a block may perform.
 *
 * One method, because one block needs it. A contract about to be frozen is
 * worth what its members have been proven to carry, and every member added here
 * becomes a method every renderer must implement.
 */
export interface DataProvider {
  find(args: FindArgs): Promise<{ items: Record<string, unknown>[] }>;
}

declare module "@nextlyhq/plugin-sdk/blocks" {
  interface BlockRenderContext {
    /**
     * Where a block reads content from. Absent when nothing can be queried,
     * which is the editor drawing a block before a source has been chosen.
     */
    data?: DataProvider;
    /**
     * The entry the surrounding repeater is on.
     *
     * Set by a block rendering its slot once per entry, and read by whatever is
     * inside that slot. It lives on the CONTEXT rather than being passed as a
     * prop because a repeater does not know, and should not know, which of its
     * descendants cares: the value flows down to all of them and each takes
     * what it needs.
     */
    item?: Record<string, unknown>;
  }
}
