/**
 * The op that sets a block's visibility conditions, for the editor's "Show
 * when" controls and the page actions API alike, so both write a block's
 * conditions the one way: the engine's `withConditions`, which keeps the
 * devices a block shows on and stores nothing for a block shown everywhere
 * to everyone.
 *
 * @module condition-ops
 */
import {
  findNode,
  withConditions,
  type BlockDocument,
  type Condition,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./op-vocabulary";

/**
 * The op setting a block's conditions to `conditions`, an OR of AND groups;
 * `null` or no groups removes them. `null` when the document holds no such
 * block.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionsOp(
  document: BlockDocument,
  id: string,
  conditions: readonly (readonly Condition[])[] | null
): BuilderOp | null {
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  const next = withConditions(node.visibility, conditions ?? undefined);
  return next === undefined
    ? { kind: "update", id, patch: {}, unset: ["visibility"] }
    : { kind: "update", id, patch: { visibility: next } };
}
