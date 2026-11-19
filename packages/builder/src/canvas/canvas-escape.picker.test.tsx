// @vitest-environment jsdom

/**
 * Escape from the inspector, with the real colour picker, keyboard bindings
 * and canvas frame mounted together.
 *
 * Picking a colour variable closes the picker and hands focus back to the
 * field's button. An author who then presses Escape is leaving the inspector,
 * not asking for the block's parent: the editor sends focus back to the canvas
 * and keeps the selection, and only a press that starts on the canvas moves
 * it. These cases drive that through the components an author uses, because
 * the parts are each correct alone and the defect was in how they met: the
 * picker had closed, focus sat in the panel, and the canvas's rule read that
 * as "nothing open, go up".
 *
 * Each case asserts the property that tells the rule apart from a plausible
 * wrong one: where focus went (an editor that merely ignored the key would
 * also keep the selection), whether the page's own Escape ran (one that let
 * the key through would too), and what the NEXT press does (one that swallowed
 * every Escape would pass the first half).
 *
 * @module canvas-escape.picker.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { ShortcutProvider, useShortcuts } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CANVAS_KEYBOARD_FOCUS_ATTRIBUTE } from "./canvas-escape";
import {
  CanvasFrameProvider,
  CanvasFrameShortcuts,
} from "./canvas-frame-context";
import type { EditorState } from "../editor-state";
import { BlockKeyboardActions } from "../keyboard-actions";
import { StyleInspectorPanel } from "../inspector/style-inspector/style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
  ],
};

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: { color: { text: true } },
        render: () => null,
      },
    ] as never,
    { source: "canvas-escape-picker-test" }
  );
}

/**
 * A block inside a container, so "up a level" has a parent to go to and
 * selecting it is observably different from clearing the selection.
 */
const NESTED = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "section",
      type: "acme/section",
      version: 1,
      props: {},
      slots: {
        children: [{ id: "inner", type: "acme/box", version: 1, props: {} }],
      },
    },
  ],
} as unknown as BlockDocument;

