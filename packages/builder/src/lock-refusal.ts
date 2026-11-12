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
  addressesNoNode,
  applyOp,
  findNode,
  layersLockBreak,
  layersLockChanges,
  OpError,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type LayersLockBreak,
  type LocatedLockBreak,
  type RepairStep,
} from "@nextlyhq/blocks-engine";

import type { RefusalWording } from "./drag-refusal";
import { blockLabel } from "./inserter";
import { layerLabel } from "./layers";

/**
 * The facts a slot-lock refusal is worded from: the rule, and the block whose
 * slot it holds. A break on the page itself and one in the composed page,
 * inside a component a placement reaches, both answer with these.
 */
export type SlotLockRefusalFacts = Pick<
  LocatedLockBreak,
  "code" | "holderType" | "lock" | "childType"
> & {
  /** The placement a break inside a component is reached through. */
  readonly instanceId?: string;
};

/** What an action does to a block, as a refusal of it says. */
export type LockedVerb = "move" | "delete" | "change" | "add";

/**
 * Where a locked block sits relative to the block an action is aimed at:
 * - `self`: it is that block;
 * - `inside`: it is inside that block;
 * - `around`: that block is inside it;
 * - `destination`: the action would put a block into it;
 * - `component`: the block is a component's, which locks it; `label` is then
 *   the component's name, since the page cannot unlock it.
 */
export type LockedRelation =
  | "self"
  | "inside"
  | "around"
  | "destination"
  | "component";

/**
 * The facts a Layers-lock refusal is worded from: the locked block by the name
 * the author knows it by, where it sits, and what the action would do.
 *
 * `layers-locked-when-saved` is the lock the SAVED page still holds on a block
 * the author has unlocked since: a save refuses to delete it until the unlock
 * itself has been saved, so the editor refuses the delete before that.
 */
export interface LayersLockRefusalFacts {
  readonly code: "layers-locked" | "layers-locked-when-saved";
  readonly label: string;
  readonly relation: LockedRelation;
  readonly verb: LockedVerb;
}

/**
 * Why an edit is refused for a lock: a slot's lock a block declares, or a
 * block an author locked in Layers.
 */
export type LockRefusalFacts = SlotLockRefusalFacts | LayersLockRefusalFacts;

/** Whether the facts are a Layers lock's rather than a slot's. */
export function isLayersLockFacts(
  found: LockRefusalFacts
): found is LayersLockRefusalFacts {
  return (
    found.code === "layers-locked" || found.code === "layers-locked-when-saved"
  );
}

/**
 * Where `locked` sits relative to the block `subjectId`, which is either one
 * of its own or a block it is found beside: the block itself, around it when
 * the subject is found inside it, and inside it otherwise.
 */
function relationOf(
  locked: BlockNode,
  subjectId: string
): Exclude<LockedRelation, "destination"> {
  if (locked.id === subjectId) return "self";
  return findNode([locked], subjectId) === undefined ? "inside" : "around";
}

/**
 * The facts for a block locked in Layers that stops an action aimed at
 * `subjectId`, worded by {@link lockRefusalWording} like every other lock.
 */
export function layersLockFacts(
  locked: BlockNode,
  subjectId: string,
  verb: LockedVerb
): LayersLockRefusalFacts {
  return {
    code: "layers-locked",
    label: layerLabel(locked),
    relation: relationOf(locked, subjectId),
    verb,
  };
}

/** What an op does to the block it addresses, as a refusal of it says. */
function verbOf(
  op: Exclude<BuilderOp, { readonly kind: "envelope" | "seo" }>
): LockedVerb {
  switch (op.kind) {
    case "remove":
      return "delete";
    case "move":
      return "move";
    case "update":
      return "change";
    case "insert":
      return "add";
  }
}

/** A break the engine found, as the facts a refusal is worded from. */
function factsOfBreak(
  document: BlockDocument,
  op: BuilderOp,
  broken: LayersLockBreak
): LayersLockRefusalFacts | undefined {
  // An envelope or metadata edit changes no block, so no lock is broken by
  // one.
  if (addressesNoNode(op)) return undefined;
  const locked = findNode(document.nodes, broken.lockedId);
  if (locked === undefined) return undefined;
  if (broken.where === "destination" || op.kind === "insert") {
    return {
      code: "layers-locked",
      label: layerLabel(locked),
      relation: "destination",
      verb: "add",
    };
  }
  return layersLockFacts(locked, op.id, verbOf(op));
}

/**
 * What the save would refuse of this edit's Layers locks, judged against the
 * SAVED page with the engine's own comparison (`layersLockChanges`), the one
 * the server uses, or undefined. Only what this edit adds is asked, not what an
 * earlier edit already did.
 *
 * - A block the edit deletes that the saved page still holds locked, even one
 *   unlocked since: the unlock has to be saved before the delete.
 * - A locked block a move of other blocks would read as moved: moving one
 *   sibling across it is the sibling's move, but moving several past it at
 *   once reads, at the save, as the locked block moving instead.
 *
 * A block unlocked since the save may otherwise be changed or moved in the
 * same save that carries its unlock.
 */
