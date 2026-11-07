/**
 * What the floating toolbar offers for the selected block, and where it sits.
 *
 * The structural verbs — select the container, move up, move down, duplicate,
 * delete — exist already and are reachable only by keystroke. An author who has
 * never read a shortcut list has no way to discover that this editor can
 * duplicate a block at all, so the verbs are effectively absent for most of the
 * people using them. This module is the half of that fix which can be decided
 * without a DOM.
 *
 * ## Two questions, both pure
 *
 * **Which actions, and can they run.** Every answer is delegated: whether a
 * move is possible is `keyboardMovePosition`, whether a lock forbids it is
 * `lockBlockingMove` and `lockBlockingDelete`, whether a duplicate has a
 * position is `blockDuplication`. Nothing here re-derives any of those, because
 * a toolbar that decided for itself would eventually disagree with the
 * keystroke that does the same thing — and the author would meet the
 * disagreement as a button that looks available and does nothing.
 *
 * **Where the bar goes.** Above the block, falling back to below it, clamped
 * into the canvas. Separated from the rendering so the placement rules can be
 * asserted at sizes a jsdom test cannot produce: every rectangle in jsdom is
 * zero, so a placement computed inside a component is a placement no test can
 * see.
 *
 * ## Why a disabled button rather than a hidden one
 *
 * A toolbar whose buttons come and go changes width and order as the selection
 * moves, so the control an author is aiming at is somewhere else by the time
 * they arrive. Disabled buttons keep the bar one shape, and the reason is
 * carried with the action so the surface can say why rather than leaving the
 * author to guess.
 *
 * @module toolbar-actions
 */

import {
  findNode,
  isComponentInstance,
  planConvertToComponent,
  planDetach,
  registryNestingSource,
  saveAsPatternRefusal,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
  type NestingSource,
} from "@nextlyhq/blocks-engine";

import { compositionRefusalReason } from "./composition-refusal";
import { blockDeletion } from "./delete-block";
import type { RefusalWording } from "./drag-refusal";
import { duplicationRefusal } from "./entry-content-rules";
import type { Rect } from "./geometry";
import { placedComponentId } from "./instance-inspector";
import {
  keyboardMovePosition,
  type KeyboardMove,
  type MoveDirection,
} from "./keyboard-move";
import { pathTo } from "./layers";
import {
  lockedBlockWording,
  lockRefusalWording,
  type LockedVerb,
  type LockRefusalFacts,
} from "./lock-refusal";
import {
  lockBlockingDelete,
  lockBlockingEdit,
  lockBlockingMove,
} from "./locking";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp, OpPosition } from "./op-vocabulary";
import {
  isRefusal,
  selectionDeletion,
  selectionDuplication,
  selectionMove,
} from "./selection-ops";
import {
  saveAsSharedStyleRefusal,
  type SharedStyleOffer,
} from "./shared-style-target";

/** The editor's own lock question, asked of the ops a verb would apply. */
type LockQuestion = (ops: readonly BuilderOp[]) => LockRefusalFacts | undefined;

/**
 * Why a slot's lock refuses the ops, in the words every lock refusal uses, or
 * undefined when it does not, or when the caller asked nothing.
 */
function lockReason(
  ask: LockQuestion | undefined,
  ops: readonly BuilderOp[]
): string | undefined {
  const found = ask?.(ops);
  return found === undefined
    ? undefined
    : refusalAnnouncement(lockRefusalWording(found));
}

/** An action enabled, or dimmed with the lock's reason when one refuses it. */
function heldByLock<A extends Pick<ToolbarAction, "enabled" | "reason">>(
  action: A,
  ask: LockQuestion | undefined,
  ops: readonly BuilderOp[] | undefined
): A {
  if (!action.enabled || ops === undefined) return action;
  const reason = lockReason(ask, ops);
  return reason === undefined ? action : { ...action, enabled: false, reason };
}

/** The verbs the bar offers, in the order it draws them. */
export type ToolbarActionId =
  | "select-parent"
  | "move-up"
  | "move-down"
  | "duplicate"
  | "save-as-pattern"
  | "save-as-shared-style"
  | "edit-component"
  | "turn-into-component"
  | "detach-component"
  | "duplicate-component"
  | "update-pattern"
  | "delete";

/** One button's worth of decision. */
export interface ToolbarAction {
  readonly id: ToolbarActionId;
  /**
   * The accessible name, which is also the tooltip.
   *
   * Fixed per verb rather than naming the block: the bar is drawn against the
   * block it acts on, so "Duplicate" is unambiguous there, and a name that grew
   * with the block's would reflow the bar on every selection.
   */
  readonly label: string;
  /** Whether pressing it would do anything. */
  readonly enabled: boolean;
  /**
   * Why it is disabled, phrased for an author, or `undefined` when enabled.
   *
   * Set for every disabled item, so nothing is dimmed without a word: a lock,
   * which nothing on the canvas explains and whose remedy is one field away,
   * and the plain edges too ("Already the first block here"), since a dimmed
   * item with no reason reads as broken rather than as finished.
   */
  readonly reason?: string;
  /**
   * Offered from a menu rather than as a button of its own: the block
   * toolbar keeps these behind its "More" button, and the context menu groups
   * them, so the bar stays one short row however many verbs the host adds.
   */
  readonly inMenu?: true;
}

