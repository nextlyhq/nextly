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
  resolveComponentInstances,
  type BlockDocument,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

import type { QueryBudget } from "./context";
import { repairingLookup } from "./prepare-document";
import { sanitizeDocument } from "./sanitize";

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

/** Shared, so a route whose budget is spent allocates no map at all. */
export const EMPTY_DEFINITIONS: DefinitionsById = new Map<
  string,
  BlockDocument
>();

/** What component definitions are stored under when a host names nothing. */
export const COMPONENT_TAG_COLLECTION = "components";

/** The field a component's blocks live in when a host names nothing. */
export const COMPONENT_DOCUMENT_FIELD = "content";

/**
 * Every definition this document reaches, discovered by ASKING the resolver.
 *
 * The obvious implementation walks the stored document for `componentId`
 * props and follows each definition the same way. It is wrong, and it was
 * wrong here in three separate ways, because a raw walk PREDICTS reachability
 * and the resolver DECIDES it:
 *
 * - an instance's override may name a different component than the one its
 *   definition stored, so the walk fetches the default and the resolver asks
 *   for the override;
 * - shape repair drops malformed nodes before resolution, so a walk over the
 *   stored tree spends its node budget on entries the resolver never sees and
 *   can stop before an instance that does survive;
 * - anything added later that changes which instances are expanded — a new
 *   override kind, a variant, a gate — silently reopens the same gap.
 *
 * So this does not walk. It composes with what it has, reads back the
 * instances the resolver reported as `missing`, fetches exactly those, and
 * composes again. Reachability is therefore whatever the pass that performs it
 * says it is, and a future change to that pass cannot leave discovery behind.
 *
 * Composition here is the ENGINE's function over a sanitized document, not the
 * whole read pipeline — a pure walk of a document already bounded by
 * `maxNodes`. The renderer composes again for its own purposes; that is one
 * extra pass over a capped tree, and it buys exact agreement.
 *
 * Terminates because a component is asked for at most once. `attempted` is
 * separate from what was found: an id the store had no row for must stay out
 * of the returned map — its absence is what makes the pipeline report
 * `missing` rather than `unreadable` — while a component that is genuinely
 * gone must not be re-queried once per place it is referenced from.
 */
export async function definitionsFor(
  document: BlockDocument,
  source: ComponentSource,
  limits: DocumentLimits
): Promise<DefinitionsById> {
  const found = new Map<string, BlockDocument>();
  const attempted = new Set<string>();
  // The same first pass the pipeline runs, so the tree composed here is the
  // tree it will compose. Discovering over the STORED document instead let a
  // repair-dropped node consume budget the resolver never spends.
  const sanitized = sanitizeDocument(document, limits);

  let wanted = componentIdsIn(sanitized.nodes, limits.maxNodes);
  // One round per level of nesting at most, which is also the deepest the
  // resolver will compose — past it every instance is refused `composed-depth`
  // and names a definition no render can inline.
  for (let round = 0; round <= MAX_COMPOSED_DEPTH; round += 1) {
    const unread = [...new Set(wanted)].filter(id => !attempted.has(id));
    if (unread.length === 0) break;
    for (const id of unread) attempted.add(id);
    for (const [id, definition] of await source(unread)) {
      found.set(id, definition);
    }
    wanted = stillMissing(sanitized, found, limits);
  }
  return found;
}

/**
 * The components a composition asked for and did not get.
 *
 * `missing` and nothing else. The other refusals are decisions rather than
 * gaps — a cycle, a depth, a budget, a definition supplied and unreadable —
 * and fetching in response to any of them would ask for a component the
 * resolver already holds or has already refused on grounds a second read
 * cannot change.
 */
function stillMissing(
  document: BlockDocument,
  found: DefinitionsById,
  limits: DocumentLimits
): string[] {
  const composed = resolveComponentInstances(
    document,
    repairingLookup(found, limits),
    { limits }
  );
  return composed.unresolved
    .filter(entry => entry.reason === "missing")
    .map(entry => entry.componentId);
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
