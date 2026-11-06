/**
 * What a write breaking a Layers lock is refused with: one code, and one
 * wording for a block the page locks and for one its component locks.
 *
 * @module fields/layers-lock-wording
 */
import type { LayersLockChange } from "@nextlyhq/blocks-engine";

/** The issue code a write breaking a Layers lock is refused with. */
export const LAYERS_LOCK_CHANGED = "layers-lock-changed";

/** What the write would do to the locked block, as a sentence ends it. */
function whatItWouldDo(change: LayersLockChange): string {
  if (change.kind === "removed") return "remove it";
  return change.kind === "moved" ? "move it" : "change it or a block inside it";
}

/**
 * A block the page itself locks, naming it and the way on: unlock it in the
 * same write, or, to remove it, in a save of its own first.
 */
export function pageLockMessage(change: LayersLockChange): string {
  const block = `"${change.label}"`;
  return change.kind === "removed"
    ? `${block} is locked in Layers, and this write would remove it. A locked block, or a block holding one, can't be removed in the save that unlocks it: unlock it and save first, then remove it.`
    : `${block} is locked in Layers, and this write would ${whatItWouldDo(change)}. Send it unlocked in the same write to change it.`;
}

/**
 * A block a placed component locks. The page cannot unlock it, so the way on
 * is to stop giving it a value, or to have the component unlock it.
 */
export function placedLockMessage(change: LayersLockChange): string {
  return `"${change.label}" is locked in Layers in a component this page places, and this write would ${whatItWouldDo(change)}. Remove the value or the content this page gives it, or unlock it in the component.`;
}

/**
 * A component's variant that changes a block the component locks, naming the
 * block and the variant: the variant is the component's own, so the way on
 * is to change it or unlock the block.
 */
export function variantLockMessage(
  change: LayersLockChange & { readonly variant: string }
): string {
  return `"${change.label}" is locked in Layers, and the variant "${change.variant}" would ${whatItWouldDo(change)}. Remove the variant's value for it, or unlock it in the same write.`;
}
