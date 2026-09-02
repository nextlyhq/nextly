"use client";

/**
 * Moving the selected block with the keyboard.
 *
 * **This is not a convenience over dragging; it is the accessible way to do the
 * same job.** WCAG 2.2 adds SC 2.5.7 *Dragging Movements* (AA), which requires
 * any function operated by a drag to be achievable without one, and SC 2.1.1
 * *Keyboard* (A) requires it to be operable from a keyboard at all. A canvas
 * that can only reorder by pointer fails both. Building this first means the
 * drag path arrives as an enhancement over a working baseline rather than as
 * the only way in.
 *
 * **The rule lives in `keyboard-move`; this is the wiring.** That module decides
 * where a block lands, what the move means, and which slot it may vacate. Every
 * decision worth asserting is already made there, without React and without a
 * DOM. What is only true here is which keys ask for it, when they are allowed
 * to, and that the answer reaches the one place a document changes.
 *
 * @module keyboard-actions
 */

import { findNode, registryNestingSource } from "@nextlyhq/blocks-engine";
import type { NestingSource } from "@nextlyhq/blocks-engine";
import { useShortcuts } from "@nextlyhq/ui";
import * as React from "react";

import { CANVAS_ESCAPE_PRIORITY, escapeOutcome } from "./canvas-escape";
import type { EditorState } from "./editor-state";
import {
  keyboardMovePosition,
  type MoveDirection,
  type MoveEffect,
} from "./keyboard-move";
import { layerLabel, pathTo } from "./layers";
import { lockBlockingMove } from "./locking";
import { nestingRefusalForMove, refusalAnnouncement } from "./move-refusal";
import {
  isRefusal,
  selectionDeletion,
  selectionDuplication,
  selectionMove,
} from "./selection-ops";

/**
 * The bindings, and why these keys.
 *
 * `alt+ArrowUp`/`alt+ArrowDown` is the line-move gesture from VS Code and the
 * editors that copied it, so it arrives already known rather than needing to be
 * taught. `alt+ArrowLeft`/`alt+ArrowRight` follows the indent convention every
 * outliner and list editor shares, and it matches the axis the rule itself
 * names — `indent` and `outdent` are its own words for the effect.
 *
 * Deliberately NOT Gutenberg's `mod+shift+alt+T`/`Y`. A four-key chord for the
 * commonest structural edit in the editor is undiscoverable and awkward on a
 * laptop, and the two letters carry no relationship to the direction they move.
 */
export const MOVE_KEYS: ReadonlyArray<{
  keys: string;
  direction: MoveDirection;
  description: string;
}> = [
  {
    keys: "alt+ArrowUp",
    direction: "up",
    description: "Move the selected block up",
  },
  {
    keys: "alt+ArrowDown",
    direction: "down",
    description: "Move the selected block down",
  },
  {
    keys: "alt+ArrowRight",
    direction: "indent",
    description: "Move the selected block into the container above it",
  },
  {
    keys: "alt+ArrowLeft",
    direction: "outdent",
    description: "Move the selected block out of its container",
  },
];

/**
 * What each effect is announced as.
 *
 * Derived from the effect the rule already decided rather than inferred here
 * from the direction pressed. `alt+ArrowLeft` is `outdent` only when there is a
 * container to leave, and re-deriving it from the keystroke would announce a
 * move out of a group that never happened.
 *
 * Three sentences rather than one, because the three are not the same event to
 * someone who cannot see the result: reordering keeps a block among its
 * siblings, while indenting and outdenting change which block CONTAINS it.
 */
const EFFECT_ANNOUNCEMENT: Readonly<Record<MoveEffect, string>> = {
  reorder: "Block moved",
  indent: "Block moved into the container above it",
  outdent: "Block moved out of its container",
};

/**
 * How a deletion is announced.
 *
 * Names what went AND how to get it back. A screen-reader user cannot see an
 * undo control, so for them the announcement is the only place the recovery
 * path exists — and a container takes its children with it, which is invisible
 * from the block they had selected: a collapsed section looks exactly like an
 * empty one.
 *
 * The count is stated rather than prompted for. A confirmation on every delete
 * is friction people learn to click through, so it stops being a decision and
 * becomes a keystroke — protecting nobody while costing everybody. That trade
 * only holds because undo is reachable, which is why these ship together.
 */