/**
 * What the host offers for making components from a selection.
 *
 * Absent where the host has no component library to write to, and then
 * neither verb is offered at all.
 */
export interface ComponentVerbsOffer {
  /**
   * Whether the author may create and publish components, which both verbs
   * need: the component is created published. `false` dims both, with
   * {@link MAKE_COMPONENT_GRANT_REFUSAL}.
   */
  readonly mayCreate: boolean;
  /**
   * The component definitions the canvas draws, which a detach inlines.
   * Absent, Detach is not offered.
   */
  readonly definitions?: DefinitionsById;
  /**
   * Whether the author may update and publish patterns. Absent, "Update
   * pattern" is not offered; `false` dims it with the reason.
   */
  readonly mayUpdatePattern?: boolean;
}

/** What an author without the grant to update a pattern is told. */
const UPDATE_PATTERN_GRANT_REFUSAL =
  "You do not have permission to update and publish patterns.";

/** What an author without the grant to make a component is told. */
const MAKE_COMPONENT_GRANT_REFUSAL =
  "You do not have permission to create and publish components.";

/** The id a convert is planned under before the component exists. */
const PLANNED_COMPONENT_ID = "planned-component";

/**
 * What "Turn into component…" may do with a selection: replace the blocks
 * with a placement of the new component, or keep them and save a copy. Each
 * way is asked of its planner rather than restated: keeping shares the
 * pattern save's selection rules; replacing is planned in full, and the ops
 * it would apply are put to the editor's lock question, since a slot's lock
 * can refuse the placement that replaces the run. A way that is refused
 * carries its reason; both open, the object is empty.
 */
export interface TurnIntoChoice {
  /** Why the blocks cannot be replaced, so only a copy can be saved. */
  readonly replaceRefused?: string;
  /** Why no copy can be saved leaving them, so only replacing is open. */
  readonly keepRefused?: string;
}

/** Each way "Turn into component…" may go, and why not where it may not. */
export function turnIntoChoice(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  ask?: LockQuestion
): TurnIntoChoice {
  const saving = saveAsPatternRefusal(document, ids, nesting);
  const converting = planConvertToComponent(
    document,
    ids,
    { collection: "", fields: {} },
    PLANNED_COMPONENT_ID,
    {},
    nesting
  );
  const replaceRefused =
    converting.problem !== undefined
      ? compositionRefusalReason(converting)
      : converting.pageOps === undefined
        ? undefined
        : lockReason(ask, converting.pageOps);
  return {
    ...(replaceRefused === undefined ? {} : { replaceRefused }),
    ...(saving === undefined
      ? {}
      : { keepRefused: compositionRefusalReason(saving) }),
  };
}

/**
 * "Turn into component…": ONE item for both ways of making a component from
 * the selection, the choice between them made in its dialog. Offered while
 * either way is open; dimmed, with the reason, when neither is.
 */
function componentActions(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  offer: ComponentVerbsOffer | undefined,
  ask: LockQuestion | undefined
): ToolbarAction[] {
  if (offer === undefined) return [];
  const turn: ToolbarAction = {
    id: "turn-into-component",
    label: "Turn into component…",
    enabled: true,
    inMenu: true,
  };
  if (!offer.mayCreate) {
    return [{ ...turn, enabled: false, reason: MAKE_COMPONENT_GRANT_REFUSAL }];
  }
  const choice = turnIntoChoice(document, ids, nesting, ask);
  if (choice.replaceRefused !== undefined && choice.keepRefused !== undefined) {
    return [{ ...turn, enabled: false, reason: choice.replaceRefused }];
  }
  return [turn];
}

/**
 * "Detach" and "Duplicate component" for one selected placement, and nothing
 * for any other selection, so a menu over a heading does not grow verbs that
 * could never apply to it. Detach is planned in full against the definitions
 * the canvas draws, and its ops are put to the editor's lock question.
 */