function editorOf(
  selectedId: string | null,
  select: (id: string | null) => void
): EditorState {
  return {
    document: NESTED,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    select,
    apply: () => NESTED,
    applyAll: () => NESTED,
    undo: () => Promise.resolve(true),
    redo: () => Promise.resolve(true),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
}

/**
 * The page's own Escape, at the host's precedence: the entry form's "cancel
 * and go back". It must never run while the editor is on screen.
 */
function HostCancel({ run }: { run: () => void }): null {
  useShortcuts([{ keys: "Escape", description: "Cancel", run }], {
    name: "test-entry-form",
  });
  return null;
}

/**
 * The editor as a host assembles it: a selection held in state, the canvas
 * frame and its shortcut listener, the block bindings, and the inspector.
 */
function Editor({
  frame,
  hostCancel,
}: {
  frame: HTMLIFrameElement;
  hostCancel: () => void;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string | null>("inner");
  const editor = React.useMemo(
    () => editorOf(selectedId, setSelectedId),
    [selectedId]
  );
  return (
    <ShortcutProvider>
      <HostCancel run={hostCancel} />
      <CanvasFrameProvider frame={frame}>
        <CanvasFrameShortcuts />
        <BlockKeyboardActions editor={editor} onSaveAsPattern={() => undefined}>
          <output data-testid="selected">{selectedId ?? "none"}</output>
          <StyleInspectorPanel editor={editor} tokens={TOKENS} />
        </BlockKeyboardActions>
      </CanvasFrameProvider>
    </ShortcutProvider>
  );
}

function mount(): { frame: HTMLIFrameElement; hostCancel: () => void } {
  register();
  // The canvas's frame, in the editor's document as the shell places it. Its
  // own document is where a key pressed on the canvas is delivered.
  const frame = document.createElement("iframe");
  frame.title = "Page canvas";
  document.body.append(frame);
  const hostCancel = vi.fn();
  render(<Editor frame={frame} hostCancel={hostCancel} />);
  return { frame, hostCancel };
}

const selected = (): string | null =>
  screen.getByTestId("selected").textContent;

const trigger = (): HTMLElement =>
  screen.getByRole("button", { name: /^Colour for Colour/ });

const variables = (): HTMLElement | null =>
  screen.queryByRole("listbox", { name: "Colour variables" });

/**
 * Press Escape where a real keystroke starts: on the element holding focus,
 * in whichever document holds it. The canvas rule reads where the press began
 * from the event, so dispatching on the document instead would test a press
 * that started nowhere.
 */
function pressEscape(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** The element a keystroke would start on now: the canvas's own if focus is in it. */
function focusedTarget(frame: HTMLIFrameElement): Element {
  const active = document.activeElement;
  if (active === frame) {
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("the canvas frame has no document");
    return inner.activeElement ?? inner.body;
  }
  if (active === null) throw new Error("nothing holds focus");
  return active;
}

describe("Escape after picking a colour variable", () => {
  it("keeps the block selected and returns focus to the canvas", async () => {
    const { frame, hostCancel } = mount();
    fireEvent.click(trigger());
    const list = variables();
    if (list === null) throw new Error("the picker did not open");
    fireEvent.click(within(list).getByRole("option", { name: "Brand" }));
    // The pick closes the picker, and focus goes back to the field's button:
    // the state the author is in when they press Escape.
    await waitFor(() => expect(variables()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger()));

    const event = pressEscape(trigger());

    expect(selected()).toBe("inner");
    expect(document.activeElement).toBe(frame);
    // Shown, not only moved: the frame carries the mark its outline is drawn
    // from.
    expect(frame.hasAttribute(CANVAS_KEYBOARD_FOCUS_ATTRIBUTE)).toBe(true);
    // Consumed, so the entry form's cancel behind the editor never ran.
    expect(event.defaultPrevented).toBe(true);
    expect(hostCancel).not.toHaveBeenCalled();
  });

  it("goes up a level on the second Escape, which starts on the canvas", async () => {
    const { frame, hostCancel } = mount();
    fireEvent.click(trigger());
    const list = variables();
    if (list === null) throw new Error("the picker did not open");
    fireEvent.click(within(list).getByRole("option", { name: "Brand" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    pressEscape(trigger());
    expect(document.activeElement).toBe(frame);

    pressEscape(focusedTarget(frame));

    expect(selected()).toBe("section");
    expect(hostCancel).not.toHaveBeenCalled();
  });
});

describe("Escape with the colour picker open", () => {
  it("closes the picker only: the block stays selected and focus returns to its button", async () => {
    const { frame, hostCancel } = mount();
    fireEvent.click(trigger());
    const list = variables();
    if (list === null) throw new Error("the picker did not open");
    list.focus();

    pressEscape(list);

    await waitFor(() => expect(variables()).toBeNull());
    expect(selected()).toBe("inner");
    // The picker's own close hands focus back to its button. Sending it on to
    // the canvas as well would answer one press twice.
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    expect(document.activeElement).not.toBe(frame);
    expect(hostCancel).not.toHaveBeenCalled();
  });
});

describe("Escape in a floating list that closes without marking the key handled", () => {
  it("is read from where the press started, after the list has moved focus away", () => {
    /*
     * The picker above marks Escape handled, so the shortcut manager stops
     * before the editor's binding runs and that case never reaches the rule.
     * This list does not: it closes on the keystroke, ahead of the editor,
     * and hands focus to a button in the panel. A rule reading focus when the
     * binding runs would see that button and send focus on to the canvas — a
     * second answer to one press. Read from the event, the press started in
     * the list, which owns it.
     */
    const { frame, hostCancel } = mount();
    const layer = document.createElement("div");
    layer.setAttribute("data-radix-popper-content-wrapper", "");
    const list = document.createElement("ul");
    list.setAttribute("role", "listbox");
    list.tabIndex = 0;
    layer.append(list);
    const panelButton = document.createElement("button");
    panelButton.textContent = "Back in the panel";
    document.body.append(layer, panelButton);
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !layer.isConnected) return;
      layer.remove();
      panelButton.focus();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    try {
      list.focus();

      const event = pressEscape(list);

      expect(layer.isConnected).toBe(false);
      expect(document.activeElement).toBe(panelButton);
      expect(document.activeElement).not.toBe(frame);
      expect(selected()).toBe("inner");
      // Still consumed: the page's cancel never runs while the editor is up.
      expect(event.defaultPrevented).toBe(true);
      expect(hostCancel).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", closeOnEscape, true);
      panelButton.remove();
    }
  });
});

describe("Escape typed in an inspector text field", () => {
  it("never moves the selection, and focus stays in the field", () => {
    const { hostCancel } = mount();
    const field = screen.getByRole("textbox", { name: "Colour" });
    field.focus();

    const event = pressEscape(field);

    expect(selected()).toBe("inner");
    expect(document.activeElement).toBe(field);
    expect(event.defaultPrevented).toBe(true);
    expect(hostCancel).not.toHaveBeenCalled();
  });
});