/**
 * @param name - what to CALL the block, already resolved by the caller.
 *
 * A resolved name rather than a type, so the one rule that decides what a block
 * is called lives in `layerLabel` and this only phrases it. Taking a type and
 * resolving here would put a second resolution in the one surface a
 * screen-reader user hears — and it would have to reach for `blockLabel`, which
 * knows nothing about the name the author gave this instance.
 */
function deletionAnnouncement(name: string, descendants: number): string {
  const what =
    descendants === 0
      ? `${name} deleted`
      : `${name} deleted, with ${descendants} ${descendants === 1 ? "block" : "blocks"} inside`;
  return `${what}. Undo with ${UNDO_KEYS_SPOKEN}.`;
}

/** How the undo shortcut is READ ALOUD, which is not how it is parsed. */
const UNDO_KEYS_SPOKEN = "Control or Command Z";

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
  /** Select the container holding the selection. */
  readonly selectParent: () => void;
}

/**
 * The verbs, for a surface rendered under {@link BlockKeyboardActions}.
 *
 * `null` until a provider is above it, which {@link useBlockActionsContext}
 * turns into a thrown error rather than a silently inert toolbar.
 */
const BlockActionsContext = React.createContext<BlockActions | null>(null);

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
}

/** What the hook hands back: the region's text, and the verbs behind the keys. */
export interface BlockKeyboardActionsResult {
  /** The live region's current text. Owned by one region and one only. */
  readonly announcement: string;
  /** The same verbs the keystrokes run, for a pointer surface to press. */
  readonly actions: BlockActions;
}

/**
 * Register the move bindings for as long as the caller is mounted.
 *
 * The verbs come back as well as the announcement, and the reason is the one
 * this hook's earlier note argued against: a returned handler could be bound to
 * a second set of keys. What settles it is that the alternative is worse. The
 * toolbar needs the same five verbs AND the same live region, and a surface
 * that reimplemented either would produce two answers to one gesture — a second
 * region that talks over the first, or a button whose op drifts from its
 * keystroke's. Sharing them is what keeps there being one of each.
 *
 * The keys stay this module's alone: nothing here is bindable by a caller, and
 * {@link BlockKeyboardActions} is the only supported way to reach the verbs.
 */
