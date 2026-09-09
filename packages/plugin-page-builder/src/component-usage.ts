/**
 * What a stored document says about the components it embeds.
 *
 * The component half of what `class-usage.ts` answers for named classes, and
 * deliberately the same two-valued shape: an empty list and an unreadable
 * document are different answers, and the whole point of the record is to
 * decide whether a component may be DELETED. A delete check reads absence as
 * evidence, so an absence produced by a BOUND rather than by the document has
 * to be visible, or it is indistinguishable from "not used".
 *
 * ## Which walk, and why it is not this module's own
 *
 * `componentUsageIn` is the resolver's, published from the engine. The question
 * is which components this page RESOLVES, and a reader that stopped anywhere
 * else would answer about a different document than the one being served —
 * which is the mistake `research:pb6-t4c3-reachability` records: discovery must
 * ask the resolver what it reaches rather than predict it.
 *
 * That matters more here than the same rule does for classes, because the two
 * engine walks genuinely differ. The class reader selects level-order through
 * `selectNodes`; the resolver walks depth-first. At one and the same cap they
 * reach different nodes — measured, a first root larger than the cap hides an
 * instance on a later sibling from the depth-first walk while the level-order
 * one sees it immediately. Only one of those answers describes the page.
 *
 * @module component-usage
 */
import { componentUsageIn } from "@nextlyhq/blocks-engine";
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import type { ComponentUsageRow } from "./collections/component-usage-index";
import { readStoredJson } from "./stored-json";
import type { UsageDerivation, UsageIndex } from "./usage-index";

/**
 * The components a stored document references, and whether it could all be read.
 *
 * Total by construction. This reads persisted data that nothing is guaranteed
 * to have validated — the blocks field admits any value whose `nodes` is an
 * array, so a malformed tree reaches storage intact — and a shape it cannot
 * read contributes nothing rather than raising.
 *
 * `limits` is REQUIRED, unlike its class-side sibling's optional one. There the
 * omission is neutral because the engine's own default is the same answer; here
 * the caller is the index, which must derive under the bounds the page is drawn
 * with or record a document the renderer never sees.
 */
export function componentUsageOf(
  stored: unknown,
  limits: DocumentLimits
): UsageDerivation {
  const document = readStoredJson(stored);
  if (!isRecordWithNodes(document)) return { ids: [], complete: true };
  return componentUsageIn(document.nodes, limits.maxNodes);
}

/**
 * Whether a stored value carries a forest this can walk at all.
 *
 * Both halves matter and neither is redundant. A non-record is not a document;
 * a record whose `nodes` is not an array is one the engine's own walk answers
 * nothing for, and letting it through would spend the walk to learn that.
 *
 * Answering `{ ids: [], complete: true }` for both is deliberate rather than an
 * oversight: a value that is not a document references nothing, and saying it
 * could not be READ would put a marker row against a subject whose document is
 * simply absent — which no rebuild could ever clear.
 */
function isRecordWithNodes(value: unknown): value is { nodes: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}

/**
 * The component index, as the shared machinery sees it.
 *
 * One place builds a row and chooses the marker, because the two have to agree
 * about what a marker IS — and here they agree through the `kind` column
 * rather than through a value no reference can wear, which is what the class
 * index has to do and what a component id cannot support.
 */
export const componentUsageIndex: UsageIndex<ComponentUsageRow> = {
  readOwn: item => {
    // Validated against the closed set rather than accepted as any string, for
    // the reason `scope` and `variant` are: `kind` partitions the rows into
    // families, and a value outside the set belongs to a family no real query
    // names — neither reconciled nor swept, and counting towards its component
    // for ever. A typo does not fail here, it accumulates.
    const kind = item.kind;
    if (kind !== "reference" && kind !== "unreadable") return null;
    const componentId = item.componentId;
    if (typeof componentId !== "string") return null;
    return { kind, componentId };
  },
  referenceOf: row => row.componentId,
  rowFor: (subject, referenceId) => ({
    ...subject,
    kind: "reference",
    componentId: referenceId,
  }),
  markerFor: subject => ({
    ...subject,
    kind: "unreadable",
    // Nothing reads this on a marker row — `kind` is what says the row is one —
    // and it is empty rather than absent because the columns form a total key.
    componentId: "",
  }),
  isMarker: row => row.kind === "unreadable",
  derive: (document, limits) => componentUsageOf(document, limits),
};