function placementActions(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  offer: ComponentVerbsOffer | undefined,
  ask: LockQuestion | undefined
): ToolbarAction[] {
  const only = ids.length === 1 ? ids[0] : undefined;
  if (offer === undefined || only === undefined) return [];
  const node = findNode(document.nodes, only);
  if (node === undefined || !isComponentInstance(node)) return [];
  const actions: ToolbarAction[] = [];
  if (offer.definitions !== undefined) {
    const detach: ToolbarAction = {
      id: "detach-component",
      label: "Detach from component",
      enabled: true,
      inMenu: true,
    };
    const plan = planDetach(document, only, offer.definitions, nesting);
    actions.push(
      plan.problem === undefined
        ? heldByLock(detach, ask, plan.pageOps)
        : { ...detach, enabled: false, reason: compositionRefusalReason(plan) }
    );
  }
  const duplicate: ToolbarAction = {
    id: "duplicate-component",
    label: "Duplicate component",
    enabled: true,
    inMenu: true,
  };
  if (!offer.mayCreate) {
    actions.push({
      ...duplicate,
      enabled: false,
      reason: MAKE_COMPONENT_GRANT_REFUSAL,
    });
    return actions;
  }
  // The copy is made from the component as this author may read it; one the
  // canvas could not load for them is not one they can copy.
  const source = (node.props as { componentId?: unknown }).componentId;
  if (
    offer.definitions !== undefined &&
    (typeof source !== "string" || !offer.definitions.has(source))
  ) {
    actions.push({
      ...duplicate,
      enabled: false,
      reason: "This component is not available to copy.",
    });
    return actions;
  }
  // The re-point is an edit of the placement, so a Layers lock on it or around
  // it refuses Duplicate as it refuses any edit (`lockBlockingEdit`), in the
  // one wording; a slot's lock is the lock question's, through `heldByLock`.
  const held = lockBlockingEdit(document, only);
  actions.push(
    held === undefined
      ? heldByLock(duplicate, ask, [
          {
            kind: "update",
            id: only,
            patch: {
              props: { ...node.props, componentId: PLANNED_COMPONENT_ID },
            },
          },
        ])
      : {
          ...duplicate,
          enabled: false,
          reason: lockedBy(held, only, "change"),
        }
  );
  return actions;
}

/**
 * "Update pattern" for a selection that could be saved as one, where the host
 * offers it: the selection replaces a pattern's content.
 */
function updatePatternAction(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  offer: ComponentVerbsOffer | undefined
): ToolbarAction[] {
  if (offer?.mayUpdatePattern === undefined) return [];
  const action: ToolbarAction = {
    id: "update-pattern",
    label: "Update a pattern",
    enabled: true,
    inMenu: true,
  };
  if (!offer.mayUpdatePattern) {
    return [
      { ...action, enabled: false, reason: UPDATE_PATTERN_GRANT_REFUSAL },
    ];
  }
  const refusal = saveAsPatternRefusal(document, ids, nesting);
  return [
    refusal === undefined
      ? action
      : {
          ...action,
          enabled: false,
          reason: compositionRefusalReason(refusal),
        },
  ];
}

/** Every verb of the menu's component group, in the order it lists them. */
function compositionActions(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  offer: ComponentVerbsOffer | undefined,
  ask: LockQuestion | undefined
): ToolbarAction[] {
  return [
    ...componentActions(document, ids, nesting, offer, ask),
    ...placementActions(document, ids, nesting, offer, ask),
    ...updatePatternAction(document, ids, nesting, offer),
  ];
}

/**
 * What a Layers-lock refusal says on a button or a menu item: the headline of
 * the one wording every surface uses, the locked block by name and where it
 * sits relative to the selected one. Short, because it is said beside the
 * verb; the way forward is in the block card and in what a keystroke says.
 */
function lockedBy(
  locked: BlockNode,
  selectedId: string,
  verb: LockedVerb
): string {
  return lockedBlockWording(locked, selectedId, verb).headline;
}

/**
 * Where a block's move in one direction goes: the keyboard move's own answer.
 *
 * Passed in by a caller that runs the move, so the availability it shows is
 * asked with the very function, and the very component definitions, its verb
 * moves by. The default reads no definitions, as the bar's Move up and Move
 * down always have — a step within one list needs none.
 */
export type MovePosition = (
  document: BlockDocument,
  id: string,
  direction: MoveDirection
) => KeyboardMove | null;

/**
 * Whether the placement rule refuses a block's move to `to`, and its words,
 * or `null` when it allows it. Passed in by a caller that runs the move, so
 * an item it offers is judged by the very call its verb judges by.
 */
export type MoveJudge = (
  document: BlockDocument,
  id: string,
  to: OpPosition
) => RefusalWording | null;

const POSITION_WITHOUT_DEFINITIONS: MovePosition = (document, id, direction) =>
  keyboardMovePosition(document.nodes, id, direction);

/** Why a verb that acts on one block is not offered for a set. */
function oneAtATime(count: number): string {
  return `Only one block at a time. ${count} are selected.`;
}