export function savedLockBrokenBy(
  before: BlockDocument,
  after: BlockDocument,
  stored: BlockDocument,
  ops: readonly BuilderOp[]
): LayersLockRefusalFacts | undefined {
  const asked = ops.find(op => op.kind === "remove" || op.kind === "move");
  if (asked === undefined) return undefined;
  const already = new Set(
    layersLockChanges(before, stored).map(
      change => `${change.kind}:${change.id}`
    )
  );
  const added = layersLockChanges(after, stored).find(
    change =>
      (change.kind === "removed" || change.kind === "moved") &&
      !already.has(`${change.kind}:${change.id}`)
  );
  if (added === undefined) return undefined;
  if (added.kind === "moved") {
    return {
      code: "layers-locked",
      label: added.label,
      relation: "self",
      verb: "move",
    };
  }
  const removal = ops.find(op => op.kind === "remove");
  return {
    code: "layers-locked-when-saved",
    label: added.label,
    relation:
      removal?.kind === "remove" && added.id === removal.id ? "self" : "inside",
    verb: "delete",
  };
}

/**
 * The Layers lock `ops` would break, as refusal facts, or undefined when they
 * keep every lock: a block locked now, asked op by op with the engine's own
 * rule (`layersLockBreak`) as the apply asks it, and with `stored`, a block
 * the saved page still holds locked that the ops would delete.
 *
 * Ops the document cannot take for another reason answer undefined: they are
 * the apply's to refuse, for that reason.
 */
export function layersLockRefusalFor(
  document: BlockDocument,
  ops: readonly BuilderOp[],
  stored?: BlockDocument
): LayersLockRefusalFacts | undefined {
  let working = document;
  for (const op of ops) {
    const broken = layersLockBreak(working.nodes, op);
    if (broken !== undefined) return factsOfBreak(working, op, broken);
    try {
      working = applyOp(working, op).document;
    } catch (error) {
      if (error instanceof OpError) return undefined;
      throw error;
    }
  }
  return stored === undefined
    ? undefined
    : savedLockBrokenBy(document, working, stored, ops);
}

/**
 * The one wording of a Layers lock, for every surface that refuses an action
 * for one: the toolbar, the menus, the keyboard, a drag and the inspector.
 */
function layersLockWording(found: LayersLockRefusalFacts): RefusalWording {
  if (found.code === "layers-locked-when-saved") {
    return {
      headline: `Save first: ${found.relation === "self" ? "this block" : found.label} is still locked on the saved page.`,
      remedy: `Save, then ${found.verb} it.`,
    };
  }
  switch (found.relation) {
    case "self":
      return {
        headline: `${found.label} is locked.`,
        remedy: `Unlock it to ${found.verb} it.`,
      };
    case "inside":
      return {
        headline: `${found.label} inside this block is locked.`,
        remedy: `Unlock ${found.label} to ${found.verb} this block.`,
      };
    case "around":
      return {
        headline: `This block is inside ${found.label}, which is locked.`,
        remedy: `Unlock ${found.label} to ${found.verb} this block.`,
      };
    case "component":
      return {
        // A host that names no component still says whose the block is.
        headline:
          found.label === ""
            ? "Set by its component."
            : `Set by the component ${found.label}.`,
        remedy: "Change it where the component is edited.",
      };
    case "destination":
      return {
        headline: `${found.label} is locked.`,
        remedy: "Unlock it to add blocks to it.",
      };
  }
}

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
 * Why a block locked in Layers, or one holding or held by it, will not move:
 * the locked block by the name the author knows it by, where it sits, and
 * the way forward.
 */
export function lockedBlockWording(
  locked: BlockNode,
  subjectId: string,
  verb: LockedVerb = "move"
): RefusalWording {
  return layersLockWording(layersLockFacts(locked, subjectId, verb));
}

/**
 * The same refusal as one sentence, for a surface that says it in a single
 * line: a menu item's reason, an announcement.
 */
export function lockedBlockSentence(
  locked: BlockNode,
  subjectId: string,
  verb: LockedVerb
): string {
  const wording = lockedBlockWording(locked, subjectId, verb);
  return `${wording.headline} ${wording.remedy}`;
}

/**
 * The headline names the locked area by the block that holds it; the remedy
 * says what the lock still allows, which is the author's way forward. A
 * Layers lock is worded by the block the author locked.
 */
export function lockRefusalWording(found: LockRefusalFacts): RefusalWording {
  if (isLayersLockFacts(found)) return layersLockWording(found);
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
