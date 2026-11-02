/**
 * The words for an action a lock refuses, from one place.
 *
 * Every surface that refuses inside a locked area (the drop indicator, the
 * inserter, a keyboard move, the toolbar and the context menu) and the
 * inspector's read-only settings word the reason through this function, so an
 * author meets one sentence for one rule wherever they meet it. The facts come
 * from the engine's `lockRefusal`, which judges an edit exactly as a save does.
 */
import {
  findNode,
  type BlockDocument,
  type LocatedLockBreak,
  type RepairStep,
} from "@nextlyhq/blocks-engine";

import type { RefusalWording } from "./drag-refusal";
import { blockLabel } from "./inserter";

/**
 * The facts a lock refusal is worded from: the rule, and the block whose slot
 * it holds. A break on the page itself and one in the composed page, inside a
 * component a placement reaches, both answer with these.
 */
export type LockRefusalFacts = Pick<
  LocatedLockBreak,
  "code" | "holderType" | "lock" | "childType"
> & {
  /** The placement a break inside a component is reached through. */
  readonly instanceId?: string;
};

/** An edit the op store refused for a lock, as its host is told. */
export interface LockEditRefusal {
  readonly reason: "locked";
  /** The sentence the author reads, as every lock refusal words it. */
  readonly sentence: string;
  readonly lock: LockRefusalFacts;
}

/** A drop the locks refuse, as the canvas draws it over the refusing region. */
export interface LockDropRefusal {
  readonly regionId: string;
  /** The container the refusing region belongs to, absent at the top level. */
  readonly parentId?: string;
  readonly lock: LockRefusalFacts;
}

/**
 * The headline names the locked area by the block that holds it; the remedy
 * says what the lock still allows, which is the author's way forward.
 */
export function lockRefusalWording(found: LockRefusalFacts): RefusalWording {
  const area = `This area of ${blockLabel(found.holderType)} is locked`;
  if (found.code === "locked-slot-content-only") {
    const child =
      found.childType === undefined
        ? "This block"
        : blockLabel(found.childType);
    return {
      headline: `${area} to its content.`,
      remedy: `${child}'s design and settings can't change here.`,
    };
  }
  switch (found.lock) {
    case "insert":
      return {
        headline: `${area}.`,
        remedy: "Its blocks can be reordered, but not added or removed.",
      };
    case "contentOnly":
      return {
        headline: `${area}.`,
        remedy:
          "Only its content can change. Its blocks can't be added, removed or moved.",
      };
    case "all":
      return {
        headline: `${area}.`,
        remedy: "Its blocks can't be added, removed or moved.",
      };
  }
}

/**
 * One step of a repair, as the preview lists it before the author confirms:
 * which block, whose locked area or which container, and what happens.
 *
 * Here beside the refusals so an area is named the same way in both: by the
 * block that holds it. A move says which rule moved the block, a lock or the
 * placement rule, since the author is told why it leaves.
 *
 * @param document - the document the plan was made from, where every block a
 *   step names is found
 */
export function repairStepSentence(
  step: RepairStep,
  document: BlockDocument
): string {
  const named = (id: string) => {
    const node = findNode(document.nodes, id);
    return node === undefined ? "a block" : blockLabel(node.type);
  };
  switch (step.kind) {
    case "move":
      return step.cause === "lock"
        ? `Move ${blockLabel(step.type)} out of ${named(step.from.holderId)}'s locked area, to just after ${named(step.after)}.`
        : `Move ${blockLabel(step.type)} out of ${named(step.from.holderId)}, where it isn't allowed, to just after ${named(step.after)}.`;
    case "add":
      return `Add the ${blockLabel(step.type)} that ${named(step.at.holderId)}'s locked area starts with.`;
    case "reorder":
      return `Put the blocks in ${named(step.holderId)}'s locked area back in their starting order.`;
    case "reset":
      return `Put ${blockLabel(step.type)}'s design back as it started: ${step.parts.join(", ")}.`;
  }
}