/**
 * One block's move in one direction, as an action: dimmed when the block is
 * locked or has nowhere to go that way, and when a slot's lock refuses it.
 *
 * Where it goes is the keyboard move's own answer (`keyboardMovePosition`), so
 * an action offered here is the step its keystroke takes. Whether the
 * placement rule allows it there is asked when it runs, by the same verb the
 * keystroke runs, which says why when it does not.
 */
function singleMove<Id extends string>(
  document: BlockDocument,
  selectedId: string,
  id: Id,
  label: string,
  direction: MoveDirection,
  ask: LockQuestion | undefined,
  position: MovePosition = POSITION_WITHOUT_DEFINITIONS,
  judge?: MoveJudge
): Omit<ToolbarAction, "id"> & { readonly id: Id } {
  const moveLock = lockBlockingMove(document, selectedId);
  if (moveLock !== undefined) {
    return {
      id,
      label,
      enabled: false,
      reason: lockedBy(moveLock, selectedId, "move"),
    };
  }
  const to = position(document, selectedId, direction);
  // The placement rule's refusal, said where the author would press.
  const refused =
    to === null || judge === undefined
      ? null
      : judge(document, selectedId, to.to);
  if (refused !== null) {
    return { id, label, enabled: false, reason: refusalAnnouncement(refused) };
  }
  return heldByLock(
    to === null
      ? { id, label, enabled: false, reason: EDGE_REASONS[direction] }
      : { id, label, enabled: true },
    ask,
    to === null
      ? undefined
      : [
          {
            kind: "move",
            id: selectedId,
            to: to.to,
            dropSlotIfEmpty: to.dropSlotIfEmpty,
          },
        ]
  );
}

/**
 * Why a block, or a set moving as one, cannot move one step when there is
 * simply nowhere to go: said as plainly as a lock is, since a dimmed item with
 * no reason reads as broken. Worded to stay true for every `null` the keyboard
 * move gives: an indent is refused both with no block above and with one
 * whose several regions leave none to name, and the set's edge is its first
 * or last block's.
 */
const EDGE_REASONS: Record<MoveDirection, string> = {
  up: "Already at the top here",
  down: "Already at the bottom here",
  indent: "No block just above that it can go into",
  outdent: "Already at the top level of the page",
};

/**
 * Whether a set can move one step, and what to say when it cannot.
 *
 * The plan itself is the answer: `selectionMove` already decides that a set
 * straddling two containers has nowhere to go and that one block at the edge
 * holds the rest, and asking it here keeps the bar agreeing with the keyboard
 * rather than testing those rules a second time.
 *
 * `null` is the edge of the container, which is dimmed with the same reason
 * a single block at the end of its list gives.
 */
function moveAction(
  document: BlockDocument,
  ids: readonly string[],
  id: "move-up" | "move-down",
  label: string,
  direction: "up" | "down",
  ask?: LockQuestion
): ToolbarAction {
  const plan = selectionMove(document, ids, direction);
  if (plan === null)
    return { id, label, enabled: false, reason: EDGE_REASONS[direction] };
  if (isRefusal(plan))
    return { id, label, enabled: false, reason: plan.reason };
  return heldByLock({ id, label, enabled: true }, ask, plan.ops);
}

/**
 * Whether this selection could be stored in the library, and why not.
 *
 * ASKED OF THE PLANNER, never restated. The ways a selection can be unsavable
 * are not a short list a toolbar should keep its own copy of — a run with a gap,
 * a block that may not be a document root, a node the op layer will not carry,
 * one HTML id on two of the run's nodes, a document past the byte cap — and a
 * surface enumerating them drifts the first time the planner learns a new way to
 * say no. It drifts SILENTLY: the button stays enabled and the save fails.
 *
 * Offered for a SET as readily as for one block, because saving several blocks
 * as one pattern is the ordinary case rather than the exception — a hero is a
 * heading, a paragraph and a button.
 *
 * The refusal carries a reason whatever the cause, unlike a move at the edge of
 * its container. There is nothing on the canvas that explains why a selection
 * cannot be saved, so leaving it dimmed and silent would be a control an author
 * can only guess at.
 */
/**
 * What an author is told when they hold no grant to save a pattern.
 *
 * Names the OPERATION the author attempted, not a permission. Saving needs more
 * than one grant — the pattern is stored and published in the same act — so a
 * message naming any single one is wrong for somebody: an author who may create
 * a pattern but not publish it would be told they cannot create, and would go
 * and ask for the grant they already hold. "Save" is also the word on the
 * control they pressed, which is the thing they can describe when they ask.
 *
 * Which grant is missing is deliberately NOT reported. The answer arrives as
 * one boolean because that is the question the verb asks, and a message
 * enumerating server-side permission names would tie this copy to slugs the
 * browser has no other reason to know — the same coupling the resolved-slug
 * lookup exists to avoid.
 *
 * ONE string, exported, because two surfaces say it: this list, which dims the
 * control and titles it, and the runner in `keyboard-actions`, which announces
 * it when a dimmed control is pressed anyway. Written twice they would drift,
 * and the drift would be invisible — each reads correctly on its own.
 */
