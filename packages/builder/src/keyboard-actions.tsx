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
 * This module is the hook and its provider, and the entry for the rest: the
 * keys and what each action says are in `keyboard-announcements.ts`, the
 * contexts the toolbar and menus read in `block-actions-context.ts`, and what
 * the hook takes and returns in `keyboard-actions-options.ts`.
 *
 * @module keyboard-actions
 */

import { registryNestingSource } from "@nextlyhq/blocks-engine";
import { useIsomorphicLayoutEffect, useShortcuts } from "@nextlyhq/ui";
import * as React from "react";

import {
  type BlockActions,
  BlockActionsContext,
  NestingContext,
  SelectionActionsContext,
  ToolbarFocusContext,
  type ToolbarFocusSlot,
} from "./block-actions-context";
import {
  CANVAS_ESCAPE_PRIORITY,
  escapeOutcome,
  modalIsOpen,
  pressOrigin,
  returnFocusToCanvas,
} from "./canvas/canvas-escape";
import { useCanvasFrame } from "./canvas/canvas-frame-context";
import {
  patternSaveRefusal,
  SAVE_PATTERN_GRANT_REFUSAL,
  toolbarActions,
  turnIntoChoice,
  type MoveJudge,
  type MovePosition,
} from "./canvas/toolbar-actions";
import type { EditorState } from "./editor-state";
import { lockViewOf } from "./inspector";
import { placedComponentId } from "./instance-inspector";
import {
  type BlockKeyboardActionsOptions,
  type BlockKeyboardActionsResult,
  type CanvasFrameSlot,
  type ComponentVerbId,
  componentVerbRunner,
  type SharedBlockVerbs,
} from "./keyboard-actions-options";
import {
  deletionAnnouncement,
  EFFECT_ANNOUNCEMENT,
  lockSentence,
  MOVE_KEYS,
  UNDO_KEYS_SPOKEN,
} from "./keyboard-announcements";
import { keyboardMovePosition, type MoveDirection } from "./keyboard-move";
import { lockedBlockWording, lockRefusalWording } from "./lock-refusal";
import { lockBlockingMove } from "./locking";
import {
  nestingRefusalForMove,
  refusalAnnouncement,
  unmovedAnnouncement,
} from "./move-refusal";
import { pathTo } from "./panels/layers/layers";
import { offerSignal, useSelectionOffer } from "./selection-offer";
import {
  isRefusal,
  selectionDeletion,
  selectionDuplication,
  selectionMove,
} from "./selection-ops";
import { blockActionRunners } from "./shell/builder-commands";

