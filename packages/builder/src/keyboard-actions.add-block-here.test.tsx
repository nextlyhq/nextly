// @vitest-environment jsdom

/**
 * "/" opens the host's in-place picker: with a block selected, and with
 * nothing selected, but never while text is being typed, where "/" is a
 * character. Without a picker the key is left alone.
 *
 * @module keyboard-actions.add-block-here.test
 */
import { act, cleanup, render } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";

afterEach(cleanup);

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "acme/text", version: 1, props: {} }],
} as BlockDocument;

function editorOn(selectedId: string | null): EditorState {
  return {
    document: page,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    select: vi.fn(),
    apply: vi.fn(() => page),
    applyAll: vi.fn(() => page),
    undo: vi.fn(() => Promise.resolve(true)),
    redo: vi.fn(() => Promise.resolve(true)),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState;
}

function mount(editor: EditorState, onAddBlockHere?: () => void): void {
  render(
    <ShortcutProvider>
      <BlockKeyboardActions
        editor={editor}
        onSaveAsPattern={() => undefined}
        {...(onAddBlockHere === undefined ? {} : { onAddBlockHere })}
      />
    </ShortcutProvider>
  );
}

/** "/" pressed where the shortcut manager hears it, from `target`. */
function slash(target: EventTarget = window.document): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "/",
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('"/"', () => {
  it("opens the picker with a block selected, and takes the key", () => {
    const open = vi.fn();
    mount(editorOn("a"), open);
    const event = slash();
    expect(open).toHaveBeenCalledTimes(1);
    // Taken, so the "/" is not typed into the search the picker focuses.
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens the picker with nothing selected", () => {
    const open = vi.fn();
    mount(editorOn(null), open);
    slash();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("is a character while text is being typed", () => {
    const open = vi.fn();
    mount(editorOn("a"), open);
    // A field here; a block's own text in the browser test, since jsdom
    // has no editable content to type into.
    const text = window.document.createElement("input");
    window.document.body.append(text);
    try {
      text.focus();
      const event = slash(text);
      expect(open).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally {
      text.remove();
    }
  });

  it("is left to the browser where the host has no picker", () => {
    mount(editorOn("a"));
    expect(slash().defaultPrevented).toBe(false);
  });
});
