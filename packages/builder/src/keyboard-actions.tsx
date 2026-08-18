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

import { useShortcuts } from "@nextlyhq/ui";
import * as React from "react";

import { blockDeletion } from "./delete-block";
import type { EditorState } from "./editor-state";
import { blockLabel } from "./inserter";
import {
  keyboardMovePosition,
  type MoveDirection,
  type MoveEffect,
} from "./keyboard-move";
import { lockBlockingDelete, lockBlockingMove } from "./locking";

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
const MOVE_KEYS: ReadonlyArray<{
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
function deletionAnnouncement(type: string, descendants: number): string {
  // The block's own label, falling back to its type. An author who inserted
  // "Divider" from the palette should hear "Divider deleted", not
  // "core/divider deleted" — the identifier is what the registry calls it, and
  // the label is what they were shown. Resolved here rather than carried on the
  // deletion, because the deletion is a document fact and the wording is a
  // presentation one.
  const name = blockLabel(type);
  const what =
    descendants === 0
      ? `${name} deleted`
      : `${name} deleted, with ${descendants} ${descendants === 1 ? "block" : "blocks"} inside`;
  return `${what}. Undo with ${UNDO_KEYS_SPOKEN}.`;
}

/** How the undo shortcut is READ ALOUD, which is not how it is parsed. */
const UNDO_KEYS_SPOKEN = "Control or Command Z";

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
   * Whether the bindings are live. Defaults to true.
   *
   * A host that mounts the canvas inside something modal turns them off rather
   * than unmounting the canvas, so the selection survives whatever is over it.
   */
  enabled?: boolean;
}

/**
 * Register the move bindings for as long as the caller is mounted.
 *
 * Returns nothing: there is no state here worth exposing, and a hook that
 * returned handlers would invite a second caller to wire them to different keys
 * — which is how one gesture ends up with two answers.
 */
export function useBlockKeyboardActions({
  editor,
  enabled = true,
}: BlockKeyboardActionsOptions): string {
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
    const deletion = blockDeletion(editorNow.document, editorNow.selectedId);
    // `null` means there is nothing to delete — no selection, or an id the
    // document no longer holds after an undo. Nothing is applied and nothing is
    // said, because there is no event to report.
    if (deletion === null) return;

    /*
     * A lock is a POLICY refusal, so it is announced where a structural one is
     * not.
     *
     * The moves below stay silent when a block simply has nowhere to go — that
     * is a fact about the document an author can see, and saying it on every
     * press at the end of a list is noise. A lock is the opposite: nothing about
     * the page explains why the key did nothing, the remedy is one the author
     * can act on, and a keyboard user has no badge to look at.
     *
     * The subtree is checked, not just the node. Deleting a container destroys
     * what is inside it, so an author who locked a caption and then removed its
     * section would lose the thing they locked through an action aimed at
     * something else.
     */
    const blocked = lockBlockingDelete(editorNow.document, deletion.id);
    if (blocked !== undefined) {
      announce(
        blocked.id === deletion.id
          ? `${blockLabel(blocked.type)} is locked. Unlock it to delete it.`
          : `This block contains ${blockLabel(blocked.type)}, which is locked. Unlock it to delete.`
      );
      return;
    }

    const applied = editorNow.apply({
      kind: "remove",
      id: deletion.id,
      dropSlotIfEmpty: deletion.dropSlotIfEmpty,
    });
    if (applied === null) return;

    // Selection moved only after the store accepted the removal. Moving it
    // first would leave the author pointed at a neighbour while the block they
    // asked to delete is still there.
    editorNow.select(deletion.nextSelection);
    announce(deletionAnnouncement(deletion.type, deletion.descendantCount));
  }, [announce]);

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
        run: () => {
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
              `${blockLabel(lockedNode.type)} is locked. Unlock it to move it.`
            );
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

          const applied = editorNow.apply({
            kind: "move",
            id: selectedId,
            to: move.to,
            dropSlotIfEmpty: move.dropSlotIfEmpty,
          });
          // Announced only once the store has accepted it. A keyboard author
          // cannot see the result, and the store may refuse — announcing before
          // it answered would report a move that did not happen, which is worse
          // than silence because it cannot be told from one that did.
          //
          // Refusals stay silent, deliberately. "This block is already first"
          // on every press at the end of a list is noise an author cannot act
          // on, and the block not moving is itself the answer.
          if (applied !== null) announce(EFFECT_ANNOUNCEMENT[move.effect]);
          // The selection deliberately does NOT change. The block that moved is
          // the block still selected, so a second press continues moving the
          // same block — which is what makes a run of presses walk it across the
          // page rather than moving a different block each time.
        },
      })),
    [announce]
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
        keys: "Backspace",
        description: "Delete the selected block",
        when: () => latest.current.selectedId !== null,
        whenTyping: false,
        run: () => deleteSelected(),
      },
      {
        keys: "mod+z",
        description: "Undo the last change",
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
        when: () => latest.current.canRedo,
        run: () => {
          latest.current.redo();
          announce("Redone");
        },
      },
      {
        keys: "mod+y",
        description: "Redo the last undone change",
        when: () => latest.current.canRedo,
        run: () => {
          latest.current.redo();
          announce("Redone");
        },
      },
    ],
    [announce, deleteSelected]
  );

  useShortcuts([...bindings, ...editing], {
    name: "builder-block-actions",
    enabled,
  });

  return announcement;
}

/**
 * The bindings as a component, for mounting inside the shell.
 *
 * `BuilderShell` provides the shortcut context, so the hook cannot be called by
 * whatever RENDERS the shell — only by something inside it. A host would
 * otherwise have to invent a null-returning wrapper of its own, and every host
 * would invent a slightly different one.
 *
 * Renders nothing. It is a place to run a hook, which is the same shape the
 * command palette already uses for its modal key hold.
 */
export function BlockKeyboardActions({
  editor,
  enabled,
}: BlockKeyboardActionsOptions): React.JSX.Element {
  const announcement = useBlockKeyboardActions({ editor, enabled });

  // `polite`, not `assertive`: a move is the author's own action and its result
  // can wait for a pause. Assertive interrupts whatever is being read, which for
  // a run of presses means talking over itself.
  //
  // The region is present from the first render rather than appearing with its
  // first message. A live region added to the page at the same moment it gains
  // text is frequently not announced at all, because the assistive technology
  // has nothing it was already watching.
  return (
    <p aria-live="polite" role="status" className="nx-sr-only">
      {announcement}
    </p>
  );
}