export const SAVE_PATTERN_GRANT_REFUSAL =
  "You do not have permission to save patterns.";

function saveAction(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  mayCreate: boolean
): ToolbarAction {
  const label = "Save as pattern";
  // The GRANT first, and it is the one refusal not asked of the planner —
  // because it is not about this selection. Every other reason a save is
  // refused describes the blocks in hand, so a planner that learns a new one
  // is still describing them; whether the author may create a pattern at all
  // is true of the next selection too. Asked first so an author who cannot
  // save is told that, rather than told why these particular blocks are
  // unsuitable for a thing they could not have saved either way.
  if (!mayCreate)
    return {
      id: "save-as-pattern",
      label,
      enabled: false,
      reason: SAVE_PATTERN_GRANT_REFUSAL,
    };
  const refusal = saveAsPatternRefusal(document, ids, nesting);
  if (refusal === undefined)
    return { id: "save-as-pattern", label, enabled: true };
  return {
    id: "save-as-pattern",
    label,
    enabled: false,
    reason: compositionRefusalReason(refusal),
  };
}

/**
 * "Save as shared style…" for one block, where the host offers shared
 * styles: dimmed with the reason the save rule gives (one style per block in
 * the first release, a block with no styles of its own, the author's right,
 * the block's lock), asked of that rule rather than restated.
 */
function sharedStyleActions(
  document: BlockDocument,
  ids: readonly string[],
  offer: SharedStyleOffer | undefined
): ToolbarAction[] {
  if (offer === undefined) return [];
  const action: ToolbarAction = {
    id: "save-as-shared-style",
    label: "Save as shared style…",
    enabled: true,
    inMenu: true,
  };
  const only = ids.length === 1 ? ids[0] : undefined;
  if (only === undefined) {
    return [{ ...action, enabled: false, reason: oneAtATime(ids.length) }];
  }
  const reason = saveAsSharedStyleRefusal(document, only, offer);
  return [
    reason === undefined ? action : { ...action, enabled: false, reason },
  ];
}

/**
 * The bar for a selection holding more than one block.
 *
 * **Duplicate, delete and move keep their meaning; select-parent loses it.**
 * Copying six blocks is six copies each beside its own original, removing six
 * is removing six, and moving six that share a list is one step for each — all
 * three are the single-block verb repeated, which is what `selection-ops`
 * plans. "The parent" of blocks with different parents is not a block, so
 * select-parent has no answer to give and does not invent one.
 *
 * Move is offered but not always available: a set spread across two containers
 * has no shared list to step through, and that refusal carries a reason because
 * nothing on the page shows that the selection straddles a boundary.
 *
 * The bar keeps its five buttons and its one shape rather than shrinking. A
 * control that vanishes when a second block is selected moves every button
 * after it, so the one an author was aiming at is somewhere else by the time
 * they arrive — the same reason unavailable actions are dimmed rather than
 * hidden with a single block.
 */
function manyBlockActions(
  document: BlockDocument,
  ids: readonly string[],
  nesting: NestingSource,
  mayCreate: boolean,
  ask?: LockQuestion,
  components?: ComponentVerbsOffer,
  sharedStyles?: SharedStyleOffer
): ToolbarAction[] {
  const many = oneAtATime(ids.length);
  const deleteLock = ids
    .map(id => ({ id, locked: lockBlockingDelete(document, id) }))
    .find(held => held.locked !== undefined);

  return [
    {
      id: "select-parent",
      label: "Select parent",
      enabled: false,
      reason: many,
    },
    moveAction(document, ids, "move-up", "Move up", "up", ask),
    moveAction(document, ids, "move-down", "Move down", "down", ask),
    // A node's lock never stops a duplication, for a set as for one block:
    // the originals stay where they are. A slot's lock can.
    heldByLock(
      { id: "duplicate", label: "Duplicate", enabled: true },
      ask,
      opsOf(selectionDuplication(document, ids))
    ),
    saveAction(document, ids, nesting, mayCreate),
    ...sharedStyleActions(document, ids, sharedStyles),
    ...compositionActions(document, ids, nesting, components, ask),
    deleteLock?.locked === undefined
      ? heldByLock(
          { id: "delete", label: "Delete", enabled: true },
          ask,
          opsOf(selectionDeletion(document, ids))
        )
      : {
          id: "delete",
          label: "Delete",
          enabled: false,
          // ONE lock refuses the whole delete, because the group is applied
          // atomically and there is no half-done delete to fall back to.
          reason: lockedBy(deleteLock.locked, deleteLock.id, "delete"),
        },
  ];
}

