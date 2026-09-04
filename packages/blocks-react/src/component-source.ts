/**
 * Where a route's component definitions come from, and what a page's cache
 * entry has to carry because it read them.
 *
 * Composition is a pass of the shared read pipeline, but the pipeline does not
 * FETCH: it takes the definitions a caller hands over and reports every
 * reference it could not satisfy. This module is the caller for a Nextly route
 * — it decides which definitions a page can reach, reads them at the posture
 * the route is serving, and tags the read so that publishing one component
 * regenerates exactly the pages that embed it.
 *
 * @module component-source
 */
import {
  componentIdsIn,
  MAX_COMPOSED_DEPTH,
  type BlockDocument,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

import type { QueryBudget } from "./context";

/**
 * Reads the definitions for a set of ids, at one posture.
 *
 * A batch rather than one call per id, because the ids are known together and
 * a page embedding a header, a footer and three cards would otherwise issue
 * five round trips where one `IN` does. It is the shape a host overriding this
 * has to implement, so it is the shape that has to be worth implementing.
 *
 * Answers a map rather than an array, and the map's KEYS are what the pipeline
 * reads: an id present with an unreadable value is a definition somebody
 * supplied and cannot be read, and an id absent is one nobody supplied. Those
 * carry different remedies, so a source must not drop an id it read a bad row
 * for — hand the value over and let the pipeline say which.
 */
export type ComponentSource = (
  ids: readonly string[]
) => Promise<DefinitionsById>;

/** What component definitions are stored under when a host names nothing. */
export const COMPONENT_TAG_COLLECTION = "components";

/** The field a component's blocks live in when a host names nothing. */
export const COMPONENT_DOCUMENT_FIELD = "content";

/**
 * Every definition this document can reach, read level by level.
 *
 * NOT one read, and the design's "one batched read" cannot be taken literally:
 * the transitive set is not knowable from the stored page. A page names the
 * components it holds directly; which components THOSE hold is a fact about
 * their stored documents, so it cannot be discovered without reading them. The
 * loop is therefore one batched read per level of nesting.
 *
 * Bounded by {@link MAX_COMPOSED_DEPTH}, the same cap the resolver refuses at.
 * Reading past it would fetch definitions no render can inline — the resolver
 * answers `composed-depth` before it asks for them — so the bound is not a
 * safety margin, it is the set the page can actually use.
 *
 * Ids already seen are never re-read: a component held by three others is one
 * entry, and a cycle terminates because the second visit finds it in the map.
 */
export async function definitionsFor(
  document: BlockDocument,
  source: ComponentSource,
  limits: DocumentLimits
): Promise<DefinitionsById> {
  const found = new Map<string, BlockDocument>();
  let wanted = componentIdsIn(document.nodes, limits.maxNodes);

  for (
    let level = 0;
    level < MAX_COMPOSED_DEPTH && wanted.length > 0;
    level++
  ) {
    const unread = wanted.filter(id => !found.has(id));
    if (unread.length === 0) break;
    const batch = await source(unread);
    // Recorded for every id ASKED FOR, not for every id answered. An id the
    // store had no row for has been looked for and not found, and remembering
    // that is what stops the next level asking again — while leaving it out of
    // `found` keeps it absent for the pipeline, which is how a reference
    // nobody published reads as missing rather than as unreadable.
    wanted = nestedIds(unread, batch, found, limits);
  }
  return found;
}

/**
 * Merge one level's answers, and collect what they reference in turn.
 *
 * The ids a definition holds are read from the document the store returned,
 * unvalidated: nothing here decides whether that value is a usable component,
 * because the pipeline already draws that line and drawing it twice is how the
 * two come to disagree. A value with no readable `nodes` simply references
 * nothing.
 */
function nestedIds(
  asked: readonly string[],
  batch: DefinitionsById,
  into: Map<string, BlockDocument>,
  limits: DocumentLimits
): string[] {
  const next: string[] = [];
  for (const id of asked) {
    if (!batch.has(id)) continue;
    const definition = batch.get(id) as BlockDocument;
    into.set(id, definition);
    if (!Array.isArray(definition?.nodes)) continue;
    for (const nested of componentIdsIn(definition.nodes, limits.maxNodes)) {
      if (!into.has(nested)) next.push(nested);
    }
  }
  return next;
}

/** What one batched definition read needs to know about the route asking. */
export interface ComponentReadOptions {
  /** The collection definitions are stored in. */
  collection: string;
  /** The field holding a definition's blocks. */
  field: string;
  /**
   * The lifecycle scope, decided the way every other read on this route
   * decides it. A page serving published content must not inline a draft
   * component, and a route explicitly serving drafts must.
   */
  status: "published" | "draft" | "all";
  /** The locale the route resolved, when the site has more than one. */
  locale?: string;
  /**
   * Charged once per BATCH, not once per definition.
   *
   * A page embedding twenty components spends one read, because that is what
   * it costs. Charging per definition would refuse a page for an allowance it
   * never used, and charging nothing would leave the one read on this path
   * that scales with the page unbounded.
   */
  budget: QueryBudget;
}
