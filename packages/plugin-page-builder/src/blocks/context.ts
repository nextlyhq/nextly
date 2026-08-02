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

/**
 * How many more reads this page render may perform.
 *
 * A loop inside a loop asks its data source once per entry of the outer one, so
 * depth in a document turns into multiplication in queries. The budget is
 * shared by the whole render and taken from before each read, which turns an
 * unbounded page into a bounded one that renders what it could reach.
 */
export interface QueryBudget {
  /** Claim one read. False when the page has spent its allowance. */
  take(): boolean;
}

/**
 * What a page render provides, as one named shape.
 *
 * An app states that this IS its block render context with a single line,
 * placed anywhere in its own source:
 *
 * ```ts
 * declare module "@nextlyhq/plugin-sdk/blocks" {
 *   interface BlockRenderContext extends PageContext {}
 * }
 * ```
 *
 * Written by the app rather than shipped by this package, and that is the
 * better arrangement rather than a workaround for one. The declaration bundler
 * that produces the published types resolves imports with a scheme older than
 * package `exports` maps, so an augmentation naming a subpath cannot be
 * published at all — but the reason to prefer this survives that: an app-wide
 * claim about what every block receives should be something the app says out
 * loud, in one visible place, not something a dependency arranges quietly.
 */
export interface PageContext {
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
   * descendants cares: the value flows down to all of them and each takes what
   * it needs.
   */
  item?: Record<string, unknown>;
  /**
   * What is left of this render's query allowance. Absent means the renderer is
   * not counting, which is the editor drawing one block in isolation.
   */
  queries?: QueryBudget;
}