/**
 * The toolbar's buttons for the current selection, or `[]` when there is none.
 *
 * `[]` also covers a selected id the document no longer holds, which an undo
 * produces routinely — the bar is drawn against an element, and there is no
 * element for a node that is gone.
 */
export function toolbarActions(
  document: BlockDocument,
  selectedId: string | null,
  /**
   * Every selected id. Defaults to the primary alone.
   *
   * Optional so a caller with one block — the command palette, a host that has
   * not adopted the set — keeps the same answer it had. What changes for a
   * SET is which verbs are well defined, not which rules decide them.
   */
  selectedIds?: readonly string[],
  /**
   * The nesting rule source, for asking whether a selection can be saved.
   *
   * Optional and defaulted to the registry, which is how the insert panel and
   * the keyboard route already default it — so a refusal reads the same whether
   * an author dragged the block, moved it with the keyboard, or tried to save
   * it. Present as an option only so a test can supply a rule set without
   * registering blocks globally.
   */
  nesting?: NestingSource,
  /**
   * Whether the caller may create a pattern at all. Defaults to true.
   *
   * The HOST's answer, because it is the host's question: the grant is seeded
   * against the collection a pattern goes in, a site may have renamed it, and
   * nothing here knows either. The same reason `onSaveAsPattern` is supplied
   * rather than performed here.
   *
   * PERMISSIVE by default, unlike every other refusal in this file. The others
   * are computed from the document in hand and an absent answer means the
   * question was not asked; this one arrives over the network, and "not yet"
   * would dim the verb on every mount for every author. A wrong `true` costs
   * the late refusal that already happens; a wrong `false` hides a feature the
   * author has, and there is nothing on the canvas to explain it.
   */
  mayCreatePattern: boolean = true,
  /**
   * The editor's `lockRefusalFor`, so a verb a slot's lock refuses is dimmed
   * with the lock's reason before it is pressed. Optional for a caller that
   * holds no editor; the editor's apply refuses the same ops regardless.
   */
  lockRefusalFor?: LockQuestion,
  /**
   * What the host offers for making components, or nothing where it has no
   * component library: then neither verb appears.
   */
  components?: ComponentVerbsOffer,
  /**
   * Whether the host opens a placed component in its own view. Offered only
   * for one selected placement, and only by a host that answers it; the host
   * also withholds it from an author who may not update components.
   */
  offersEditComponent: boolean = false,
  /**
   * What the host knows about the site's shared styles and the author's
   * right to change them, or nothing where it has none: then "Save as shared
   * style…" is not offered.
   */
  sharedStyles?: SharedStyleOffer
): ToolbarAction[] {
  if (selectedId === null) return [];

  const path = pathTo(document, selectedId);
  if (path.length === 0) return [];

  const rules = nesting ?? registryNestingSource();
  const ids = selectedIds ?? [selectedId];
  if (ids.length > 1)
    return manyBlockActions(
      document,
      ids,
      rules,
      mayCreatePattern,
      lockRefusalFor,
      components,
      sharedStyles
    );

  const deleteLock = lockBlockingDelete(document, selectedId);

  // The very ops the Duplicate verb applies, so what the bar offers and what
  // a press does cannot disagree.
  const duplication = selectionDuplication(document, [selectedId]);
  const deletion = blockDeletion(document, selectedId);

  return [
    {
      id: "select-parent",
      label: "Select parent",
      // The path always ends at the selection itself, so a length of one means
      // a top-level block with no container to step out to: the outdent's
      // reason, since it is the same fact.
      enabled: path.length > 1,
      ...(path.length > 1 ? {} : { reason: EDGE_REASONS.outdent }),
    },
    singleMove(
      document,
      selectedId,
      "move-up",
      "Move up",
      "up",
      lockRefusalFor
    ),
    singleMove(
      document,
      selectedId,
      "move-down",
      "Move down",
      "down",
      lockRefusalFor
    ),
    // A node's lock deliberately does not stop this. Duplicating neither moves
    // nor removes the original, and refusing would mean an author could not
    // take a copy of the one block they had most deliberately protected — the
    // same reading the keyboard duplicate takes. A slot's lock is another
    // matter: a copy changes what a slot whose blocks are fixed holds.
    heldByLock(
      duplicateAction(document, selectedId, duplication !== null),
      lockRefusalFor,
      duplication?.ops
    ),
    saveAction(document, ids, rules, mayCreatePattern),
    ...sharedStyleActions(document, ids, sharedStyles),
    ...editComponentAction(document, selectedId, offersEditComponent),
    ...compositionActions(document, ids, rules, components, lockRefusalFor),
    deleteLock === undefined
      ? heldByLock(
          { id: "delete", label: "Delete", enabled: deletion !== null },
          lockRefusalFor,
          deletion === null
            ? undefined
            : [
                {
                  kind: "remove",
                  id: deletion.id,
                  dropSlotIfEmpty: deletion.dropSlotIfEmpty,
                },
              ]
        )
      : {
          id: "delete",
          label: "Delete",
          enabled: false,
          reason: lockedBy(deleteLock, selectedId, "delete"),
        },
  ];
}

