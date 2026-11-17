/**
 * What `useBlockKeyboardActions` takes and returns: the verbs shared with the
 * toolbar, the host's shared-style and component verbs, the options, the
 * result, and the slot the canvas frame is read into.
 *
 * @module keyboard-actions-options
 */

import type { ComponentLookup, NestingSource } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { BlockActions, ToolbarFocusSlot } from "./block-actions-context";
import type { BlockClipboardVerbs } from "./block-clipboard-verbs";
import type {
  ComponentVerbsOffer,
  ToolbarAction,
  ToolbarActionId,
  TurnIntoChoice,
} from "./canvas/toolbar-actions";
import type { EditorState } from "./editor-state";
import type { OfferSignal, SelectionOffer } from "./selection-offer";
import type { SharedStyleOffer } from "./shared-style-target";

/**
 * The verbs for the current selection, as a surface OUTSIDE the provider is
 * handed them: which are offered and why not, and a way to run one.
 *
 * The inspector is drawn beside the canvas rather than under this provider,
 * and its card offers Duplicate and Delete. Handing it these is what keeps
 * that menu to the toolbar's verdicts and verbs rather than a second copy.
 */
export interface SharedBlockVerbs {
  /** What to show while no menu is open: the locks are not asked. */
  readonly actions: readonly ToolbarAction[];
  /** The same verbs with the locks asked, for a menu as it opens. */
  readonly withLocks: () => readonly ToolbarAction[];
  /** Listen for a change to what `withLocks` would answer; optional. */
  readonly subscribe?: OfferSignal["subscribe"];
  readonly run: (id: ToolbarActionId) => void;
}

export interface BlockKeyboardActionsOptions {
  /**
   * The editor whose document these move blocks in.
   *
   * The whole state rather than a document and an `apply` separately: the move
   * is computed against a document and applied through a store, and passing
   * them apart lets a caller hand a document from one render to an `apply`
   * bound to another.
   */
  editor: EditorState;
  /**
   * The nesting rule source, for explaining a refused move.
   *
   * Optional, defaulting to the registry — which is what the canvas asks, so a
   * refusal reads the same whether the author dragged the block or moved it
   * with the keyboard. Present as an option only so a test can supply a rule
   * set without registering blocks globally.
   */
  nesting?: NestingSource;
  /**
   * The component definitions the canvas draws, for judging a moved instance.
   *
   * An instance node's own type is not a registered block, so the nesting
   * rule restricts it nowhere; a move is judged by the ROOTS of the definition
   * it draws instead, resolved through this map as a drop of the same instance
   * is (`placementTypesOf`). Optional, because a host whose library has not
   * loaded has nothing to resolve against — an unresolvable instance is judged
   * by its own type, which is how a placeholder stays movable.
   */
  definitions?: ComponentLookup;
  /**
   * Begin storing the selection in the library, when the author asks to.
   *
   * Supplied by the host because everything the gesture needs is the host's:
   * which collection a pattern goes in, what it is called, and the route that
   * writes it. Nothing here can do any of that, and a builder that guessed would
   * be guessing about somebody else's schema.
   */
  onSaveAsPattern: () => void;
  /**
   * Whether the author may create a pattern at all. Defaults to true.
   *
   * Supplied by the host for the same reason `onSaveAsPattern` is: the grant is
   * held against the collection a pattern goes in, a site may have renamed it,
   * and nothing here can know either. A builder that guessed would be guessing
   * about somebody else's schema.
   *
   * Permissive while unknown — see `toolbarActions`, which explains why this one
   * refusal defaults the opposite way to the rest.
   */
  mayCreatePattern?: boolean;
  /**
   * Open a placed component in its own view, given its id and the
   * placement's node id. Supplied by the host, which knows where that view is
   * and whether this author may update components; omitted, "Edit component"
   * is not offered anywhere.
   */
  onEditComponent?: (componentId: string, nodeId: string) => void;
  /**
   * Whether the bindings are live. Defaults to true.
   *
   * A host that mounts the canvas inside something modal turns them off rather
   * than unmounting the canvas, so the selection survives whatever is over it.
   */
  enabled?: boolean;
  /**
   * Begin typing the selected block's text in place, reporting whether it
   * could be.
   *
   * The keyboard route to the gesture a double-click performs. A pointer-only
   * way into editing would leave the text of every block unreachable without a
   * mouse, which is the plainest kind of WCAG 2.1.1 failure — and it is a real
   * one here, because the canvas is where the text is.
   *
   * Optional: a host that has not wired inline editing registers no binding at
   * all, rather than one that presses and does nothing.
   */
  onEditText?: (nodeId: string) => boolean;
  /**
   * Making components from a selection, where the host has a component
   * library: whether the author may, and the gestures that open the host's
   * forms. Absent, neither verb is offered.
   */
  components?: ComponentVerbsHost;
  /**
   * Saving a block's look as a shared style, where the host has the site's
   * shared styles: what it knows of them and the author's right, and the
   * gesture that opens its form. Absent, the verb is not offered.
   */
  sharedStyles?: SharedStyleVerbHost;
  /**
   * Esc pressed with no block selected, which otherwise does nothing: a host
   * editing a look on its own leaves it, back to editing blocks.
   *
   * @experimental Settles with the Design panel's Block looks group.
   */
  onEscapeWithoutSelection?: () => void;
  /**
   * "/" pressed with a block selected, or with nothing selected, while no
   * text is being typed: the host opens its in-place picker there, adding
   * by the placement rule. Absent, "/" is left to the browser and Help does
   * not list it.
   *
   * @experimental Settles with the in-place picker.
   */
  onAddBlockHere?: () => void;
}

