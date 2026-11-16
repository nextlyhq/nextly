/**
 * Pure, immutable, ID-addressed operations over a document's node forest.
 *
 * The document's top level is a plain array of nodes, so every operation works
 * on a `BlockNode[]` and treats "no parent id" as the top level. Every
 * mutation returns a new forest; inputs are never modified. Nodes are always
 * addressed by id — positional addressing exists only as the insertion index
 * within a destination, never as a way to identify a node.
 *
 * These are mechanism, not policy: they enforce structural safety (no cycles,
 * clamped indices, no-op on missing targets) but DELIBERATELY do not enforce
 * author policy. Two invariants are owned elsewhere on purpose:
 * - Author locks (`node.locked`) are enforced by the editor command layer, not
 *   here. System paths — migrations, locale-overlay application, `reidSubtree`,
 *   version restore — must be able to transform locked nodes; a lock check in
 *   these primitives would either block those paths or force a bypass flag onto
 *   every call site. Centralizing the check in the op store is the correct seam.
 * - Node id uniqueness is a document validation invariant, checked by
 *   `validate()` before a document is persisted. Callers build nodes with
 *   `makeNode`/`reidSubtree`, which mint fresh ids, so within a session ids are
 *   unique by construction; a hand-injected duplicate is caught by validation
 *   with a machine-readable path, not silently corrected here.
 *
 * ## Storability is not decided here
 *
 * A stored document can arrive in a state `JSON.stringify` refuses — a value
 * that points back at its owner. Nothing in this module creates one; they come
 * from an import, a restore, or a direct database write.
 *
 * **These primitives never refuse work because the DOCUMENT they were given is
 * already unstorable.** They transform what they can reach and make no claim
 * about whether the result can be saved. One place decides that, once, at the
 * point of writing — `measureBytes` already answers it as
 * `{ exceeded: true, reason: "unwritable" }`, and it answers for the whole
 * class, including values a cycle check cannot see at all: `BigInt`, a
 * function, a getter that throws.
 *
 * The rule earns its keep by being derivable rather than remembered. Three
 * operations previously answered three different ways — rebuild, refuse,
 * preserve — each reasoned correctly from its own case, and the fourth case had
 * nothing to derive an answer from.
 *
 * **Where the line falls, because the two cases look alike from a diff.** A
 * primitive here handles what breaks ITSELF and does not police what breaks a
 * later stage. `expandSlotDefaults` catching a `structuredClone` that THROWS is
 * the first kind: without it the function cannot complete and the call site
 * gets an exception instead of a node. Refusing a value that clones perfectly
 * and is merely unstorable — a nested `Date`, a `BigInt` — would be the second,
 * and is the fourth answer this rule exists to prevent.
 *
 * Stated here rather than only where it was decided, because it reads as an
 * omission from any one call site: a reviewer looking at a clone guard and a
 * missing storability check sees two spellings of one question. It is two
 * questions, and only this module says so.
 *
 * What they DO refuse is an ARGUMENT that would break id-addressing: a subtree
 * carrying a duplicate id, or an id already in the destination. That is a
 * different question. It is about an invariant these primitives depend on to
 * work at all, and it concerns caller-supplied input rather than the state the
 * document was already in.
 *
 * ## What a rebuild keeps, and the one thing it drops
 *
 * Rebuilding preserves everything it cannot interpret — a malformed entry, a
 * slot whose value is not an array, a slot named `__proto__`. An unrelated edit
 * must not be what destroys stored content.
 *
 * A cycle-closing entry is the single exception, and the reason generalises:
 * **it is the one thing in a stored document that cannot round-trip through
 * storage.** `JSON.stringify` refuses it, so it was never readable back and
 * dropping it loses nothing a caller could have saved — while KEEPING it during
 * a rebuild emits the same id twice and makes every lookup ambiguous. A
 * malformed value is the opposite on both counts: it writes, it reads back, and
 * it breaks nothing.
 *
 * So the test is not "did the caller name it" but "could this have been
 * stored". That distinction is why `withoutCycleEdges` is applied to a forest a
 * primitive was ALREADY going to rebuild, and never as a repair pass of its
 * own.
 */

export {
  insertNode,
  makeNode,
  mapForest,
  moveNode,
  newId,
  removeNode,
  updateNode,
} from "./tree-edits";
export { expandSlotDefaults } from "./tree-slot-defaults";
export type { SlotDefaultSource } from "./tree-slot-defaults";
export { findNode, locateNode, walkNodes } from "./tree-walk";
export type { NodeLocation, TreePosition, WalkOptions } from "./tree-walk";
export {
  ID_REFERENCE_ATTRIBUTES,
  duplicateNode,
  hiddenSubtreeNodes,
  idReferenceTokens,
  mintDomId,
  referencedDomIds,
  reidForestWithMap,
  reidSubtree,
  remapIdReferences,
} from "./tree-reid";
export type { DomIdPolicy, ReidentifiedForest } from "./tree-reid";