export function useBlockKeyboardActions({
  editor,
  enabled = true,
  onEditText,
  nesting,
}: BlockKeyboardActionsOptions): BlockKeyboardActionsResult {
  /*
   * The same rule source the pointer route asks, defaulted the way the insert
   * panel defaults it. Taken as an option rather than resolved here only so a
   * test can supply one; a host passing nothing gets the registry, which is
   * what the canvas passes too — two surfaces asking one source, so a refusal
   * cannot be explained one way on a drag and another on a keypress.
   */
  const nestingSource = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );
  // The message a live region reads out. Held as state rather than written to
  // the DOM directly so React owns the node — a region mutated behind React's
  // back is reverted by the next render, silently and only sometimes.
  const [announcement, setAnnouncement] = React.useState("");

  // A move can repeat the previous effect — two presses of alt+ArrowDown are
  // both "Block moved" — and a live region does not re-announce text that did
  // not change. The zero-width space alternates the string so each press is a
  // new value, without changing what is read aloud.
  const announce = React.useCallback((message: string) => {
    setAnnouncement(previous =>
      previous.replace(/\u200b$/, "") === message ? `${message}\u200b` : message
    );
  }, []);

  // The newest editor, reachable from a binding registered once. The shortcut
  // layer is deliberately not rebuilt when its bindings change — rebuilding
  // moves the layer to the top of its depth and silently changes precedence —
  // so a closure captured at registration would go on applying moves against
  // the document from that render.
  const latest = React.useRef(editor);
  latest.current = editor;

  const deleteSelected = React.useCallback(() => {
    const editorNow = latest.current;
    const plan = selectionDeletion(editorNow.document, editorNow.selection.ids);
    // `null` means there is nothing to delete — no selection, or ids an undo
    // has since removed. Nothing is applied and nothing is said, because there
    // is no event to report.
    if (plan === null) return;

    /*
     * A lock is a POLICY refusal, so it is announced where a structural one is
     * not. Nothing about the page explains why the key did nothing, the remedy
     * is one the author can act on, and a keyboard user has no badge to look
     * at. ONE lock refuses the whole group, because the group is atomic and
     * there is no half-done delete to fall back to.
     */
    if (isRefusal(plan)) {
      announce(plan.reason);
      return;
    }

    if (editorNow.applyAll(plan.ops) === null) return;

    // Moved only after the store accepted the removal. Moving it first would
    // leave the author pointed at a neighbour while the blocks they asked to
    // delete are still there.
    editorNow.select(plan.nextSelection);
    announce(deletionAnnouncement(plan.subject, plan.descendants));
  }, [announce]);

  const duplicateSelected = React.useCallback(() => {
    const editorNow = latest.current;
    const plan = selectionDuplication(
      editorNow.document,
      editorNow.selection.ids
    );
    // `null` means there is nothing to duplicate, or a position the op
    // vocabulary cannot express. Nothing is applied and nothing is said.
    if (plan === null) return;

    /*
     * A lock does NOT stop a duplication. The command layer must not let an
     * author move or delete a locked node, and duplicating does neither — the
     * originals stay exactly where they are. Refusing would mean an author
     * could not take copies of the blocks they had most deliberately protected.
     */
    if (editorNow.applyAll(plan.ops) === null) return;

    /*
     * Selection follows the copies: they are what the author is now working on,
     * and leaving the originals selected would send the next edit to the wrong
     * half of two identical runs.
     *
     * Built through the same grammar a click uses — one replace then toggles —
     * rather than by writing a selection object directly, so there is no second
     * way to construct one and no second place that has to remember the
     * outermost rule.
     */
    const [first, ...rest] = plan.newIds;
    if (first !== undefined) {
      editorNow.select(first, "replace");
      for (const id of rest) editorNow.select(id, "toggle");
    }
    announce(`${plan.subject} duplicated. Undo with ${UNDO_KEYS_SPOKEN}.`);
  }, [announce]);

  /**
   * Reordering a selection that holds more than one block.
   *
   * Only `up` and `down`. Depth is the other axis, and a set does not have one
   * answer for it: `indent` appends to the container above, so two blocks
   * indenting together would arrive in an order neither of them was in.
   *
   * Returns whether it handled the press, so the single-block path below stays
   * exactly as it was for the case it already served.
   */
  const moveSet = React.useCallback(
    (direction: MoveDirection): boolean => {
      const editorNow = latest.current;
      const ids = editorNow.selection.ids;
      if (ids.length <= 1 || (direction !== "up" && direction !== "down")) {
        return false;
      }

      const plan = selectionMove(editorNow.document, ids, direction);
      // A set at the edge of its container, exactly as one block there: the
      // press did nothing and that is the answer. Handled either way, because
      // falling through would move the PRIMARY alone and break the set apart.
      if (plan === null) return true;

      /*
       * A lock and a split selection are both POLICY refusals, so both are
       * announced where a structural one is not. Nothing on the page explains
       * why the key did nothing, and a keyboard author has no dimmed button to
       * look at.
       */
      if (isRefusal(plan)) {
        announce(plan.reason);
        return true;
      }

      if (editorNow.applyAll(plan.ops) !== null) {
        announce(`${plan.subject} moved.`);
      }
      // The selection deliberately does not change, for the same reason it does
      // not for one block: a run of presses walks the same set across the list.
      return true;
    },
    [announce]
  );

  const moveSelected = React.useCallback(
    (direction: MoveDirection) => {
      if (moveSet(direction)) return;

      const editorNow = latest.current;
      const selectedId = editorNow.selectedId;
      if (selectedId === null) return;

      // Only the node itself, never its subtree: moving a container leaves
      // a locked child in the same slot at the same index, so the lock is
      // not violated and refusing would let one locked caption freeze the
      // whole section around it.
      const lockedNode = lockBlockingMove(editorNow.document, selectedId);
      if (lockedNode !== undefined) {
        announce(`${layerLabel(lockedNode)} is locked. Unlock it to move it.`);
        return;
      }

      const move = keyboardMovePosition(
        editorNow.document.nodes,
        selectedId,
        direction
      );
      // `null` is an ordinary answer: the first block cannot move up, and a
      // top-level block cannot outdent. Refusing quietly is right — a block
      // at the end of its container has nowhere to go, and saying so would
      // be an error message for pressing a key that did nothing.
      if (move === null) return;

      /*
       * Asked BEFORE the move, because the op store does not consult the
       * nesting rule — `ops.ts` holds no reference to it — so a placement the
       * rule forbids is applied rather than refused.
       *
       * This is the keyboard route's half of the decision `drop-targets` makes
       * for the pointer, of the same function, so the two surfaces cannot
       * disagree about where a block may go. A keyboard author who could not
       * be refused here would build documents a pointer author cannot.
       */
      const refusal = nestingRefusalForMove(
        editorNow.document,
        selectedId,
        move.to,
        nestingSource
      );
      if (refusal !== null) {
        announce(refusalAnnouncement(refusal));
        return;
      }

      const applied = editorNow.apply({
        kind: "move",
        id: selectedId,
        to: move.to,
        dropSlotIfEmpty: move.dropSlotIfEmpty,
      });
      // Announced only once the store has accepted it. A keyboard author
      // cannot see the result, and announcing before it answered would report
      // a move that did not happen, which is worse than silence because it
      // cannot be told from one that did.
      if (applied !== null) {
        announce(EFFECT_ANNOUNCEMENT[move.effect]);
        return;
      }
      /*
       * The store refused something the nesting rule permits — a byte cap, a
       * depth limit, an op the forest rejects. The sentence names no cause,
       * because none was established: naming a nesting one here would send an
       * author to change a container that was never the problem.
       *
       * Still spoken rather than silent. `move === null` above is a boundary
       * with nowhere to go and is correctly quiet; reaching HERE means a move
       * was attempted and did not happen, which a keyboard author cannot see.
       */
      const moved = findNode(editorNow.document.nodes, selectedId);
      const subject = moved === undefined ? "The block" : layerLabel(moved);
      announce(`${subject} could not be moved.`);
      // The selection deliberately does NOT change. The block that moved is
      // the block still selected, so a second press continues moving the
      // same block — which is what makes a run of presses walk it across the
    },
    [announce, moveSet, nestingSource]
  );

  /**
   * Select the container holding the selection.
   *
   * Reads the same trail the breadcrumb draws, so "the parent" cannot mean one
   * block here and another there. Silent when there is no container: a
   * top-level block has none, and saying so on every press would be an error
   * message for a control that is already disabled.
   */
  const selectParent = React.useCallback(() => {
    const editorNow = latest.current;
    const path = pathTo(editorNow.document, editorNow.selectedId);
    const parent = path[path.length - 2];
    if (parent === undefined) return;
    editorNow.select(parent.id);
  }, []);

  const bindings = React.useMemo(
    () =>
      MOVE_KEYS.map(({ keys, direction, description }) => ({
        keys,
        description,
        // Checked at press time rather than by toggling `enabled`: with nothing
        // selected the keystroke has no subject, and passing it on lets the
        // browser do whatever it would have done — which on a text field is
        // move the caret by word.
        when: () => latest.current.selectedId !== null,
        // Not while typing. Alt carries a non-shift modifier, so the manager
        // would otherwise fire these inside a field, where alt+Arrow is
        // word-wise caret movement on every platform that has it. An author
        // editing a heading must be able to move the caret through it.
        whenTyping: false,
        run: () => moveSelected(direction),
      })),
    [moveSelected]
  );

  const editing = React.useMemo(
    () => [
      {
        // Both keys. Delete is the explicit one; Backspace is what most people
        // reach for, and binding only one leaves half the authors pressing a
        // key that does nothing.
        keys: "Delete",
        description: "Delete the selected block",
        when: () => latest.current.selectedId !== null,
        // Not while typing, and for a sharper reason than the moves: alt+Arrow
        // in a field is caret movement, but Backspace is the most destructive
        // key a text field has. A binding that fired there would eat the
        // author's characters instead of their block.
        whenTyping: false,
        run: () => deleteSelected(),
      },
      {
        /*
         * `mod+d`, which is what a duplicating editor binds nearly everywhere —
         * Figma, Sketch and every canvas tool an author is likely to arrive
         * from. The browser's own `mod+d` bookmarks the page, and taking it is
         * the deliberate trade: inside a full-screen editor a bookmark is not
         * what the keystroke means, and the shortcut manager prevents the
         * default so the dialog does not appear over the canvas.
         */
        keys: "mod+d",
        description: "Duplicate the selected block",
        when: () => latest.current.selectedId !== null,
        // Not while typing. `mod+d` in a text field is a browser action rather
        // than an editing one, but an author mid-sentence is not asking for a
        // block, and the manager cannot tell the two apart without this.
        whenTyping: false,
        run: () => duplicateSelected(),
      },
      {
        keys: "Backspace",
        description: "Delete the selected block",
        when: () => latest.current.selectedId !== null,
        whenTyping: false,
        run: () => deleteSelected(),
      },
      {
        keys: "mod+z",
        description: "Undo the last change",
        // Not while the caret is in a block's text.
        //
        // `whenTyping` defaults to TRUE for any binding opening on a modifier,
        // and `preventDefault` to true with it — so without this the canvas
        // SWALLOWS the author's undo mid-sentence and rewinds the DOCUMENT
        // instead. They lose a block move they had finished with and keep the
        // words they wanted back: both halves wrong at once.
        //
        // Declining leaves the keystroke to the element, which is what an
        // uncontrolled `contentEditable` wants — inline editing hands the DOM
        // over for the duration precisely so the browser's own history serves
        // the caret. The document's history resumes owning `mod+z` the moment
        // the edit commits, which is also when there is a document change worth
        // undoing.
        whenTyping: false,
        // No selection required: undo acts on the document's history, not on
        // whatever happens to be selected — and the commonest thing to undo is
        // a deletion, which leaves a different block selected than the one the
        // edit touched.
        when: () => latest.current.canUndo,
        run: () => {
          latest.current.undo();
          announce("Undone");
        },
      },
      {
        // Both spellings: `mod+shift+z` is the convention on macOS and in most
        // editors, `mod+y` is the Windows one. Neither is wrong and authors
        // arrive with whichever they learned.
        keys: "mod+shift+z",
        description: "Redo the last undone change",
        // Same reason as `mod+z` above: a redo taken from the caret rewinds the
        // wrong history. `mod+shift+z` opens on a modifier too, so it inherits
        // the same firing default and needs the same refusal.
        whenTyping: false,
        when: () => latest.current.canRedo,
        run: () => {
          latest.current.redo();
          announce("Redone");
        },
      },
      {
        keys: "mod+y",
        description: "Redo the last undone change",
        whenTyping: false,
        when: () => latest.current.canRedo,
        run: () => {
          latest.current.redo();
          announce("Redone");
        },
      },
    ],
    [announce, deleteSelected, duplicateSelected]
  );

  /*
   * Enter opens the selected block's text for typing, which is the keyboard
   * route to what a double-click does on the canvas.
   *
   * Registered only when a host supplied the verb: a binding that presses and
   * does nothing is worse than no binding, because it teaches an author the key
   * is broken rather than absent.
   *
   * `whenTyping: false` is what stops it firing again once the caret is in.
   * The shortcut manager counts a `contentEditable` element as a typing target,
   * so an author pressing Enter inside a paragraph gets a line break from the
   * element rather than a second attempt to begin an edit that is already open.
   */
  const inlineEditing = React.useMemo(
    () =>
      onEditText === undefined
        ? []
        : [
            {
              keys: "Enter",
              description: "Edit the selected block's text",
              when: () => latest.current.selectedId !== null,
              whenTyping: false,
              run: () => {
                const id = latest.current.selectedId;
                if (id !== null) onEditText(id);
              },
            },
          ],
    [onEditText]
  );

  useShortcuts([...bindings, ...editing, ...inlineEditing], {
    name: "builder-block-actions",
    enabled,
  });

  /*
   * Escape, claimed for the editor and registered as its OWN layer.
   *
   * Separate from the block actions above because it needs a precedence they
   * must not have. The host page binds Escape to "cancel and go back", and both
   * sets are in one stack — so without a claim here the form's binding took the
   * key and navigated away from the entry, discarding every uncommitted block
   * edit. Raising the whole block-actions layer instead would put Delete and
   * `mod+d` above the command palette's modal hold, so a keystroke aimed at the
   * palette would edit the canvas behind it.
   *
   * `whenTyping` is left at its default, which is TRUE for Escape. That is not
   * incidental: standing down inside a field would drop the key straight back
   * to the form's cancel, and the inspector is full of fields. What focus in a
   * field changes is what the key DOES, never who consumes it — see
   * `canvas-escape`.
   */
  useShortcuts(
    [
      {
        keys: "Escape",
        description: "Clear the block selection",
        // The one case the editor declines. `when` rather than a branch in
        // `run`, because declining has to leave the key UNCONSUMED for the
        // dialog to receive it, and a binding that runs has already taken it.
        when: () =>
          escapeOutcome(
            typeof document === "undefined" ? undefined : document
          ) !== "defer-to-modal",
        run: () => {
          const editorNow = latest.current;
          const outcome = escapeOutcome(
            typeof document === "undefined" ? undefined : document
          );
          if (outcome !== "deselect") return;
          if (editorNow.selectedId === null) return;
          editorNow.select(null);
        },
      },
    ],
    {
      name: "builder-canvas-escape",
      enabled,
      priority: CANVAS_ESCAPE_PRIORITY,
    }
  );

  const actions = React.useMemo<BlockActions>(
    () => ({
      move: moveSelected,
      delete: deleteSelected,
      duplicate: duplicateSelected,
      selectParent,
    }),
    [moveSelected, deleteSelected, duplicateSelected, selectParent]
  );

  return { announcement, actions };
}

