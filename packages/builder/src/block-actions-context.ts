"use client";

/**
 * The contexts `BlockKeyboardActions` provides and the hooks that read them:
 * the block actions the toolbar and menus run, the nesting rules to judge a
 * placement by, the selection's offer, and the toolbar's focus slot.
 *
 * Each context is exported with its type written out, as the package's
 * declaration build needs for an exported value; the values are unchanged.
 *
 * @module block-actions-context
 */

import {
  registryNestingSource,
  type BlockDocument,
  type NestingSource,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { MoveDirection } from "./keyboard-move";
import type { SelectionOffer } from "./selection-offer";
import type { TurnIntoOffer } from "./turn-into-verb";

/**
 * The structural verbs, as callables.
 *
 * Published so a POINTER surface can press exactly what a keystroke presses.
 * The floating toolbar offers the same five actions, and a toolbar that applied
 * its own ops would be a second answer to "what does duplicate do" — which an
 * author meets as two buttons that disagree, months after the second one was
 * written.
 *
 * Every one is silent when it has no subject, so a caller may press any of them
 * without first asking whether it applies. `toolbarActions` answers that
 * separately, for drawing a control as unavailable rather than for guarding the
 * call.
 */
export interface BlockActions {
  /** Move the selection one step in `direction`, lock permitting. */
  readonly move: (direction: MoveDirection) => void;
  /** Delete the selection and everything inside it, lock permitting. */
  readonly delete: () => void;
  /** Copy the selection in beside itself and select the copy. */
  readonly duplicate: () => void;
  /** Put the selection on the clipboard, to paste on this page or another. */
  readonly copy: () => void;
  /** Put the selection on the clipboard and remove it, lock permitting. */
  readonly cut: () => void;
  /** Paste copied blocks where a clicked block would land. */
  readonly paste: () => void;
  /**
   * Take the one selected block's look: its own values and the styles it
   * wears. Optional, so a host built before it keeps compiling.
   */
  readonly copyStyle?: () => void;
  /** Give every selected block the copied look, as one undo step. */
  readonly pasteStyle?: () => void;
  /** Select the container holding the selection. */
  readonly selectParent: () => void;
  /**
   * Begin storing the selection in the pattern library.
   *
   * Unlike the four above it this runs NO op: it hands the gesture back to the
   * host, which owns the library, the form that names what is saved and the
   * write that stores it. It travels with the others because every surface over
   * these verbs — toolbar, context menu, palette — must reach it the same way,
   * and a second channel for one verb is how one surface comes to offer what
   * another cannot run.
   *
   * No keystroke is bound to it here. The others are direct manipulations of a
   * selection an author is looking at; this opens a form, and a shortcut that
   * opens a modal belongs to the host's own key map rather than to the canvas.
   */
  readonly saveAsPattern: () => void;
  /**
   * Begin saving the block's look as a shared style, handed to the host as
   * the pattern save is. Absent where the host offers no shared styles.
   */
  readonly saveAsSharedStyle?: () => void;
  /**
   * Open the selected placement's component in its own view, through the
   * host. Like Save as pattern it runs no op: where the component opens, and
   * whether this author may, are the host's. Silent for any other selection.
   * Optional, so a host built before it keeps compiling.
   */
  readonly editComponent?: () => void;
  /**
   * Begin turning the selection into a component: replacing it with a
   * placement, or keeping it and saving a copy. Like `saveAsPattern`, this
   * hands the gesture to the host, which owns the form and the write. Absent
   * where the host offers no components.
   */
  readonly turnIntoComponent?: () => void;
  /** Detach the selected placement, duplicate its component, update a pattern. */
  readonly detachComponent?: () => void;
  readonly duplicateComponent?: () => void;
  readonly updatePattern?: () => void;
  /**
   * Turn the selected block into another type (`"core/heading"`), as one undo
   * step, saying what it removes or why it cannot. Optional, so a host built
   * before it keeps compiling.
   */
  readonly turnInto?: (to: string) => void;
  /**
   * "Turn into" for a block in a page the caller holds rather than the
   * selection: the format bar's, which writes the words typed first and turns
   * the block in the page that left. The same judging and words as
   * {@link turnInto}.
   */
  readonly turnIntoIn?: {
    readonly choices: (
      document: BlockDocument,
      id: string
    ) => readonly TurnIntoOffer[];
    readonly run: (document: BlockDocument, id: string, to: string) => void;
  };
}

/**
 * The verbs, for a surface rendered under {@link BlockKeyboardActions}.
 *
 * `null` until a provider is above it, which {@link useBlockActionsContext}
 * turns into a thrown error rather than a silently inert toolbar.
 */
export const BlockActionsContext: React.Context<BlockActions | null> =
  React.createContext<BlockActions | null>(null);

/**
 * The nesting rules the editor is judging placements by, for surfaces below it.
 *
 * A SECOND context rather than a field on {@link BlockActions}, because the two
 * are different kinds of thing: those are verbs to run, this is a rule source to
 * ask. Folding it in would make every consumer of the verbs re-render when a
 * host swapped its rules, and would put a non-verb in a type whose name promises
 * verbs.
 *
 * `null` means no provider, which {@link useNestingSource} answers with the
 * registry — the same default every surface here already applies.
 */
export const NestingContext: React.Context<NestingSource | null> =
  React.createContext<NestingSource | null>(null);

/**
 * The verbs for the current selection, computed once for every surface.
 *
 * The bar, the right-click menu and the palette each need the same list, and
 * `toolbarActions` is not a cheap read: deciding whether a selection can be
 * saved BUILDS the document a save would store — it clones the selected forest,
 * re-identifies it and surveys the result — because that is what makes the
 * answer exact. Asked three times, an ordinary edit copies and walks a large
 * selection three times before anything is drawn.
 *
 * Published from here because this is the one place above all three that
 * already holds the editor and the rules they must agree about.
 */
export const SelectionActionsContext: React.Context<SelectionOffer | null> =
  React.createContext<SelectionOffer | null>(null);

export function useSelectionActionsContext(): SelectionOffer | null {
  return React.useContext(SelectionActionsContext);
}

export const ToolbarFocusContext: React.Context<ToolbarFocusSlot | null> =
  React.createContext<ToolbarFocusSlot | null>(null);

/**
 * The nearest provider's toolbar focus slot, or `null` outside one: the
 * block toolbar puts its focus call here for Alt+F10.
 */
export function useToolbarFocusSlot(): ToolbarFocusSlot | null {
  return React.useContext(ToolbarFocusContext);
}

/**
 * The verbs from the nearest {@link BlockKeyboardActions}.
 *
 * Throws when there is none. A toolbar without them would render its buttons
 * and do nothing on every press, which looks like a broken editor rather than
 * like a missing wrapper — and it would reach a person before it reached a
 * developer.
 */
export function useBlockActionsContext(): BlockActions {
  const actions = React.useContext(BlockActionsContext);
  if (actions === null) {
    throw new Error(
      "[@nextlyhq/builder] Block actions are only available inside " +
        "<BlockKeyboardActions>. Render it as an ancestor of whatever uses them."
    );
  }
  return actions;
}

/**
 * The nesting rules to judge a placement by, from the nearest provider.
 *
 * Falls back to the registry, which is what the canvas, the insert panel and the
 * keyboard route all default to — so a surface outside a provider answers the
 * way it did before this existed.
 *
 * It exists because a host MAY supply its own rules, and until this a surface
 * had no way to reach them: `BlockKeyboardActions` took a `nesting` option and
 * kept it, so the keyboard enforced the host's rules while the toolbar and the
 * context menu consulted the registry. One selection could then be offered on
 * one surface and refused on another, for the same document.
 */
export function useNestingSource(): NestingSource {
  const supplied = React.useContext(NestingContext);
  // Memoised on the supplied value so a surface that depends on the identity —
  // `toolbarActions` is called inside a memo keyed on its arguments — is not
  // handed a new object every render.
  return React.useMemo(() => supplied ?? registryNestingSource(), [supplied]);
}

/**
 * Holds the call that finds an editor's block toolbar's tab stop, which
 * answers `null` while no bar is drawn.
 */
export type ToolbarFocusSlot = React.MutableRefObject<
  (() => HTMLElement | null) | null
>;
