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
import {
  countDocumentsUsing,
  type GroupedUsageReader,
  type UsageCount,
} from "./usage-count";
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
  // The KIND is part of the key, not only the id. A stored row can contradict
  // itself — `kind: "unreadable"` beside a real component id, after a restore
  // or a hand edit — and keying on the id alone makes that row and the genuine
  // reference to the same component look like one record: the malformed one is
  // kept, the real one is never inserted, and reconciliation cannot tell them
  // apart to repair it. With the kind in the key the contradiction is simply a
  // row no derivation claims, so the next save removes it.
  //
  // Rejecting it in `readOwn` instead was the other option and is worse: a row
  // the parser skips is not reconciled either, so the contradiction would
  // survive every save rather than being cleared by the next one.
  reconcileKeyOf: row => `${row.kind}:${row.componentId}`,
  // BOTH columns, because this index keeps a marker beside its references and
  // the two are told apart by `kind`. Matching on the id alone would be correct
  // only by accident: a marker stores the empty string, which no caller can ask
  // about — so the day a marker carries something else, a count that had never
  // said what it wanted would start including it.
  whereReferencing: referenceId => ({
    kind: { equals: "reference" },
    componentId: { equals: referenceId },
  }),
  // Both columns, though `kind` alone identifies the row. `componentId` is the
  // indexed one and no reference stores the empty string, so leading with it
  // turns this into the same indexed lookup a reference question makes; `kind`
  // is what actually decides, and stays so that a marker which later carries a
  // real id is still excluded here.
  whereUndetermined: () => ({
    kind: { equals: "unreadable" },
    componentId: { equals: "" },
  }),
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

/**
 * How many documents place `componentId`, and whether that is all of them.
 *
 * The read behind "used on N pages". A host asks this rather than counting
 * rows itself, so there is one reading of what a page using a component twice
 * means — one page, not two.
 *
 * `complete: false` says the answer is a floor. A surface that drops it reports
 * a component used on thousands of pages as used on the cap, and an author
 * deciding whether to change something reads that as "barely used".
 */
export async function componentUsageCount(args: {
  read: GroupedUsageReader;
  componentId: string;
}): Promise<UsageCount> {
  return countDocumentsUsing({
    index: componentUsageIndex,
    read: args.read,
    referenceId: args.componentId,
  });
}
