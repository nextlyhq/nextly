/**
 * What a renderer hands every block it renders.
 *
 * The engine carries this handle without naming it: `BlockRenderArgs<P, C>`
 * leaves `C` to whoever renders, so the engine stays free of React, of a
 * database, and of this package. Naming it here is what makes a dynamic block
 * writable — a block declares `BlockRenderArgs<MyProps, PageContext>` and reads
 * typed data instead of casting an opaque value.
 *
 * The data seam is an interface the host implements rather than a runtime this
 * module imports. That is what keeps the block library import-safe: a block can
 * be loaded, inspected and unit-tested without a database, a Next.js request, or
 * any part of the CMS being present.
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
 * One method, because one block needs it. A contract that is about to be frozen
 * is worth exactly what its members have been proven to carry, and every member
 * added here becomes a method every renderer must implement.
 */
export interface DataProvider {
  find(args: FindArgs): Promise<{ items: Record<string, unknown>[] }>;
}

/**
 * The context a page render supplies.
 *
 * Every member is optional because a block must render without any of them: the
 * editor canvas draws blocks before a data source is chosen, and a block that
 * disappears when its context is empty is a block an author cannot place.
 */
export interface PageContext {
  /** Where a block reads content from, absent when nothing can be queried. */
  data?: DataProvider;
  /** The locale being rendered, for blocks that vary their own output by it. */
  locale?: string;
}