/**
 * The host's side of "Save as shared style…".
 *
 * @experimental Settles with the shared-styles editor.
 */
export interface SharedStyleVerbHost extends SharedStyleOffer {
  readonly onSaveAsSharedStyle: () => void;
}

/**
 * The host's side of "Turn into component…".
 *
 * @experimental Settles when the composition API ships.
 */
export interface ComponentVerbsHost extends ComponentVerbsOffer {
  /**
   * Open the form, told which way is open: replacing the selection with a
   * placement, keeping it and saving a copy, or both, with the reason for a
   * way that is not.
   */
  readonly onTurnIntoComponent: (choice: TurnIntoChoice) => void;
  /** Detach the selected placement. Absent, with no definitions, Detach is not offered. */
  readonly onDetachComponent?: () => void;
  readonly onDuplicateComponent?: () => void;
  /** Update a pattern. Absent, with no `mayUpdatePattern`, it is not offered. */
  readonly onUpdatePattern?: () => void;
}

/** The verbs the host runs for the menu's component group. */
export type ComponentVerbId =
  | "turn-into-component"
  | "detach-component"
  | "duplicate-component"
  | "update-pattern";

/** The host's gesture for one component verb, if it offers it. */
export function componentVerbRunner(
  host: ComponentVerbsHost,
  id: ComponentVerbId,
  /** Which way "Turn into component…" may go, asked when it was pressed. */
  choice: () => TurnIntoChoice
): (() => void) | undefined {
  const runners: Record<ComponentVerbId, (() => void) | undefined> = {
    "turn-into-component": () => host.onTurnIntoComponent(choice()),
    "detach-component": host.onDetachComponent,
    "duplicate-component": host.onDuplicateComponent,
    "update-pattern": host.onUpdatePattern,
  };
  return runners[id];
}

/** What the hook hands back: the region's text, and the verbs behind the keys. */
export interface BlockKeyboardActionsResult {
  /** The live region's current text. Owned by one region and one only. */
  readonly announcement: string;
  /** The same verbs the keystrokes run, for a pointer surface to press. */
  readonly actions: BlockActions;
  /**
   * The rules this resolved placements by: the host's, or the registry.
   *
   * Returned so the provider can publish the SAME source it enforced, rather
   * than every surface below resolving the default again and a host-supplied
   * one reaching only the keyboard.
   */
  readonly nesting: NestingSource;
  /**
   * What to OFFER for the current selection, computed once for every surface.
   *
   * Told apart from {@link BlockKeyboardActionsResult.actions} by the question
   * each answers: those are verbs to RUN, this is the list of what may be run
   * and why not. Returned so the provider publishes the same list it built
   * rather than each surface rebuilding it — and rebuilding it is not cheap,
   * because deciding whether a selection can be saved builds the document a
   * save would store. Its depth moves are judged with the position function
   * the move verb itself runs; its locks are asked only by a menu that opens.
   */
  readonly offer: SelectionOffer;
  /** `offer.actions`, as this result has always carried it. */
  readonly selectionActions: ToolbarAction[];
  /** `offer.depthMoves`, as this result has always carried it. */
  readonly depthMoves: SelectionOffer["depthMoves"];
  /**
   * Where this editor's block toolbar puts the call that finds its tab stop,
   * for Alt+F10 to focus. Held per editor rather than looked up in the
   * document, which may hold another editor's toolbar first.
   */
  readonly toolbarFocus: ToolbarFocusSlot;
  /**
   * Where the canvas's frame is put for Escape to send focus back to, filled
   * by {@link BlockKeyboardActions}. Empty, Escape moves the selection from
   * wherever it is pressed.
   */
  readonly canvasFrame: CanvasFrameSlot;
  /**
   * Copy, Cut and Paste, for the clipboard events {@link BlockKeyboardActions}
   * listens for: the same verbs the menus run, writing to the event in hand.
   */
  readonly clipboard: BlockClipboardVerbs;
}

/**
 * Holds the canvas's frame, or `null` while there is none.
 *
 * A slot rather than a context read inside the hook: the canvas frame's
 * context changes with every zoom and resize the canvas reports, and the
 * Escape binding needs only the frame, when the key lands. Filled by a child
 * of its own, so a resize re-renders that child alone.
 */
export type CanvasFrameSlot = React.MutableRefObject<HTMLIFrameElement | null>;
