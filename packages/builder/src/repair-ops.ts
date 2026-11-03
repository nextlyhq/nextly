/**
 * A repair, of locks and placements, as ops the editor's store applies, so
 * confirming it is one edit an author can undo.
 *
 * The engine's `planRepair` decides the repair: its `result` is the document
 * the author confirms, and its steps are what the preview shows. The store
 * takes only ops, so this turns the steps into them, applying each as it goes
 * so every position is read off the document as it then stands. The plan
 * stays the one answer: ops that do not give exactly its `result` are not the
 * repair the author confirmed, and are refused rather than applied.
 *
 * @module repair-ops
 */
import {
  applyOp,
  DEFAULT_LIMITS,
  findNode,
  layersLockBreak,
  locateNode,
  OpError,
  positionOf,
  sameStoredValue,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type DocumentLimits,
  type RepairPlan,
  type RepairStep,
} from "@nextlyhq/blocks-engine";

/** Why a repair cannot be applied as planned. */
export type RepairRefusal =
  /**
   * A block the repair changes is locked in Layers: the block it moves, one
   * inside it, or one around a block it moves, changes or adds to.
   */
  | { readonly reason: "locked-block"; readonly nodeId: string }
  /** The ops did not give the planned document. */
  | { readonly reason: "unplaceable" };

/** The ops that apply a repair, or why it cannot be applied. */
export type RepairOps =
  | { readonly ops: readonly BuilderOp[] }
  | { readonly refused: RepairRefusal };

type UpdateOp = Extract<BuilderOp, { kind: "update" }>;
type RemovableField = NonNullable<UpdateOp["unset"]>[number];

/** The document as the ops so far left it, and the ops. */
interface Translation {
  current: BlockDocument;
  readonly ops: BuilderOp[];
  readonly limits: DocumentLimits;
}

/**
 * The ops that turn `document` into `plan.result`.
 *
 * @param document - the document the plan was made from
 * @param plan - its repair, from the engine's `planRepair`
 */
export function repairOps(
  document: BlockDocument,
  plan: RepairPlan,
  limits: DocumentLimits = DEFAULT_LIMITS
): RepairOps {
  const at: Translation = { current: document, ops: [], limits };
  // Every reset first: a reset puts a block's parts back as it starts and
  // touches nothing another step does, so taking them first keeps each
  // document on the way, and each undo back, within the caps the plan's
  // result fits, where an add made before a large reset could pass them.
  const resetsFirst = [
    ...plan.steps.filter(step => step.kind === "reset"),
    ...plan.steps.filter(step => step.kind !== "reset"),
  ];
  for (const group of slotGroups(resetsFirst)) {
    // How many blocks this slot's repair has already placed after each block,
    // so the next one goes after them, in the order the plan placed them.
    const placedAfter = new Map<string, number>();
    for (const step of inApplyOrder(group)) {
      const refused = applyStep(at, step, plan.result, placedAfter);
      if (refused !== undefined) return { refused };
    }
  }
  if (!sameStoredValue(at.current.nodes, plan.result.nodes)) {
    return { refused: { reason: "unplaceable" } };
  }
  return { ops: at.ops };
}

/**
 * The plan's steps, split by the slot each repairs: a slot's adds, reorder
 * and moves arrive together, and a reset is a group of its own.
 */
