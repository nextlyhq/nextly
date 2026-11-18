// @vitest-environment jsdom

/**
 * While a header or footer is selected, the block keys have nothing to act
 * on: Delete and Backspace remove nothing and say why, in the host's words,
 * and the moves and Duplicate stay quiet.
 *
 * @module keyboard-actions.region.test
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";

afterEach(cleanup);

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "a", type: "acme/text", version: 1, props: {} },
    { id: "b", type: "acme/text", version: 1, props: {} },
  ],
} as BlockDocument;

const REFUSAL =
  "The site header isn't part of this page. Change it in Page settings.";

type Spy = EditorState & {
  apply: ReturnType<typeof vi.fn>;
  applyAll: ReturnType<typeof vi.fn>;
};

/** An editor with no block selected, as one is while a region is. */
function editorOn(selectedId: string | null): Spy {
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
  } as unknown as Spy;
}

function mount(
  editor: EditorState,
  selectedRegion?: { readonly refusal: string }
): void {
  render(
    <ShortcutProvider>
      <BlockKeyboardActions
        editor={editor}
        onSaveAsPattern={() => undefined}
        {...(selectedRegion === undefined ? {} : { selectedRegion })}
      />
    </ShortcutProvider>
  );
}

/** A key pressed where the shortcut manager hears it. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    window.document.dispatchEvent(event);
  });
  return event;
}

const said = () => screen.getByRole("status").textContent ?? "";

describe("the block keys while a header or footer is selected", () => {
  it("removes nothing on Delete or Backspace, and says why in the host's words", () => {
    const editor = editorOn(null);
    mount(editor, { refusal: REFUSAL });
    expect(press("Delete").defaultPrevented).toBe(true);
    expect(said().replace(/​$/, "")).toBe(REFUSAL);
    press("Backspace");
    // Said again for the second press, as a new message.
    expect(said().replace(/​$/, "")).toBe(REFUSAL);
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.applyAll).not.toHaveBeenCalled();
  });

  it("moves and duplicates nothing, leaving those keys to the browser", () => {
    const editor = editorOn(null);
    mount(editor, { refusal: REFUSAL });
    expect(press("ArrowDown", { altKey: true }).defaultPrevented).toBe(false);
    expect(press("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(said()).toBe("");
  });

  it("CONTROL: with no region selected, Delete with nothing selected is left alone and says nothing", () => {
    const editor = editorOn(null);
    mount(editor);
    expect(press("Delete").defaultPrevented).toBe(false);
    expect(said()).toBe("");
  });

  it("CONTROL: a selected block is still deleted, whatever the host says of regions", () => {
    const editor = editorOn("a");
    mount(editor, { refusal: REFUSAL });
    press("Delete");
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(said()).not.toContain("site header");
  });
});
