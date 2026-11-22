/**
 * Pasting copied blocks into a page, planned and not performed.
 *
 * @module composition-planners-paste
 */
import type { PlanRefusal, PlanResult } from "./composition-planners-contract";
import { insertOps, withoutOrigin } from "./composition-planners-provenance";
import {
  destinationOf,
  duplicateDomIdRefusal,
  freshCopy,
  internalNestingRefusal,
  placementRefusal,
  shapeRefusal,
  takenDomIds,
} from "./composition-planners-refusals";
import type { BlockDocument, BlockNode } from "./document";
import type { NestingSource } from "./nesting";
import { documentRefusal, forestRefusal, type OpPosition } from "./ops";
import type { ComponentLookup } from "./resolve-instances";

/**
 * Paste copied blocks at one position, as fresh copies.
 *
 * The same fresh-id copy a saved pattern's insert makes (`freshCopy`), so a
 * run pasted twice into one page holds no repeated block id or rendered DOM
 * id, and the roots are re-identified together so a reference from one copied
 * block to another follows the copy. Everything else a block carries is kept
 * as it was copied: its shared styles, block style, variables, component
 * placements, media and bindings, so a paste on the same site points at the
 * same things the original did.
 *
 * Each copy's `origin` is dropped. That record names the saved section an
 * insert came from and the renames that insert made; a pasted copy is a copy
 * of page content, and keeping the record would have a later "has the saved
 * section changed" check read renames this paste made as the section's.
 *
 * What it refuses, before anything is applied, is what the op layer would:
 * blocks of a shape the op layer will not carry (they arrive from the
 * clipboard, which is outside input), a destination the op layer cannot edit
 * or find, a place the shared nesting rule refuses, and a copy whose own
 * placements the current rules refuse. The caps on depth and size are the
 * apply's, which knows the limits the site set.
 */
export function planPasteBlocks(
  document: BlockDocument,
  blocks: readonly BlockNode[],
  target: OpPosition,
  nesting: NestingSource,
  definitions?: ComponentLookup
): PlanResult<never> {
  const unusable = pastedRefusal(document, blocks);
  if (unusable !== undefined) return unusable;

  const destination = destinationOf(document, target);
  if (destination.problem !== undefined) return destination;

  const copy = freshCopy(withoutOrigin(blocks), takenDomIds(document, target));
  if (copy.problem !== undefined) return copy;

  const refusal =
    placementRefusal(
      copy.nodes,
      destination.place.where,
      nesting,
      definitions
    ) ?? internalNestingRefusal(copy.nodes, nesting, definitions);
  if (refusal !== undefined) return refusal;

  return {
    pageOps: insertOps(copy.nodes, destination.place, document, target),
    warnings: [],
  };
}

/**
 * What refuses a paste wherever it goes: nothing to paste, blocks the op layer
 * would not carry, or a destination whose envelope or forest it cannot edit.
 * Asked before anything is copied, because copying a malformed value is
 * itself a step that can throw.
 */
function pastedRefusal(
  document: BlockDocument,
  blocks: readonly BlockNode[]
): PlanRefusal | undefined {
  if (blocks.length === 0) return { problem: "empty" };
  const shape = shapeRefusal(blocks) ?? duplicateDomIdRefusal(blocks);
  if (shape !== undefined) return shape;
  if (
    documentRefusal(document) !== undefined ||
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }
  return undefined;
}
