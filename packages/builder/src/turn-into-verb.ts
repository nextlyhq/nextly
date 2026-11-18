/**
 * "Turn into" for the selected block: which types it can become, whether
 * each is open, what each would remove, and the one verb every surface runs.
 *
 * The block menu, the bar's More menu, the command palette and the floating
 * format bar all read {@link turnIntoOffers} and run {@link runTurnInto}, so
 * one surface cannot offer a turn another refuses, or say a different thing
 * about what it removes. What a block becomes is the block's own converter,
 * planned by the engine (`planTurnInto`); this module adds what an editing
 * surface needs on top: the locks, the placement rule, and the words.
 *
 * Only Text, Rich text and Heading turn into each other today, so the verbs
 * are named for them: a menu verb has a fixed id, and a block offering a
 * target outside these three is offered nothing for it.
 *
 * @module turn-into-verb
 */

import {
  applyOp,
  findNode,
  getBlock,
  placementRefusal,
  planTurnInto,
  registryBlockSource,
  registryNestingSource,
  turnIntoTargets,
  type BlockDocument,
  type BuilderOp,
  type DocumentLimits,
  type NamedClass,
  type NestingSource,
  type TurnIntoDefinitions,
  type TurnIntoPlan,
} from "@nextlyhq/blocks-engine";

import { placementWording } from "./canvas/drag-refusal";
import {
  lockedBlockWording,
  lockRefusalWording,
  type LockRefusalFacts,
} from "./lock-refusal";
import { lockBlockingDelete } from "./locking";
import { refusalAnnouncement } from "./move-refusal";
import { blockLabel } from "./panels/add/inserter-catalog";

/** The menu verbs, by the type each turns the block into. */
export const TURN_INTO_TARGETS = {
  "turn-into-text": "core/text",
  "turn-into-rich-text": "core/rich-text",
  "turn-into-heading": "core/heading",
} as const;

/** One of the menu verbs. */
export type TurnIntoActionId = keyof typeof TURN_INTO_TARGETS;

/** Whether an action id is one of the "Turn into" verbs. */
export function isTurnIntoAction(id: string): id is TurnIntoActionId {
  return Object.hasOwn(TURN_INTO_TARGETS, id);
}

/** The words "Turn into" says, in one place. */
const TURN_INTO_WORDS = {
  menu: "Turn into",
  /** Said when a binding cannot move to the new block. */
  unbound: "Its bound field is removed",
  /** Said when part of a block style gives way to a shared style. */
  lookTrimmed: "Part of its block style gives way to its other styles",
  /** Said when the block takes the new type's default block style. */
  defaultLook: (name: string): string =>
    `Its block style changes to ${name}'s default`,
  /** Said when the page refused the edit for a reason nothing judged first. */
  refused: "The page refused this edit, so nothing changed.",
  label: (name: string): string => `Turn into ${name}`,
  done: (name: string): string => `Turned into ${name}`,
} as const;

/** One type the selected block can become. */
export interface TurnIntoOffer {
  readonly id: TurnIntoActionId;
  /** The type it becomes: `"core/heading"`. */
  readonly to: string;
  /** What the type is called: "Heading". */
  readonly name: string;
  /** The verb: "Turn into Heading". */
  readonly label: string;
  readonly enabled: boolean;
  /** Why it is not open, for an author, when it is not. */
  readonly reason?: string;
  /** What the turn removes, said before it is chosen. */
  readonly note?: string;
}

/** The editor's own lock question, asked of the op a turn would apply. */
export type TurnIntoLockQuestion = (
  ops: readonly BuilderOp[]
) => LockRefusalFacts | undefined;

/** What judging a turn may ask beyond the document. */
export interface TurnIntoJudging {
  /** The editor's lock question; absent, a slot's lock is not asked. */
  readonly ask?: TurnIntoLockQuestion;
  /**
   * Whether to judge the turn in full: the slot locks and the placement rule,
   * which apply the op to answer. False for what a surface shows as the
   * selection changes; a menu that opens, and the verb, judge in full.
   */
  readonly planned?: boolean;
  readonly nesting?: NestingSource;
  readonly definitions?: TurnIntoDefinitions;
  /**
   * The site's styles, so a block style the new type cannot wear is kept as
   * its own styles (`planTurnInto`). Absent, its id is carried as is.
   */
  readonly library?: readonly NamedClass[];
  /**
   * The editor's size limits, which the trial edit the placement rule is
   * asked of is judged by, as the editor's own apply is. Absent, the
   * defaults.
   */
  readonly limits?: DocumentLimits;
}

/** What a turn removes, as one line: the converter's words, then a binding. */
function turnIntoNote(plan: TurnIntoPlan, name: string): string | undefined {
  const said = [
    plan.dropped,
    plan.unbound.length > 0 ? TURN_INTO_WORDS.unbound : undefined,
    plan.lookTrimmed === true ? TURN_INTO_WORDS.lookTrimmed : undefined,
    plan.defaultLookChanges === true
      ? TURN_INTO_WORDS.defaultLook(name)
      : undefined,
  ].filter((each): each is string => each !== undefined);
  return said.length === 0 ? undefined : said.join(". ");
}

