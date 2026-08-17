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
 * @module keyboard-moves
 */

import { useShortcuts } from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import { keyboardMovePosition, type MoveDirection } from "./keyboard-move";

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

export interface BlockKeyboardMovesOptions {
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
export function useBlockKeyboardMoves({
  editor,
  enabled = true,
}: BlockKeyboardMovesOptions): void {
  // The newest editor, reachable from a binding registered once. The shortcut
  // layer is deliberately not rebuilt when its bindings change — rebuilding
  // moves the layer to the top of its depth and silently changes precedence —
  // so a closure captured at registration would go on applying moves against
  // the document from that render.
  const latest = React.useRef(editor);
  latest.current = editor;

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

          editorNow.apply({
            kind: "move",
            id: selectedId,
            to: move.to,
            dropSlotIfEmpty: move.dropSlotIfEmpty,
          });
          // The selection deliberately does NOT change. The block that moved is
          // the block still selected, so a second press continues moving the
          // same block — which is what makes a run of presses walk it across the
          // page rather than moving a different block each time.
        },
      })),
    []
  );

  useShortcuts(bindings, { name: "builder-block-moves", enabled });
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
export function BlockKeyboardMoves({
  editor,
  enabled,
}: BlockKeyboardMovesOptions): null {
  useBlockKeyboardMoves({ editor, enabled });
  return null;
}
