/**
 * Whether a value a placement drives into its component may change, and why
 * not.
 *
 * A placement's value lands on a node of its component, which only the
 * composed page shows. Two locks there hold it, and a save refuses a change to
 * either, so the editor holds the field before it is typed into:
 *
 * - a block the component locks in Layers, or one inside it, by the engine's
 *   `componentLayersLocks`, the coverage a save measures a page by;
 * - a value that is not content, inside an area its block locks to its
 *   content, by the engine's `nodeLocks`, the walk a save applies.
 *
 * One judgement for the inspector's rows and the canvas's inline text, so the
 * two cannot disagree about which field is held, and one wording per lock.
 *
 * @module component-holds
 */
import {
  componentLayersLocks,
  contentPropsOf,
  nodeLocks,
  type BlockDocument,
  type NodeLock,
  type ResolvedBlockNode,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import type { RefusalWording } from "./drag-refusal";
import { lockRefusalWording } from "./lock-refusal";

/** What holds one value a placement drives. */
export type ComposedHold =
  | { readonly kind: "component" }
  | { readonly kind: "content-only"; readonly lock: NodeLock };

/**
 * The hold on each composed node's values, asked per node and prop: `design`
 * for a value that is never content, such as whether the node shows.
 *
 * @param composed - the editor's composition, with the resolver's markers
 * @param locks - the block definitions the editor judges slot locks by
 */
export function composedHolds(
  composed: BlockDocument,
  locks: SlotDefaultSource
): (
  node: ResolvedBlockNode,
  prop: string,
  design: boolean
) => ComposedHold | undefined {
  const byComponent = componentLayersLocks(composed.nodes);
  const bySlot = nodeLocks(composed.nodes, locks);
  return (node, prop, design) => {
    if (byComponent.has(node.id)) return { kind: "component" };
    const lock = bySlot.get(node.id);
    if (lock?.area === undefined) return undefined;
    if (!design && contentPropsOf(locks.get(node.type)?.props).has(prop)) {
      return undefined;
    }
    return { kind: "content-only", lock };
  };
}

/**
 * What a held field says: for a component's Layers lock, the component by
 * name and where to change it; for a content-only area, the area by its
 * holder, in the slot lock's own wording.
 */
export function composedHoldWording(
  hold: ComposedHold,
  componentName: string,
  childType: string | undefined
): RefusalWording {
  if (hold.kind === "component") {
    return lockRefusalWording({
      code: "layers-locked",
      label: componentName,
      relation: "component",
      verb: "change",
    });
  }
  const area = hold.lock.area;
  return lockRefusalWording({
    code: "locked-slot-content-only",
    holderType: area?.holderType ?? "",
    lock: "contentOnly",
    ...(childType === undefined ? {} : { childType }),
  });
}