// The keys and what is announced, the contexts the toolbar and menus read,
// and what the hook takes and returns live in modules of their own beside
// it; every name this module exported still is.
// Part of this module's exported names; no importer in the package reads it.
// fallow-ignore-next-line unused-type
export type { ToolbarFocusSlot } from "./block-actions-context";
export {
  type BlockActions,
  useBlockActionsContext,
  useNestingSource,
  useSelectionActionsContext,
  useToolbarFocusSlot,
} from "./block-actions-context";
export type {
  BlockKeyboardActionsOptions,
  BlockKeyboardActionsResult,
  ComponentVerbsHost,
  SharedBlockVerbs,
  SharedStyleVerbHost,
} from "./keyboard-actions-options";
export { MOVE_KEYS } from "./keyboard-announcements";

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
  mayCreatePattern = true,
  editor,
  enabled = true,
  onEditText,
  nesting,
  definitions,
  onSaveAsPattern,
  onEditComponent,
  components,
  sharedStyles,
  onEscapeWithoutSelection,
  onAddBlockHere,
}: BlockKeyboardActionsOptions): BlockKeyboardActionsResult {
  // Read when the key lands, so a host's newest callback is the one called.
  const escapeWithoutSelection = React.useRef(onEscapeWithoutSelection);
  escapeWithoutSelection.current = onEscapeWithoutSelection;
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
  // The canvas's frame, read when Escape lands for the same reason: it is
  // where focus goes back to from a panel, and the frame is registered after
  // the bindings are. See `CanvasFrameSlot` for who fills it.
  const latestFrame: CanvasFrameSlot = React.useRef<HTMLIFrameElement | null>(
    null
  );
  const toolbarFocus: ToolbarFocusSlot = React.useRef<
    (() => HTMLElement | null) | null
  >(null);

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
    const locked = lockSentence(editorNow, plan.ops);
    if (locked !== null) {
      announce(locked);
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
     *
     * A slot's lock is another matter: a copy placed in a slot whose blocks
     * are fixed changes what that slot holds, so the slot's lock refuses it.
     */
    const locked = lockSentence(editorNow, plan.ops);
    if (locked !== null) {
      announce(locked);
      return;
    }
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
      const locked = lockSentence(editorNow, plan.ops);
      if (locked !== null) {
        announce(locked);
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

  /*
   * Where a block's move goes, with the component definitions this provider
   * was given. ONE function for the verb below and for the menu's Move in and
   * Move out availability, so the menu never offers a move the verb, asked
   * with other inputs, would find nowhere to make.
   */
  const movePosition = React.useCallback<MovePosition>(
    (document, id, direction) =>
      keyboardMovePosition(document.nodes, id, direction, definitions),
    [definitions]
  );

  /*
   * Whether the placement rule refuses a move, and its words: the one call
   * the verb below refuses by and the menu's Move in and Move out are dimmed
   * by, with the same rules and component definitions.
   */
  const placementRefusal = React.useCallback<MoveJudge>(
    (document, id, to) =>
      nestingRefusalForMove(document, id, to, nestingSource, definitions),
    [nestingSource, definitions]
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
        announce(
          refusalAnnouncement(lockedBlockWording(lockedNode, selectedId))
        );
        return;
      }

      // The component definitions go with it so an indent into a component
      // instance enters a slot the component exposes.
      const move = movePosition(editorNow.document, selectedId, direction);
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
      const refusal = placementRefusal(editorNow.document, selectedId, move.to);
      if (refusal !== null) {
        announce(refusalAnnouncement(refusal));
        return;
      }

      const op = {
        kind: "move" as const,
        id: selectedId,
        to: move.to,
        dropSlotIfEmpty: move.dropSlotIfEmpty,
      };
      // The locks' half, asked of the editor's own question so the sentence a
      // keyboard author hears is the one the pointer's notice shows.
      const lockBreak = editorNow.lockRefusalFor([op]);
      if (lockBreak !== undefined) {
        announce(refusalAnnouncement(lockRefusalWording(lockBreak)));
        return;
      }

      const applied = editorNow.apply(op);
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
      announce(unmovedAnnouncement(editorNow.document, selectedId));
      // The selection deliberately does NOT change. The block that moved is
      // the block still selected, so a second press continues moving the
      // same block — which is what makes a run of presses walk it across the
    },
    [announce, moveSet, movePosition, placementRefusal]
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
    const parent = parentOf(editorNow.document, editorNow.selectedId);
    if (parent === undefined) return;
    editorNow.select(parent);
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
        /*
         * `alt+F10`, the editor convention for reaching a block's toolbar
         * from the keyboard: from the canvas, or from text being edited inside
         * the block, which is why it also runs while typing.
         */
        keys: "alt+F10",
        description: "Move focus to the selected block's toolbar",
        // Only while a bar is drawn to take focus: a host may render the
        // keystrokes alone, and the bar goes while a block is dragged. The key
        // is then left to the browser rather than taken to do nothing.
        when: () =>
          latest.current.selectedId !== null &&
          (toolbarFocus.current?.() ?? null) !== null,
        whenTyping: true,
        run: () => toolbarFocus.current?.()?.focus(),
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
          // Said once the step has taken effect: a shared style change is
          // undone by a write, which can be refused.
          void Promise.resolve(latest.current.undo()).then(done => {
            if (done) announce("Undone");
          });
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
          void Promise.resolve(latest.current.redo()).then(done => {
            if (done) announce("Redone");
          });
        },
      },
      {
        keys: "mod+y",
        description: "Redo the last undone change",
        whenTyping: false,
        when: () => latest.current.canRedo,
        run: () => {
          void Promise.resolve(latest.current.redo()).then(done => {
            if (done) announce("Redone");
          });
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

  /*
   * "/" opens the host's in-place picker where the author is, the key Notion
   * and Gutenberg taught for adding a block. Registered only when the host
   * has a picker, so Help lists it only then.
   *
   * Not while typing: in a block's text or a field, "/" is a character. With
   * or without a selection, since nothing selected adds at the end of the
   * page. Read through a ref so the host's newest callback is the one run.
   */
  const addBlockHere = React.useRef(onAddBlockHere);
  addBlockHere.current = onAddBlockHere;
  const hasAddBlockHere = onAddBlockHere !== undefined;
  const adding = React.useMemo(
    () =>
      hasAddBlockHere
        ? [
            {
              keys: "/",
              description: "Add a block here",
              whenTyping: false,
              run: () => addBlockHere.current?.(),
            },
          ]
        : [],
    [hasAddBlockHere]
  );

  useShortcuts([...bindings, ...editing, ...inlineEditing, ...adding], {
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
        description:
          "Select the block holding this one, or clear the selection",
        // The one case the editor declines. `when` rather than a branch in
        // `run`, because declining has to leave the key UNCONSUMED for the
        // dialog to receive it, and a binding that runs has already taken it.
        // The modal test alone, which is the first thing `escapeOutcome`
        // asks: the rest of the rule needs the event, and `when` is not given
        // one.
        when: () =>
          !modalIsOpen(typeof document === "undefined" ? undefined : document),
        run: event => {
          const editorNow = latest.current;
          // Where the press began, from the keystroke itself: a layer that
          // closed on this same key has already moved focus by now.
          const outcome = escapeOutcome(
            typeof document === "undefined" ? undefined : document,
            { origin: pressOrigin(event), canvasFrame: latestFrame.current }
          );
          if (outcome === "return-to-canvas") {
            // The frame, where the page's own keys land: the selected block
            // is still outlined in it, and Delete, Alt+F10, Enter and Escape
            // act on it from there.
            const frame = latestFrame.current;
            if (frame !== null) returnFocusToCanvas(frame);
            return;
          }
          if (outcome !== "navigate-selection") return;
          if (editorNow.selectedId === null) {
            escapeWithoutSelection.current?.();
            return;
          }
          // Up a level: the block holding the selection, the same answer
          // "Select parent" gives, or nothing once the selection is at the top.
          editorNow.select(
            parentOf(editorNow.document, editorNow.selectedId) ?? null
          );
        },
      },
    ],
    {
      name: "builder-canvas-escape",
      enabled,
      priority: CANVAS_ESCAPE_PRIORITY,
    }
  );

  /*
   * The planner's verdict, honoured HERE rather than left to each surface.
   *
   * The toolbar keeps an unavailable verb focusable and still calls its runner,
   * deliberately, so the verb can announce its own refusal — that is how the
   * existing verbs behave, and a bare pass-through would instead open a form
   * and post a selection the planner has already rejected.
   *
   * Announced rather than merely refused, for the same reason: an author who
   * pressed a dimmed control is owed the reason, and the live region is where
   * every other refusal here is said.
   *
   * The host is asked only once the verdict is yes, so the form never opens
   * over a selection that cannot be saved.
   */
  const saveSelectionAsPattern = React.useCallback(() => {
    // The GRANT before the planner, matching the order the action list uses:
    // an author who may not save at all is owed that reason rather than a
    // critique of the blocks they chose. Checked HERE and not only there
    // because the toolbar keeps an unavailable verb focusable and still calls
    // this runner — so a refusal that lived only in the description would dim
    // the control and open the form anyway, for exactly the authors this
    // exists to stop.
    if (!mayCreatePattern) {
      announce(SAVE_PATTERN_GRANT_REFUSAL);
      return;
    }
    // The words the menu dims the verb with, Entry content's among them.
    const refusal = patternSaveRefusal(
      editor.document,
      editor.selection.ids,
      nestingSource
    );
    if (refusal !== undefined) {
      announce(refusal);
      return;
    }
    onSaveAsPattern();
  }, [
    mayCreatePattern,
    editor.document,
    editor.selection.ids,
    nestingSource,
    announce,
    onSaveAsPattern,
  ]);

  /*
   * The component verbs, refused in words before the host is asked: the
   * toolbar keeps a dimmed verb focusable, so a press of one still lands here.
   * The reason is the one the action list carries, so the two cannot differ.
   */
  const componentOffer = React.useMemo(
    () =>
      components === undefined
        ? undefined
        : {
            mayCreate: components.mayCreate,
            ...(components.definitions === undefined
              ? {}
              : { definitions: components.definitions }),
            ...(components.mayUpdatePattern === undefined
              ? {}
              : { mayUpdatePattern: components.mayUpdatePattern }),
          },
    [components]
  );
  const runComponentVerb = React.useCallback(
    (id: ComponentVerbId) => {
      if (components === undefined) return;
      const offered = toolbarActions(
        editor.document,
        editor.selectedId,
        editor.selection.ids,
        nestingSource,
        mayCreatePattern,
        editor.lockRefusalFor,
        componentOffer
      ).find(action => action.id === id);
      if (offered === undefined) return;
      if (!offered.enabled) {
        if (offered.reason !== undefined) announce(offered.reason);
        return;
      }
      componentVerbRunner(components, id, () =>
        turnIntoChoice(
          editor.document,
          editor.selection.ids,
          nestingSource,
          editor.lockRefusalFor
        )
      )?.();
    },
    [
      components,
      componentOffer,
      editor.document,
      editor.selectedId,
      editor.selection.ids,
      editor.lockRefusalFor,
      nestingSource,
      mayCreatePattern,
      announce,
    ]
  );

  /*
   * What the host knows of the site's shared styles, kept by its two values
   * so a host building a fresh object each render does not rebuild the list.
   */
  const sharedLibrary = sharedStyles?.library;
  const sharedMayChange = sharedStyles?.mayChange;
  const sharedOffer = React.useMemo(
    () =>
      sharedMayChange === undefined
        ? undefined
        : { library: sharedLibrary, mayChange: sharedMayChange },
    [sharedLibrary, sharedMayChange]
  );

  // What the lock view is read from, so the offer depends on them alone.
  const { composed, lockDefinitions } = editor;
  // With the editor's lock view, the source the save dialog judges by, so an
  // area locked to its content dims the verb here too.
  const sharedStyleOffer = React.useMemo(
    () =>
      sharedOffer === undefined
        ? undefined
        : { ...sharedOffer, view: lockViewOf({ composed, lockDefinitions }) },
    [sharedOffer, composed, lockDefinitions]
  );

  /*
   * The verb list, computed ONCE for every surface below, without asking the
   * locks; a menu asks them as it opens (`selection-offer`). See
   * {@link SelectionActionsContext}.
   */
  const offer = useSelectionOffer({
    document: editor.document,
    selectedId: editor.selectedId,
    selectedIds: editor.selection.ids,
    nesting: nestingSource,
    mayCreatePattern,
    lockRefusalFor: editor.lockRefusalFor,
    components: componentOffer,
    offersEditComponent: onEditComponent !== undefined,
    sharedStyles: sharedStyleOffer,
    movePosition,
    placementRefusal,
  });
  const selectionActions = offer.actions;
  /*
   * "Save as shared style…", refused in words before the host is asked, as
   * the component verbs are: a dimmed verb stays focusable in the toolbar.
   */
  const onSaveAsSharedStyle = sharedStyles?.onSaveAsSharedStyle;
  const saveAsSharedStyle = React.useCallback(() => {
    const offered = selectionActions.find(
      action => action.id === "save-as-shared-style"
    );
    if (offered === undefined) return;
    if (!offered.enabled) {
      if (offered.reason !== undefined) announce(offered.reason);
      return;
    }
    onSaveAsSharedStyle?.();
  }, [selectionActions, onSaveAsSharedStyle, announce]);
  const editSelectedComponent = useEditComponentVerb(editor, onEditComponent);

  const actions = React.useMemo<BlockActions>(
    () => ({
      move: moveSelected,
      delete: deleteSelected,
      duplicate: duplicateSelected,
      selectParent,
      saveAsPattern: saveSelectionAsPattern,
      editComponent: editSelectedComponent,
      turnIntoComponent: () => runComponentVerb("turn-into-component"),
      detachComponent: () => runComponentVerb("detach-component"),
      duplicateComponent: () => runComponentVerb("duplicate-component"),
      updatePattern: () => runComponentVerb("update-pattern"),
      saveAsSharedStyle,
    }),
    [
      saveAsSharedStyle,
      moveSelected,
      deleteSelected,
      duplicateSelected,
      selectParent,
      saveSelectionAsPattern,
      editSelectedComponent,
      runComponentVerb,
    ]
  );

  return {
    announcement,
    actions,
    nesting: nestingSource,
    offer,
    selectionActions: offer.actions,
    depthMoves: offer.depthMoves,
    toolbarFocus,
    canvasFrame: latestFrame,
  };
}