/** A judged turn: the offer, and the plan when there is one. */
interface Judged {
  readonly offer: TurnIntoOffer;
  readonly plan?: TurnIntoPlan;
}

/** Why the placement rule refuses the turned block where it stands. */
function placementReason(
  document: BlockDocument,
  plan: TurnIntoPlan,
  nesting: NestingSource,
  limits: DocumentLimits | undefined
): string | undefined {
  let after: BlockDocument;
  try {
    after = applyOp(document, plan.op, limits).document;
  } catch {
    // Not one this rule can judge (the trial was refused, a cap say): the
    // editor's own apply, with the host's limits, decides when it runs.
    return undefined;
  }
  const found = placementRefusal(
    document,
    after,
    { nesting, definitions: registryBlockSource() },
    limits
  );
  if (found === undefined) return undefined;
  const parent =
    found.parentId === undefined
      ? undefined
      : findNode(document.nodes, found.parentId)?.type;
  return refusalAnnouncement(
    placementWording(found.verdict, plan.op.node.type, parent)
  );
}

/** Why a planned turn may not run here, or `undefined` when it may. */
function judgedReason(
  document: BlockDocument,
  plan: TurnIntoPlan,
  judging: TurnIntoJudging
): string | undefined {
  if (judging.planned !== true) return undefined;
  const locked = judging.ask?.([plan.op]);
  if (locked !== undefined) {
    return refusalAnnouncement(lockRefusalWording(locked));
  }
  return placementReason(
    document,
    plan,
    judging.nesting ?? registryNestingSource(),
    judging.limits
  );
}

/** One turn, judged: open, or closed with the reason. */
function judge(
  document: BlockDocument,
  id: string,
  action: TurnIntoActionId,
  judging: TurnIntoJudging
): Judged {
  const to = TURN_INTO_TARGETS[action];
  const name = blockLabel(to, judging.definitions ?? getBlock);
  const base = { id: action, to, name, label: TURN_INTO_WORDS.label(name) };
  const locked = lockBlockingDelete(document, id);
  if (locked !== undefined) {
    const reason = lockedBlockWording(locked, id, "change").headline;
    return { offer: { ...base, enabled: false, reason } };
  }
  const plan = planTurnInto(
    document,
    id,
    to,
    judging.definitions,
    judging.library
  );
  if ("refused" in plan) {
    return { offer: { ...base, enabled: false, reason: plan.refused } };
  }
  const note = turnIntoNote(plan, name);
  const reason = judgedReason(document, plan, judging);
  return {
    offer: {
      ...base,
      enabled: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      ...(note === undefined ? {} : { note }),
    },
    plan,
  };
}

/** The menu verb that turns a block into `to`, if there is one. */
function actionFor(to: string): TurnIntoActionId | undefined {
  return (Object.keys(TURN_INTO_TARGETS) as TurnIntoActionId[]).find(
    action => TURN_INTO_TARGETS[action] === to
  );
}

/**
 * Every type the block `id` can be turned into, in the order its block
 * declares them, each open or closed with the reason; nothing for a block
 * that declares none, or that is not in the document.
 */
export function turnIntoOffers(
  document: BlockDocument,
  id: string,
  judging: TurnIntoJudging = {}
): TurnIntoOffer[] {
  const node = findNode(document.nodes, id);
  if (node === undefined) return [];
  return turnIntoTargets(node.type, judging.definitions ?? getBlock)
    .map(actionFor)
    .filter((action): action is TurnIntoActionId => action !== undefined)
    .map(action => judge(document, id, action, judging).offer);
}

/** The editor, as the verb uses it. */
export interface TurnIntoEditor {
  /** The document to turn the block in: the latest the editor holds. */
  readonly document: BlockDocument;
  readonly apply: (op: BuilderOp) => BlockDocument | null;
  readonly lockRefusalFor?: TurnIntoLockQuestion;
}

/**
 * Turn the block `id` into `to`, as one undo step, saying what happened: why
 * it did not, or that it did and what it removed. Answers whether it did.
 */
export function runTurnInto(
  editor: TurnIntoEditor,
  id: string,
  to: string,
  say: (words: string) => void,
  judging: Omit<TurnIntoJudging, "ask" | "planned"> = {}
): boolean {
  const action = actionFor(to);
  if (action === undefined) return false;
  const { offer, plan } = judge(editor.document, id, action, {
    ...judging,
    planned: true,
    ...(editor.lockRefusalFor === undefined
      ? {}
      : { ask: editor.lockRefusalFor }),
  });
  if (!offer.enabled || plan === undefined) {
    say(offer.reason ?? TURN_INTO_WORDS.refused);
    return false;
  }
  if (editor.apply(plan.op) === null) {
    say(TURN_INTO_WORDS.refused);
    return false;
  }
  const done = TURN_INTO_WORDS.done(offer.name);
  say(offer.note === undefined ? done : `${done}. ${offer.note}`);
  return true;
}
