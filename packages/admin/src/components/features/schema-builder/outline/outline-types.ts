/**
 * What the outline asks of the page, and what a row's menu can do: one set of
 * field actions, which both extend, so the two cannot name the same action
 * differently.
 */
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type {
  MoveDestination,
  MoveVerdict,
} from "@admin/lib/builder/move-rule";
import type { MoveStep } from "@admin/lib/builder/outline/move-targets";

import type { BuilderField } from "../types";

/** The changes a person can ask for on one field. */
interface OutlineFieldActions {
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  openFieldGroup: (slug: string) => void;
}

/** What the outline asks of the page. */
export interface OutlineCallbacks extends OutlineFieldActions {
  select: (id: string) => void;
  /** Open the picker for a new field at `position`. */
  addAt: (position: FieldInsertPosition) => void;
  /** The fields as the Builder holds them now: what a move is told from. */
  fields: readonly BuilderField[];
  /** The move rule's answer for a field going to `target`; nothing changes. */
  judgeMove: (id: string, target: FieldInsertPosition) => MoveVerdict;
  /** Every container a field could go into, with the rule's answer for each. */
  moveDestinations: (id: string) => MoveDestination[];
  /** Keep the fields an allowed move answered with, as one undoable change. */
  commitMove: (fields: BuilderField[]) => void;
}

/** What a row's menu can do. One object for every row, so rows stay memoized. */
export interface OutlineActions extends OutlineFieldActions {
  setMenuOpen: (id: string | null) => void;
  /** Put focus back on a row, after its menu closes. */
  focusRow: (id: string) => void;
  select: (id: string) => void;
  addInside: (id: string) => void;
  addAfter: (id: string) => void;
  /** Whether a step is a move the rule allows. */
  canMove: (id: string, step: MoveStep) => boolean;
  /** Take a step, or say why it is refused; announced either way. */
  move: (id: string, step: MoveStep) => void;
  /** Open Move to… for a row. */
  openMoveTo: (id: string) => void;
  /** Every container a field could go into, as Move to… lists them. */
  moveDestinations: (id: string) => MoveDestination[];
  /** The rule's answer for a field going to `target`, as Move to… shows it. */
  judgeMoveTo: (id: string, target: FieldInsertPosition) => MoveVerdict;
  /** Move a field to `target` if the rule allows, announced either way. */
  moveTo: (id: string, target: FieldInsertPosition) => MoveVerdict;
  /** The rule's answer for a drop, or null where a drop changes nothing. */
  judgeDrop: (
    activeId: string,
    overId: string,
    levels: number
  ) => MoveVerdict | null;
  /** Carry a drop out if the rule allows, announced either way. */
  drop: (activeId: string, overId: string, levels: number) => void;
}