/**
 * "Edit component" for a selected placement, where the host offers it; nothing
 * for any other block, so a bar over a heading does not grow a dimmed button
 * that could never apply to it.
 */
function editComponentAction(
  document: BlockDocument,
  selectedId: string,
  offered: boolean
): ToolbarAction[] {
  // Asked as the verb asks: a placement naming no component has nothing to
  // open, so it is not offered a control that would do nothing.
  if (!offered || placedComponentId(document, selectedId) === undefined) {
    return [];
  }
  return [{ id: "edit-component", label: "Edit component", enabled: true }];
}

/**
 * The smallest rectangle containing all of them, or `undefined` for none.
 *
 * What a floating bar anchors to once a selection can hold several blocks. The
 * PRIMARY's rectangle would be the easy choice and is the wrong one: with two
 * blocks selected at opposite ends of a page, a bar drawn at one of them
 * describes an action that is about to happen to both, and the author cannot
 * see the other. The union is the shape the selection actually occupies.
 */
export function unionRect(rects: readonly Rect[]): Rect | undefined {
  const [first, ...rest] = rects;
  if (first === undefined) return undefined;

  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;

  for (const rect of rest) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** How big the bar measured, in canvas content pixels. */
export interface ToolbarSize {
  readonly width: number;
  readonly height: number;
}

/** Where the bar is drawn, and which side of the block it landed on. */
export interface ToolbarPlacement {
  readonly x: number;
  readonly y: number;
  /**
   * Above the block, below it, or pinned to the top of the screen over a tall
   * block whose own top is scrolled out of view.
   */
  readonly side: "above" | "below" | "pinned";
}

/**
 * The part of the canvas on screen, in its coordinates: top and bottom, and
 * the left and right edges where the canvas scrolls sideways too.
 */
export interface ToolbarScreen {
  readonly top: number;
  readonly bottom: number;
  readonly left?: number;
  readonly right?: number;
}

/** No screen to keep to: the whole page, from its top down. */
const WHOLE_PAGE: ToolbarScreen = {
  top: 0,
  bottom: Number.POSITIVE_INFINITY,
};

/** The gap between the bar and the block it names, in pixels. */
export const TOOLBAR_GAP_PX = 6;

/**
 * Where to draw the bar for a block, in the canvas's own content coordinates.
 *
 * **Above by default, below when there is no room.** Above keeps the bar off
 * the block's own content, which is what an author is looking at; the first
 * block on a page has nothing above it, and a bar clamped to the canvas top
 * would sit ON that block instead of beside it.
 *
 * **Left-aligned to the block, never centred.** A centred bar moves whenever
 * the block's width changes — which happens while an author is editing its
 * padding — so the button they are reaching for slides out from under the
 * pointer. The leading edge is the one part of a block that stays put.
 *
 * **Clamped horizontally, never vertically.** A bar pushed off the right edge
 * is unreachable, so it slides back in. Vertical overflow is handled by the
 * side flip above rather than by clamping, because a clamped bar overlaps the
 * block and a flipped one does not.
 *
 * **Kept to what is on screen** (`screen`, the whole page when not given):
 * room above is room above on screen, so a block just below the screen's top
 * flips its bar below it; and a tall block whose top is scrolled away keeps
 * its bar pinned at the top of the screen, over the block, where an author
 * working in its middle can reach it.
 */
export function toolbarPlacement(
  block: Rect,
  toolbar: ToolbarSize,
  canvas: ToolbarSize,
  gap: number = TOOLBAR_GAP_PX,
  screen: ToolbarScreen = WHOLE_PAGE,
  parts: readonly Rect[] = [block]
): ToolbarPlacement {
  const above = block.y - toolbar.height - gap;
  const below = block.y + block.height + gap;
  const side = toolbarSide(block, toolbar, gap, screen, above, below);

  // Kept to the canvas, and to the part of it on screen where that is given
  // and the block crosses it: a block wholly off the side keeps its bar with
  // it, rather than one at the screen's edge over another block. The clamp is
  // skipped when the bar is wider than that, because there is no position that
  // satisfies both edges and clamping would silently choose the right one —
  // leaving the first buttons, which are the ones an author reaches for,
  // off-screen.
  const left = screen.left ?? Number.NEGATIVE_INFINITY;
  const right = screen.right ?? Number.POSITIVE_INFINITY;
  // Judged by each selected block, not by their union: two blocks off
  // opposite sides have a union that crosses the screen through the gap.
  const crosses = parts.some(
    part => part.x < right && part.x + part.width > left
  );
  const minX = Math.max(0, crosses ? left : 0);
  const maxX =
    Math.min(canvas.width, crosses ? right : Number.POSITIVE_INFINITY) -
    toolbar.width;
  const x = maxX <= minX ? minX : Math.min(Math.max(block.x, minX), maxX);

  const y =
    side === "above" ? above : side === "below" ? below : screen.top + gap;
  return { x, y, side };
}

/**
 * Which side the bar takes. Below only when above would leave the screen, the
 * block is on it (its top, or a short end of it too little to pin over) and
 * the bar fits on screen under the block; a block
 * near the BOTTOM keeps the bar above it, where it is still visible, since
 * flipping there would push it under the fold for no gain. Pinned to the
 * screen's top over a block that fills the screen below the bar: one whose top
 * is scrolled away, or one too tall for the bar to fit under it on screen.
 * Above for a block wholly out of view.
 */
function toolbarSide(
  block: Rect,
  toolbar: ToolbarSize,
  gap: number,
  screen: ToolbarScreen,
  above: number,
  below: number
): ToolbarPlacement["side"] {
  if (above >= screen.top) return "above";
  const stillShown =
    block.y + block.height >= screen.top + toolbar.height + gap;
  const fitsBelow = below + toolbar.height <= screen.bottom;
  if (block.y >= screen.top) {
    return fitsBelow || !stillShown ? "below" : "pinned";
  }
  if (stillShown) return "pinned";
  // A short block whose top is just off the screen, with a little of it
  // still on: too little to pin the bar over, so below it where that fits.
  const partlyShown = block.y + block.height > screen.top;
  return partlyShown && fitsBelow ? "below" : "above";
}

/** A plan's ops, or undefined for no plan or a refusal. */
function opsOf(
  plan:
    | { readonly ops: readonly BuilderOp[] }
    | { readonly reason: string }
    | null
): readonly BuilderOp[] | undefined {
  return plan === null || !("ops" in plan) ? undefined : plan.ops;
}

/** The block menu's moves across depth: into the block above, and out. */
export type DepthMoveId = "move-in" | "move-out";

/** One of them, and the keyboard move it runs. */
export interface DepthMoveAction extends Omit<ToolbarAction, "id"> {
  readonly id: DepthMoveId;
  readonly direction: Extract<MoveDirection, "indent" | "outdent">;
}

const DEPTH_MOVES: ReadonlyArray<
  Pick<DepthMoveAction, "id" | "label" | "direction">
> = [
  { id: "move-in", label: "Move in", direction: "indent" },
  { id: "move-out", label: "Move out", direction: "outdent" },
];

/**
 * Move in and Move out for the current selection, or `[]` when there is none.
 *
 * The menu path to what Alt+ArrowRight and Alt+ArrowLeft do, so every move a
 * drag in Layers makes has a way without dragging. Decided as the bar decides
 * Move up and Move down — the keyboard move's position, the node's lock and a
 * slot's — and run through the same verb the keystroke runs. Kept off the bar
 * itself, whose five buttons are fixed so the one an author aims at does not
 * move.
 *
 * A set is offered them dimmed with the reason, as the bar dims a verb that
 * has no meaning for several blocks.
 */
export function depthMoveActions(
  document: BlockDocument,
  selectedId: string | null,
  selectedIds?: readonly string[],
  lockRefusalFor?: LockQuestion,
  /**
   * The position the verb these run moves by. A caller that runs them passes
   * its own, so an item is offered exactly when pressing it would move.
   */
  position?: MovePosition,
  /** The placement rule as the verb asks it, so a refused move is dimmed. */
  judge?: MoveJudge
): DepthMoveAction[] {
  if (selectedId === null || pathTo(document, selectedId).length === 0) {
    return [];
  }
  const ids = selectedIds ?? [selectedId];
  // A locked block, one inside the selected one or one it sits inside is the
  // single move's own question (`lockBlockingMove`), answered with its reason.
  return DEPTH_MOVES.map(move =>
    ids.length > 1
      ? { ...move, enabled: false, reason: oneAtATime(ids.length) }
      : {
          ...singleMove(
            document,
            selectedId,
            move.id,
            move.label,
            move.direction,
            lockRefusalFor,
            position,
            judge
          ),
          direction: move.direction,
        }
  );
}

/**
 * The Duplicate item for one selected block: refused, with the words the
 * Add panel's tile uses, where the block is or holds a template's one Entry
 * content block, since a copy would be a second.
 */
function duplicateAction(
  document: BlockDocument,
  selectedId: string,
  duplicable: boolean
): ToolbarAction {
  const reason = duplicationRefusal(document, selectedId);
  return reason === undefined
    ? { id: "duplicate", label: "Duplicate", enabled: duplicable }
    : { id: "duplicate", label: "Duplicate", enabled: false, reason };
}
