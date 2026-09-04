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
  resolveComponentInstances,
  type BlockDocument,
  type ComponentLookup,
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
 * `maxNodes`.
 *
 * WHAT IT COSTS, stated honestly rather than optimistically. One composition
 * per ROUND, and a round happens whenever a fetch revealed an id nobody had
 * asked for — so a page whose components nest five deep composes about five
 * times here before the renderer composes once more. Each definition is
 * repaired once for the whole discovery rather than once per round, which is
 * the part that would otherwise grow fastest: repair sanitizes a whole
 * definition, and without the memo every round re-sanitized everything reached
 * so far.
 *
 * `attempted` is separate from what was found: an id the store had no row for
 * must stay out of the returned map — its absence is what makes the pipeline
 * report `missing` rather than `unreadable` — while a component that is
 * genuinely gone must not be re-queried once per place it is referenced from.
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

  // Repaired ONCE for the whole discovery, not once per round. The pipeline's
  // lookup deliberately holds no memo — the resolver reads each definition
  // once per composition, so a second cache there could never be observed —
  // but discovery composes several times over a growing map, and without this
  // every round re-sanitizes every definition reached so far. Sound because a
  // definition's repaired form never changes: `found` only gains entries, and
  // an entry's value is fixed once set.
  const lookup = repairedOnce(found, limits);

  // The FIRST round asks the resolver too, over a lookup holding nothing, so
  // every instance it can reach reports `missing` and names itself. Seeding
  // this from a walk of the stored nodes left one parallel traversal in place
  // — the one this function exists to delete — and it disagreed in the usual
  // direction: a condition-gated instance, or one in slot content the chosen
  // definition discards, is an id the walk reports and the resolver never
  // asks for.
  let wanted = stillMissing(sanitized, lookup, limits);
  // Until a FIXED POINT, not for a fixed number of rounds. Nesting depth is
  // not the bound: fetching a definition changes the resolver's node-budget
  // decisions, so a definition that composes to less than the instance it
  // replaces frees room and can reveal further missing ids at the SAME depth.
  // A page of sibling components can therefore need more rounds than anything
  // in it is deep, and stopping at the composition cap would report published
  // components as missing on a tree that fits.
  //
  // It terminates on its own: a round proceeds only when it has an id nobody
  // has asked for yet, and every id it asks for enters `attempted`, which is
  // never emptied. The cap is its OWN number rather than the node cap, because
  // those count unrelated things — `maxNodes` bounds the composed OUTPUT and
  // this bounds definitions TRAVERSED — and tying them stopped discovery on a
  // one-node page holding one component that holds one more.
  while (attempted.size < MAX_DISCOVERED_COMPONENTS) {
    // Clamped to what is LEFT of the allowance, not merely checked against it.
    // A round can expose more ids than the cap in one go — a page naming a
    // thousand components does — and a check before an unbounded batch caps
    // nothing.
    const unread = [...new Set(wanted)]
      .filter(id => !attempted.has(id))
      .slice(0, MAX_DISCOVERED_COMPONENTS - attempted.size);
    if (unread.length === 0) break;
    const asked = new Set(unread);
    for (const id of unread) attempted.add(id);
    for (const [id, definition] of await source(unread)) {
      // Only what was ASKED for. A source answers with the id it read off the
      // row, and an `afterRead` hook may rewrite that — so an answer filed
      // under a key nobody requested would let one component's document stand
      // in for another's, and the reference that really named it would never
      // be fetched.
      if (asked.has(id)) found.set(id, definition);
    }
    wanted = stillMissing(sanitized, lookup, limits);
  }
  return found;
}

/**
 * The components a document needs that a source could not supply.
 *
 * The same discovery the render performs, ending at the same place, with the
 * REMAINDER reported instead of the definitions. That remainder is the honest
 * definition of "this page has a hole": the resolver asked for these, nothing
 * answered, and the renderer will draw a marker where each one sits.
 *
 * Exists so a caller outside the render — a publish-time check, a report — can
 * ask the question without walking stored documents for component ids. Such a
 * walk is not a cheaper version of this; it is a DIFFERENT question, and the
 * ways it differs all point the same way. It reports a condition-gated
 * instance, and one sitting in slot content the chosen definition discards,
 * neither of which the resolver asks for. It follows the id stored on a node
 * rather than the one an instance's overrides selected. And it sees nodes a
 * repair pass dropped. Every one of those is a component a visitor never meets,
 * named in a warning about a page that renders correctly.
 */
export async function unsuppliedComponentIds(
  document: BlockDocument,
  source: ComponentSource,
  limits: DocumentLimits
): Promise<string[]> {
  const found = await definitionsFor(document, source, limits);
  return stillMissing(
    sanitizeDocument(document, limits),
    repairedOnce(found, limits),
    limits
  );
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
  lookup: ComponentLookup,
  limits: DocumentLimits
): string[] {
  const composed = resolveComponentInstances(document, lookup, { limits });
  return composed.unresolved
    .filter(entry => entry.reason === "missing")
    .map(entry => entry.componentId);
}

/**
 * The pipeline's own view of a definitions map, with each repair kept.
 *
 * The repair itself is not reimplemented — `repairingLookup` is asked, so
 * discovery composes through exactly the view the renderer will. What is added
 * is the memo, which the pipeline has no use for and discovery does: one
 * composition reads a definition once, and discovery performs several.
 *
 * `has` is answered from the SUPPLIED map rather than from whether `get`
 * produced something, for the reason the pipeline's own lookup answers it that
 * way: presence separates a component nobody published from one published and
 * unreadable, and the resolver reports those as different reasons.
 */
function repairedOnce(
  found: DefinitionsById,
  limits: DocumentLimits
): ComponentLookup {
  const base = repairingLookup(found, limits);
  const repaired = new Map<string, BlockDocument | undefined>();
  return {
    has: id => found.has(id),
    get: id => {
      if (repaired.has(id)) return repaired.get(id);
      const value = base.get(id);
      repaired.set(id, value);
      return value;
    },
  };
}

/**
 * How many distinct definitions one page may pull in before discovery gives up.
 *
 * A bound on WORK, not a statement about design. Discovery stops on its own
 * when a composition asks for nothing new; this only matters for a store that
 * keeps answering with definitions naming further ones, so the number sits far
 * above any page a person would build and far below anything that could hold a
 * request open.
 *
 * Deliberately NOT derived from `limits.maxNodes`. That bounds nodes in the
 * composed output; this bounds definitions traversed, and the two have no
 * relation — a single-node page can legitimately reach a chain of components
 * that each compose to almost nothing. Tying them together stopped discovery on
 * exactly that page.
 */
const MAX_DISCOVERED_COMPONENTS = 1000;

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