/**
 * Keeps an editor's canvas frame slot pointing at the frame the canvas has
 * registered, and draws nothing. Its own component so that the canvas
 * reporting a new zoom or size re-renders this and not the editor's bindings.
 */
function CanvasFrameReader({ into }: { into: CanvasFrameSlot }): null {
  const frame = useCanvasFrame().frame;
  useIsomorphicLayoutEffect(() => {
    into.current = frame;
    return () => {
      // Cleared with the frame, so a slot never points at a frame that has
      // left the page.
      if (into.current === frame) into.current = null;
    };
  }, [into, frame]);
  return null;
}

/**
 * The "Edit component" verb: hands the selected placement's component to the
 * host, or does nothing for any other selection, or where no host answers.
 */
function useEditComponentVerb(
  editor: EditorState,
  onEditComponent: BlockKeyboardActionsOptions["onEditComponent"]
): () => void {
  return React.useCallback(() => {
    if (onEditComponent === undefined) return;
    const ids = editor.selection.ids;
    if (ids.length !== 1) return;
    const nodeId = ids[0];
    if (nodeId === undefined) return;
    const componentId = placedComponentId(editor.document, nodeId);
    if (componentId !== undefined) onEditComponent(componentId, nodeId);
  }, [editor.document, editor.selection.ids, onEditComponent]);
}

