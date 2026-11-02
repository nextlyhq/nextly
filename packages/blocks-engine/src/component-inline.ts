/**
 * Turning every copy of one component in a document into plain blocks.
 *
 * Deleting a component that is in use converts each copy into the blocks it
 * draws first, so every host keeps exactly what it showed. This is the half of
 * that which reads and writes one document. It inlines each copy with
 * {@link planDetach}, the planner behind an author's own detach, so the blocks
 * that replace a copy are the ones the renderer drew for it. Copies of every
 * other component stay linked.
 *
 * It refuses rather than converting whenever the converted document could not
 * stand in for the original: a copy the planner refuses, a copy whose removal
 * takes away a node the host component exposes, a lock the conversion breaks,
 * and a reference the stored nodes do not carry but a variant or a placement's
 * override installs. A document it cannot read to the end is refused too,
 * because a copy it never reached is one it cannot claim to have converted.
 *
 * @module component-inline
 */
import { detachedPage, type PlanProblem } from "./composition-planners";
import { isComponentDocument, type BlockDocument } from "./document";
import {
  DEFAULT_LIMITS,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "./limits";
import { lockRefusal } from "./lock-breaks";
import type { NestingSource } from "./nesting";
import { documentRefusal, forestRefusal } from "./ops";
import { isPlainRecord } from "./plain-record";
import {
  componentPlacementsIn,
  componentReferencesFrom,
  componentReferencesIn,
  readableDefinition,
  type DefinitionsById,
} from "./resolve-instances";
import { boundedOwnKeys, ownEntry } from "./safe-record";
import { walkNodes, type SlotDefaultSource } from "./tree";

/**
 * Why a document's copies of a component cannot be turned into plain blocks.
 *
 * - a {@link PlanProblem}: the detach planner refused one copy, for its own
 *   cause (`"destination-locked"`, `"exceeds-limits"`, `"not-a-component"` for
 *   a definition that is missing, unreadable or places itself, and so on);
 * - `"picked-by-override"`: the document reaches the component through a
 *   variant or a placement's override, with no stored copy to convert;
 * - `"exposure-points-inside"`: the document is a component that exposes a
 *   property or a slot on a node the conversion removes;
 * - `"unreadable"`: the document, or what it places, could not be read to
 *   the end, so a copy may have been missed.
 *
 * @experimental
 */
export type InlineProblem =
  | PlanProblem
  | "picked-by-override"
  | "exposure-points-inside"
  | "unreadable";

/**
 * A document with every copy of the component turned into plain blocks.
 *
 * @experimental
 */
export interface InlinedDocument {
  /** The converted document; the one handed in when there was nothing to do. */
  readonly document: BlockDocument;
  /** How many copies were converted, counting each nested copy. */
  readonly converted: number;
  readonly problem?: undefined;
  readonly nodeId?: undefined;
}

/**
 * Why nothing was converted, and where.
 *
 * @experimental
 */
export interface InlineRefusal {
  readonly problem: InlineProblem;
  /**
   * The copy the refusal is about; for a lock, the block whose slot the
   * conversion would break; for an override, the placement installing it.
   * Absent where no one node is to blame.
   */
  readonly nodeId?: string;
  readonly document?: undefined;
  readonly converted?: undefined;
}

/**
 * The converted document, or why there is none.
 *
 * @experimental
 */
export type InlineResult = InlinedDocument | InlineRefusal;

/**
 * Whether a document references a component: `"unknown"` when it cannot be
 * read to the end, which a caller deciding whether it is in use reads as yes.
 *
 * @experimental
 */
export type ReferenceAnswer = "yes" | "no" | "unknown";

/**
 * Turn every copy of `componentId` in `document` into the plain blocks it
 * draws, or refuse and change nothing.
 *
 * Every copy goes, wherever it sits: in a slot of another block, in another
 * component's filled slot, and in the filled slot of a copy of the same
 * component, which the first pass moves out and a later pass converts. Each
 * pass must leave fewer copies than the one before, which bounds the loop by
 * the document's size. Running it again on its own result converts nothing.
 *
 * `definitions` must hold the definition of every component the document
 * places, not only this one: a placement's override is read against its own
 * definition to know whether it installs this component.
 *
 * A document the op layer would not edit, by its envelope or its forest, is
 * refused as `"unusable-document"` before anything is read from it.
 *
 * `blocks` gives each block's slots, for the locks they declare. A copy
 * standing in a locked slot changes what that slot holds once converted, and
 * the detach planner, which judges one copy at a time, does not read slot
 * locks; the whole document is judged before and after instead, as a save
 * judges it.
 *
 * @param document - the host as stored: a page, a component or a pattern
 * @param componentId - the component whose copies are converted
 * @param definitions - component definitions by id
 * @param nesting - the site's nesting rules
 * @param blocks - the block definitions, for their slot locks
 * @param limits - the caps the converted document must stay within
 * @returns the converted document and how many copies were converted, or the
 *   refusal
 *
 * @experimental
 */
export function inlineComponentInstances(
  document: BlockDocument,
  componentId: string,
  definitions: DefinitionsById,
  nesting: NestingSource,
  blocks: SlotDefaultSource,
  limits: DocumentLimits = DEFAULT_LIMITS
): InlineResult {
  // A document the op layer would not edit cannot be converted, and one it
  // would not read may hold copies the walk below cannot see.
  if (!editable(document)) return { problem: "unusable-document" };
  const inlined = everyCopyInlined(
    document,
    componentId,
    definitions,
    nesting,
    limits
  );
  if (inlined.problem !== undefined) return inlined;

  const picked = installedWithoutCopy(
    inlined.document,
    componentId,
    definitions,
    limits.maxNodes
  );
  if (picked !== undefined) return picked;
  if (inlined.converted === 0) return { document, converted: 0 };

  const broken = lockRefusal(document, inlined.document, {
    definitions: blocks,
    nesting,
    limits,
  });
  if (broken !== undefined) {
    return { problem: "destination-locked", nodeId: broken.holderId };
  }
  return inlined;
}

/**
 * Whether `document` still references `componentId`, through a stored copy or
 * through one of its own variants. A value the op layer would not edit, by its
 * envelope or its forest, answers `"unknown"`.
 *
 * @param document - the host as stored, unvalidated
 * @param componentId - the component asked about
 * @param maxNodes - how many nodes to read before answering `"unknown"`
 *
 * @experimental
 */
export function stillReferences(
  document: unknown,
  componentId: string,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): ReferenceAnswer {
  // The whole envelope, as the op layer judges it: a value whose format or
  // kind this version does not know may reference the component in a way
  // the survey below cannot read, so it is not one to answer "no" for.
  if (!editable(document)) return "unknown";
  const reach = componentReferencesIn(document, maxNodes);
  if (!reach.complete) return "unknown";
  return reach.ids.includes(componentId) ? "yes" : "no";
}

/** Every stored copy converted, pass by pass, before anything else is judged. */
function everyCopyInlined(
  document: BlockDocument,
  componentId: string,
  definitions: DefinitionsById,
  nesting: NestingSource,
  limits: DocumentLimits
): InlineResult {
  let current = document;
  let copies = copiesIn(current, componentId, limits.maxNodes);
  let converted = 0;
  for (;;) {
    if (copies === undefined) return { problem: "unreadable" };
    const copyId = copies[0];
    if (copyId === undefined) return { document: current, converted };

    const step = oneCopyInlined(current, copyId, definitions, nesting, limits);
    if (step.problem !== undefined) return step;
    const left = copiesIn(step.document, componentId, limits.maxNodes);
    // A pass that leaves as many copies as it found is a definition drawing
    // a copy of itself, and converting it again would draw one more.
    if (left !== undefined && left.length >= copies.length) {
      return { problem: "not-a-component", nodeId: copyId };
    }
    current = step.document;
    copies = left;
    converted += 1;
  }
}

/** One copy detached, refused when that removes a node the host exposes. */
function oneCopyInlined(
  document: BlockDocument,
  copyId: string,
  definitions: DefinitionsById,
  nesting: NestingSource,
  limits: DocumentLimits
): InlineResult {
  // The page the planner already applied for its limit check, rather than a
  // second apply of the same ops, which measures the whole page once per op.
  const detached = detachedPage(document, copyId, definitions, nesting, limits);
  if (detached.problem !== undefined) {
    return { problem: detached.problem, nodeId: copyId };
  }
  const after = detached.document;
  const lost = lostExposure(document, after);
  if (lost !== undefined) return { problem: lost, nodeId: copyId };
  return { document: after, converted: 1 };
}

/**
 * The ids of the copies of `componentId`, in the order the walk reaches them,
 * or undefined when the document cannot be read to the end.
 */
function copiesIn(
  document: BlockDocument,
  componentId: string,
  maxNodes: number
): string[] | undefined {
  const survey = componentPlacementsIn(document, maxNodes);
  if (!survey.complete) return undefined;
  const ids: string[] = [];
  for (const placement of survey.placements) {
    if (placement.target !== componentId) continue;
    const id = nodeIdOf(placement.node);
    if (id === undefined) return undefined;
    ids.push(id);
  }
  return ids;
}

/**
 * A reference to `componentId` that no stored copy carries, so converting
 * copies cannot remove it.
 *
 * Asked of the converted document, which holds no copy: whatever still
 * reaches the component is a variant of this document or a placement's
 * override installing it. A placement of a definition that cannot be read
 * draws a placeholder, so it installs nothing.
 */
function installedWithoutCopy(
  document: BlockDocument,
  componentId: string,
  definitions: DefinitionsById,
  maxNodes: number
): InlineRefusal | undefined {
  const reach = componentReferencesIn(document, maxNodes);
  if (!reach.complete) return { problem: "unreadable" };
  if (reach.ids.includes(componentId)) return { problem: "picked-by-override" };

  const survey = componentPlacementsIn(document, maxNodes);
  if (!survey.complete) return { problem: "unreadable" };
  for (const placement of survey.placements) {
    const definition = readableDefinition(definitions.get(placement.target));
    if (definition === undefined) continue;
    const installed = componentReferencesFrom(
      definition,
      placement.node,
      maxNodes
    );
    const at = nodeIdOf(placement.node);
    const named = at === undefined ? {} : { nodeId: at };
    if (!installed.complete) return { problem: "unreadable", ...named };
    if (installed.ids.includes(componentId)) {
      return { problem: "picked-by-override", ...named };
    }
  }
  return undefined;
}

/**
 * Whether turning `before` into `after` removed a node that `before`, as a
 * component, exposes a property or a slot on.
 *
 * Only nodes that were there count: an exposure already pointing at nothing
 * is not this conversion's doing.
 */
function lostExposure(
  before: BlockDocument,
  after: BlockDocument
): "exposure-points-inside" | "unreadable" | undefined {
  const targets = exposureTargets(before);
  if (targets === undefined) return "unreadable";
  if (targets.length === 0) return undefined;
  const had = nodeIds(before);
  const kept = nodeIds(after);
  return targets.some(id => had.has(id) && !kept.has(id))
    ? "exposure-points-inside"
    : undefined;
}

/**
 * The node ids a component's exposures and exposed slots point at, or
 * undefined when the envelope cannot be read.
 */
function exposureTargets(document: BlockDocument): string[] | undefined {
  if (!isComponentDocument(document)) return [];
  const properties = propertyTargets(document.exposed);
  const slots = slotTargets(document.slots);
  if (properties === undefined || slots === undefined) return undefined;
  return [...properties, ...slots];
}

function propertyTargets(exposed: unknown): string[] | undefined {
  if (exposed === undefined) return [];
  if (!Array.isArray(exposed) || exposed.length > MAX_ENVELOPE_ENTRIES) {
    return undefined;
  }
  return everyNodeId(exposed);
}

function slotTargets(slots: unknown): string[] | undefined {
  if (slots === undefined) return [];
  if (!isPlainRecord(slots)) return undefined;
  const keys = boundedOwnKeys(slots, MAX_ENVELOPE_ENTRIES);
  if (keys === null) return undefined;
  return everyNodeId(keys.map(key => ownEntry(slots, key)));
}

/** Each entry's `nodeId`, or undefined when one does not carry a readable one. */
function everyNodeId(entries: readonly unknown[]): string[] | undefined {
  const ids: string[] = [];
  for (const entry of entries) {
    const id = isPlainRecord(entry) ? entry.nodeId : undefined;
    if (typeof id !== "string") return undefined;
    ids.push(id);
  }
  return ids;
}

function nodeIds(document: BlockDocument): Set<string> {
  const ids = new Set<string>();
  walkNodes(document.nodes, node => {
    ids.add(node.id);
  });
  return ids;
}

/**
 * Whether the op layer would edit `document`: its envelope, and every entry of
 * its forest. The same two checks the detach planner asks first.
 */
function editable(document: unknown): boolean {
  if (documentRefusal(document) !== undefined) return false;
  const nodes = isPlainRecord(document) ? document.nodes : undefined;
  return forestRefusal(nodes) === undefined;
}

function nodeIdOf(node: unknown): string | undefined {
  if (!isPlainRecord(node)) return undefined;
  return typeof node.id === "string" ? node.id : undefined;
}