function slotGroups(steps: readonly RepairStep[]): RepairStep[][] {
  const groups: RepairStep[][] = [];
  let key: string | undefined;
  for (const step of steps) {
    const next = placeOf(step);
    if (next !== key || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(step);
    key = next;
  }
  return groups;
}

function placeOf(step: RepairStep): string {
  switch (step.kind) {
    case "move":
      // A placement move names the exact block it lands after, so it is a
      // group of its own: never counted against a lock move's anchor, and
      // never sorted ahead of a lock add in the slot it leaves.
      return step.cause === "placement"
        ? `placement\u0000${step.nodeId}`
        : `${step.from.holderId}\u0000${step.from.slot}`;
    case "add":
      return `${step.at.holderId}\u0000${step.at.slot}`;
    case "reorder":
      return `${step.holderId}\u0000${step.slot}`;
    case "reset":
      return `reset\u0000${step.nodeId}`;
  }
}

/**
 * A slot's steps in the order that places each block where the plan does:
 * the blocks it may not hold out first, so an added block's index counts
 * only the blocks that stay; then the adds, by index; then the order.
 */
function inApplyOrder(group: readonly RepairStep[]): RepairStep[] {
  const rank = { move: 0, add: 1, reorder: 2, reset: 3 } as const;
  return [...group].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Apply one step's ops; the refusal when one cannot be applied. */
function applyStep(
  at: Translation,
  step: RepairStep,
  result: BlockDocument,
  placedAfter: Map<string, number>
): RepairRefusal | undefined {
  for (const op of opsFor(at, step, result, placedAfter)) {
    // Asked before applying, with the op layer's own rule: nothing a Layers
    // lock covers changes until it is unlocked, whether the step moves a
    // locked block, moves or changes one inside a locked block, or adds to
    // one, and the author is told which block to unlock.
    const broken = layersLockBreak(at.current.nodes, op);
    if (broken !== undefined) {
      return { reason: "locked-block", nodeId: broken.lockedId };
    }
    try {
      at.current = applyOp(at.current, op, at.limits).document;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      return { reason: "unplaceable" };
    }
    at.ops.push(op);
  }
  return undefined;
}

/**
 * One step's ops, each built from the document as the ops before it left it.
 * A generator, so a reorder's second move is built after its first applied.
 */
function* opsFor(
  at: Translation,
  step: RepairStep,
  result: BlockDocument,
  placedAfter: Map<string, number>
): Generator<BuilderOp> {
  switch (step.kind) {
    case "move":
      yield* moveOut(at, step, placedAfter);
      return;
    case "add":
      yield* addStarting(at, step, result);
      return;
    case "reorder":
      yield* putInOrder(at, step);
      return;
    case "reset":
      yield* resetOp(at.current, result, step.nodeId);
      return;
  }
}

type StepOf<K extends RepairStep["kind"]> = Extract<RepairStep, { kind: K }>;

/** A block moved to just after its anchor, after any the slot already put there. */
function* moveOut(
  at: Translation,
  step: StepOf<"move">,
  placedAfter: Map<string, number>
): Generator<BuilderOp> {
  const anchor = locateNode(at.current.nodes, step.after);
  if (anchor === undefined) return;
  const before = placedAfter.get(step.after) ?? 0;
  placedAfter.set(step.after, before + 1);
  yield {
    kind: "move",
    id: step.nodeId,
    to: { ...positionOf(anchor), index: anchor.index + 1 + before },
  };
}

/** A missing starting block, as the plan's result holds it. */
function* addStarting(
  at: Translation,
  step: StepOf<"add">,
  result: BlockDocument
): Generator<BuilderOp> {
  const node = findNode(result.nodes, step.nodeId);
  if (node === undefined) return;
  const held = slotOf(at.current, step.at.holderId, step.at.slot);
  yield {
    kind: "insert",
    node,
    at: {
      parentId: step.at.holderId,
      slot: step.at.slot,
      index: Math.min(step.at.index, held.length),
    },
  };
}

/** Each block not already at its place in the order, moved there. */
function* putInOrder(
  at: Translation,
  step: StepOf<"reorder">
): Generator<BuilderOp> {
  for (const [index, id] of step.order.entries()) {
    const now = slotOf(at.current, step.holderId, step.slot);
    if (now[index]?.id === id) continue;
    yield {
      kind: "move",
      id,
      to: { parentId: step.holderId, slot: step.slot, index },
    };
  }
}

function slotOf(
  document: BlockDocument,
  holderId: string,
  slot: string
): readonly BlockNode[] {
  return findNode(document.nodes, holderId)?.slots?.[slot] ?? [];
}

/**
 * The update that gives a node the fields the plan's result gives it: each
 * one that differs set, each one the result drops removed. Its id, type and
 * slots are not an update's to change, and a reset leaves them alone.
 */
function* resetOp(
  current: BlockDocument,
  result: BlockDocument,
  id: string
): Generator<UpdateOp> {
  const held = findNode(current.nodes, id);
  const target = findNode(result.nodes, id);
  if (held === undefined || target === undefined) return;
  const { patch, unset } = fieldChanges(
    held as unknown as Record<string, unknown>,
    target as unknown as Record<string, unknown>
  );
  if (Object.keys(patch).length === 0 && unset.length === 0) return;
  yield {
    kind: "update",
    id,
    patch: patch,
    ...(unset.length === 0 ? {} : { unset }),
  };
}

/** The fields to set and to remove so `held` becomes `target`. */
function fieldChanges(
  held: Record<string, unknown>,
  target: Record<string, unknown>
): { patch: Record<string, unknown>; unset: RemovableField[] } {
  const patch: Record<string, unknown> = {};
  const unset: RemovableField[] = [];
  for (const key of new Set([...Object.keys(target), ...Object.keys(held)])) {
    if (UNPATCHED.has(key)) continue;
    if (!Object.hasOwn(target, key)) unset.push(key as RemovableField);
    else if (!sameStoredValue(held[key], target[key])) patch[key] = target[key];
  }
  return { patch, unset };
}

/** The fields no update changes. */
const UNPATCHED: ReadonlySet<string> = new Set(["id", "type", "slots"]);