/**
 * The bindings as a component, for mounting inside the shell.
 *
 * `BuilderShell` provides the shortcut context, so the hook cannot be called by
 * whatever RENDERS the shell — only by something inside it. A host would
 * otherwise have to invent a null-returning wrapper of its own, and every host
 * would invent a slightly different one.
 *
 * Renders the live region, and publishes the verbs to whatever it wraps. Both
 * belong to the same mount deliberately: a toolbar reachable without the region
 * could act without announcing, and a keyboard author would meet a button that
 * changes the page and says nothing.
 *
 * `children` is optional. A host that wants only the keystrokes passes none and
 * gets exactly what this rendered before.
 */
export function BlockKeyboardActions({
  editor,
  enabled,
  onEditText,
  nesting,
  children,
}: BlockKeyboardActionsOptions & {
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const { announcement, actions } = useBlockKeyboardActions({
    editor,
    enabled,
    ...(onEditText === undefined ? {} : { onEditText }),
    ...(nesting === undefined ? {} : { nesting }),
  });

  // `polite`, not `assertive`: a move is the author's own action and its result
  // can wait for a pause. Assertive interrupts whatever is being read, which for
  // a run of presses means talking over itself.
  //
  // The region is present from the first render rather than appearing with its
  // first message. A live region added to the page at the same moment it gains
  // text is frequently not announced at all, because the assistive technology
  // has nothing it was already watching.
  return (
    <BlockActionsContext.Provider value={actions}>
      <p aria-live="polite" role="status" className="nx-sr-only">
        {announcement}
      </p>
      {children}
    </BlockActionsContext.Provider>
  );
}
