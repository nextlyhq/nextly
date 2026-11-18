// @vitest-environment jsdom
/**
 * The editor's Escape in a settings field being edited: it puts back the value
 * from before the edit, and does nothing else with that press. The selection
 * stays, and nothing is applied, so nothing is recorded.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";
import { useStoredDraft } from "./stored-draft";

afterEach(cleanup);

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "acme/text", version: 1, props: {} }],
} as BlockDocument;

function editorOn(selectedId: string): EditorState {
  return {
    document: page,
    selectedId,
    selection: { ids: [selectedId], primary: selectedId },
    select: vi.fn(),
    apply: vi.fn(() => page),
    applyAll: vi.fn(() => page),
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState;
}

/** A settings field holding its draft, as the inspector's text fields do. */
function Field(): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft("Before");
  return (
    <input
      aria-label="Text"
      value={draft}
      onChange={event => setDraft(event.target.value)}
    />
  );
}

function escapeIn(element: Element): void {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

describe("Escape in a settings field being edited", () => {
  it("puts back the value from before the edit, and keeps the block selected", () => {
    const editor = editorOn("a");
    render(
      <ShortcutProvider>
        <BlockKeyboardActions
          editor={editor}
          onSaveAsPattern={() => undefined}
        />
        <Field />
      </ShortcutProvider>
    );
    const field = screen.getByLabelText<HTMLInputElement>("Text");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "Half typed" } });

    escapeIn(field);

    expect(field.value).toBe("Before");
    expect(editor.select).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.applyAll).not.toHaveBeenCalled();
  });
});