/**
 * The block holding `id`, read from the same trail the breadcrumb draws, or
 * nothing for a top-level block or a selection the document no longer holds.
 * "Select parent" and Escape both ask this, so they cannot name two parents.
 */
function parentOf(
  document: EditorState["document"],
  id: string | null
): string | undefined {
  const path = pathTo(document, id);
  return path[path.length - 2]?.id;
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
  onShareVerbs,
  children,
  // Handed on whole, so an option the host left out stays out.
  ...options
}: BlockKeyboardActionsOptions & {
  readonly children?: React.ReactNode;
  /**
   * Called with the verbs whenever they change, and with `undefined` when this
   * provider goes, for a surface drawn outside it.
   */
  readonly onShareVerbs?: (verbs: SharedBlockVerbs | undefined) => void;
}): React.JSX.Element {
  const {
    announcement,
    actions,
    nesting: rules,
    offer,
    toolbarFocus,
    canvasFrame,
  } = useBlockKeyboardActions(options);

  /*
   * Shared from a layout effect, so a surface outside sees the verbs for the
   * selection it is drawing in the same frame.
   *
   * Shared again only when what is OFFERED changes — which verbs, whether each
   * may run, and why not — and never merely because a render made new
   * objects. A host keeps the shared value in its own state, so sharing on
   * every render re-renders the host, which re-renders this, which shares
   * again: an infinite update. `run` reads the latest verbs through a ref, so
   * a value shared earlier still runs what this render would, whatever the
   * verbs close over beside the editor (they already read the live editor).
   */
  const latestVerbs = React.useRef(actions);
  const latestOffer = React.useRef(offer);
  const [offerChanged] = React.useState(offerSignal);
  const sharedOffer = React.useRef<string | null>(null);
  useIsomorphicLayoutEffect(() => {
    latestVerbs.current = actions;
    latestOffer.current = offer;
    offerChanged.notify();
    if (onShareVerbs === undefined) return;
    const offered = offer.actions
      .map(each => `${each.id}:${each.enabled}:${each.reason ?? ""}`)
      .join("|");
    if (offered === sharedOffer.current) return;
    sharedOffer.current = offered;
    onShareVerbs({
      actions: offer.actions,
      // Through the ref, as `run`: a menu opened later asks of that moment.
      withLocks: () => latestOffer.current.withLocks().actions,
      subscribe: offerChanged.subscribe,
      run: id => blockActionRunners(latestVerbs.current)[id](),
    });
  }, [onShareVerbs, actions, offer, offerChanged]);
  useIsomorphicLayoutEffect(
    () => () => {
      sharedOffer.current = null;
      onShareVerbs?.(undefined);
    },
    [onShareVerbs]
  );

  // `polite`, not `assertive`: a move is the author's own action and its result
  // can wait for a pause. Assertive interrupts whatever is being read, which for
  // a run of presses means talking over itself.
  //
  // The region is present from the first render rather than appearing with its
  // first message. A live region added to the page at the same moment it gains
  // text is frequently not announced at all, because the assistive technology
  // has nothing it was already watching.
  return (
    <NestingContext.Provider value={rules}>
      <SelectionActionsContext.Provider value={offer}>
        <BlockActionsContext.Provider value={actions}>
          <ToolbarFocusContext.Provider value={toolbarFocus}>
            <CanvasFrameReader into={canvasFrame} />
            <p aria-live="polite" role="status" className="nx-sr-only">
              {announcement}
            </p>
            {children}
          </ToolbarFocusContext.Provider>
        </BlockActionsContext.Provider>
      </SelectionActionsContext.Provider>
    </NestingContext.Provider>
  );
}
