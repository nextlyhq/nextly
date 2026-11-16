/**
 * What the selection's verbs offer, decided in two steps: what every surface
 * shows as the selection changes, and what the locks say once an author opens
 * a menu.
 *
 * Whether a slot's lock allows a verb is answered by trying the verb's edit
 * on a copy of the page, so asking it for every verb on every selection made
 * a click on a long page wait on a dozen trial edits nobody had asked for.
 * The toolbar and the keyboard layer draw from the first list, which asks
 * the locks nothing; a Layers lock, an edge or a missing grant still dims a
 * verb there, because those are read off the page directly. A menu that opens
 * reads the second list, which asks the locks about the verbs it holds. The
 * verbs whose availability is a full plan (saving as a pattern, and the
 * component verbs, which build the document they would store) are planned in
 * that second list too, so a click plans nothing. A pressed verb asks and
 * plans for itself, as it always has, so a lock or a plan still refuses it
 * with its reason. The editor keeps each lock answer for the version of the
 * page it was asked of (`kept-lock-answers`), so a menu, a second menu and a
 * keystroke share one trial per verb.
 *
 * @module selection-offer
 */

import type { BlockDocument, NestingSource } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { EditorState } from "./editor-state";
import type { SharedStyleOffer } from "./shared-style-target";
import {
  depthMoveActions,
  toolbarActions,
  type ComponentVerbsOffer,
  type DepthMoveAction,
  type MoveJudge,
  type MovePosition,
  type ToolbarAction,
} from "./toolbar-actions";

/** The selection's verbs, and the depth moves the block menu adds. */
export interface SelectionVerbs {
  readonly actions: ToolbarAction[];
  readonly depthMoves: readonly DepthMoveAction[];
}

/** What a provider publishes for the surfaces below it. */
export interface SelectionOffer extends SelectionVerbs {
  /**
   * The same verbs with the locks asked, for a menu that is opening: worked
   * out on the first call for this selection and page, and read back after.
   */
  readonly withLocks: () => SelectionVerbs;
}

/** What the verbs are decided from. */
export interface SelectionOfferInputs {
  readonly document: BlockDocument;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  readonly nesting: NestingSource;
  readonly mayCreatePattern: boolean;
  readonly lockRefusalFor: EditorState["lockRefusalFor"];
  readonly components: ComponentVerbsOffer | undefined;
  readonly offersEditComponent: boolean;
  readonly sharedStyles: SharedStyleOffer | undefined;
  readonly movePosition: MovePosition;
  readonly placementRefusal: MoveJudge;
}

/**
 * The verbs, with the locks asked and the planned verbs planned when `asked`,
 * or from the cheap rules alone when not.
 */
function selectionVerbs(
  inputs: SelectionOfferInputs,
  asked: boolean
): SelectionVerbs {
  const ask = asked ? inputs.lockRefusalFor : undefined;
  return {
    actions: toolbarActions(
      inputs.document,
      inputs.selectedId,
      inputs.selectedIds,
      inputs.nesting,
      inputs.mayCreatePattern,
      ask,
      inputs.components,
      inputs.offersEditComponent,
      inputs.sharedStyles,
      asked
    ),
    depthMoves: depthMoveActions(
      inputs.document,
      inputs.selectedId,
      inputs.selectedIds,
      ask,
      inputs.movePosition,
      inputs.placementRefusal
    ),
  };
}

/**
 * The offer for the current selection, rebuilt only when one of its inputs
 * changes. The locks are asked on the first `withLocks` call for those
 * inputs, never while the selection merely changes.
 */
export function useSelectionOffer(
  inputs: SelectionOfferInputs
): SelectionOffer {
  const {
    document,
    selectedId,
    selectedIds,
    nesting,
    mayCreatePattern,
    lockRefusalFor,
    components,
    offersEditComponent,
    sharedStyles,
    movePosition,
    placementRefusal,
  } = inputs;
  return React.useMemo(() => {
    const read: SelectionOfferInputs = {
      document,
      selectedId,
      selectedIds,
      nesting,
      mayCreatePattern,
      lockRefusalFor,
      components,
      offersEditComponent,
      sharedStyles,
      movePosition,
      placementRefusal,
    };
    let locked: SelectionVerbs | undefined;
    return {
      ...selectionVerbs(read, false),
      withLocks: () => (locked ??= selectionVerbs(read, true)),
    };
  }, [
    document,
    selectedId,
    selectedIds,
    nesting,
    mayCreatePattern,
    lockRefusalFor,
    components,
    offersEditComponent,
    sharedStyles,
    movePosition,
    placementRefusal,
  ]);
}

/** No verbs, held as one value so an empty answer keeps its identity. */
const NO_VERBS: readonly ToolbarAction[] = [];

/**
 * The shared verbs with the locks asked, for a menu drawn outside the
 * provider (the Layers row menu, the block card's menu) while it is open.
 *
 * Read when the menu opens, and read again once the page has settled: a menu
 * opened on a block that was not selected selects it as it opens, and the
 * provider takes in the new selection after this menu has first drawn, so
 * the first reading can be the previous block's. Each offer answers with the
 * same list each time, so a reading that has not changed draws nothing more.
 */
export function useAskedSharedVerbs(
  withLocks: (() => readonly ToolbarAction[]) | undefined
): readonly ToolbarAction[] {
  const [asked, setAsked] = React.useState(() => withLocks?.() ?? NO_VERBS);
  React.useEffect(() => {
    const now = withLocks?.() ?? NO_VERBS;
    if (now !== asked) setAsked(now);
  });
  return asked;
}
