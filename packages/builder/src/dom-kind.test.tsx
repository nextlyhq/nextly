// @vitest-environment jsdom

/**
 * Node kinds asked the same way in every realm, and every check that asks them.
 *
 * The canvas is headed for a same-origin iframe, and a node built by that
 * frame's document carries the frame window's constructors. Each case below
 * builds its node in a SECOND realm — the `contentDocument` of an iframe jsdom
 * gives its own window — and asserts the check still recognises it. The
 * control in each is the same node failing the ambient `instanceof`, which is
 * what proves the fixture really crossed a realm: a node from this document
 * would pass the old checks and the new alike, and certify nothing.
 *
 * @module dom-kind.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { clearBlocks, hasBlock, registerBlocks } from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { ShortcutProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockToolbar } from "./block-toolbar";
import {
  CANVAS_ROOT_CLASS,
  CHROME_ATTRIBUTE,
  Canvas,
  contextMenuTargetOf,
  DropRefusal,
  nodeIdFromEvent,
} from "./canvas";
import type { CanvasDragState } from "./canvas-drag";
import { escapeOutcome, isTextEntry } from "./canvas-escape";
import { CommandPalette } from "./command-palette";
import {
  deepActiveElement,
  isElement,
  isHTMLElement,
  isInput,
  isTextArea,
} from "./dom-kind";
import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";
import { commitsFor, supersedes } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/**
 * A document belonging to another realm: an iframe's, attached so it has a
 * window and so focus inside it is reported to this document the way a browser
 * reports it.
 */
function otherRealm(): { frame: HTMLIFrameElement; doc: Document } {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (doc === null) throw new Error("the iframe has no document");
  return { frame, doc };
}

/**
 * Identity, asserted as a boolean. A failing `toBe` tries to print both sides,
 * and the printer cannot describe a node from another realm — so the report
 * would be a crash in the printer rather than the comparison that failed.
 */
function expectSame(actual: unknown, expected: unknown): void {
  expect(actual === expected).toBe(true);
}

/** An element of `doc`, proven foreign to this realm before it is used. */
function foreign<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  // The control every case leans on: the ambient constructor refuses it.
  expect(element instanceof HTMLElement).toBe(false);
  return element;
}

describe("the node-kind helpers", () => {
  it("recognise an element, and an HTML element, from another realm", () => {
    const { doc } = otherRealm();
    const div = foreign(doc, "div");
    expect(isElement(div)).toBe(true);
    expect(isHTMLElement(div)).toBe(true);
  });

  it("tell an SVG element from an HTML one, whatever realm built it", () => {
    // The namespace decides the interface, so an `<svg>` is an element and
    // not an HTML element — the distinction `focus` and `offsetWidth` need.
    const { doc } = otherRealm();
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(isElement(svg)).toBe(true);
    expect(isHTMLElement(svg)).toBe(false);
  });

  it("refuse what is not an element at all", () => {
    const { doc } = otherRealm();
    expect(isElement(doc.createTextNode("x"))).toBe(false);
    expect(isElement(doc)).toBe(false);
    expect(isElement(window)).toBe(false);
    expect(isElement(null)).toBe(false);
    expect(isElement(undefined)).toBe(false);
  });

  it("name a textarea and an input by their tag, in another realm", () => {
    const { doc } = otherRealm();
    const area = foreign(doc, "textarea");
    const input = foreign(doc, "input");
    expect(isTextArea(area)).toBe(true);
    expect(isInput(area)).toBe(false);
    expect(isInput(input)).toBe(true);
    expect(isTextArea(input)).toBe(false);
  });
});

describe("deepActiveElement", () => {
  it("is the ordinary active element when no frame has focus", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(deepActiveElement(document)).toBe(button);
  });

  it("follows focus into a same-origin frame", () => {
    const { frame, doc } = otherRealm();
    const field = foreign(doc, "textarea");
    doc.body.appendChild(field);
    field.focus();

    // The control: from here, the frame is all this document can see.
    expect(document.activeElement).toBe(frame);
    expectSame(deepActiveElement(document), field);
  });

  it("answers with the frame when nothing inside it has focus", () => {
    // The frame's body takes no focus of its own, so it is no place to put
    // focus back; the iframe is what holds it from this side.
    const { frame } = otherRealm();
    frame.focus();
    expect(document.activeElement).toBe(frame);
    expect(deepActiveElement(document)).toBe(frame);
  });
});

/** A canvas root in another realm holding one block whose leaf is returned. */
function foreignBlock(doc: Document): {
  root: HTMLDivElement;
  block: HTMLElement;
  leaf: HTMLSpanElement;
} {
  const root = foreign(doc, "div");
  root.className = CANVAS_ROOT_CLASS;
  const block = foreign(doc, "section");
  block.setAttribute(NODE_ID_ATTRIBUTE, "a");
  const leaf = foreign(doc, "span");
  block.appendChild(leaf);
  root.appendChild(block);
  doc.body.appendChild(root);
  return { root, block, leaf };
}

describe("canvas hit-testing in another realm", () => {
  it("resolves a press to its block (nodeIdFromEvent)", () => {
    const { leaf } = foreignBlock(otherRealm().doc);
    expect(nodeIdFromEvent(leaf)).toBe("a");
  });

  it("aims a context menu at the block (contextMenuTargetOf)", () => {
    const { root, leaf } = foreignBlock(otherRealm().doc);
    expect(contextMenuTargetOf(leaf, root)).toBe("a");
  });

  it("leaves the browser's menu to text being edited", () => {
    // Each case asserts the PLAIN press first. Without it, a check that
    // rejected every foreign target would refuse the editable press too, and
    // pass for the wrong reason.
    const { doc } = otherRealm();
    const { root, block, leaf } = foreignBlock(doc);
    expect(contextMenuTargetOf(leaf, root)).toBe("a");

    const editable = foreign(doc, "div");
    editable.setAttribute("contenteditable", "true");
    const typed = foreign(doc, "span");
    editable.appendChild(typed);
    block.appendChild(editable);
    expect(contextMenuTargetOf(typed, root)).toBeNull();
  });

  it("offers no block menu for a press on chrome", () => {
    const { doc } = otherRealm();
    const { root, block, leaf } = foreignBlock(doc);
    expect(contextMenuTargetOf(leaf, root)).toBe("a");

    const chrome = foreign(doc, "div");
    chrome.setAttribute(CHROME_ATTRIBUTE, "");
    const control = foreign(doc, "button");
    chrome.appendChild(control);
    block.appendChild(chrome);
    expect(contextMenuTargetOf(control, root)).toBeNull();
  });
});

describe("who owns Escape, with fields in another realm", () => {
  it("knows a textarea from another realm is text entry", () => {
    expect(isTextEntry(foreign(otherRealm().doc, "textarea"))).toBe(true);
  });

  it("knows a text input from another realm is text entry", () => {
    const { doc } = otherRealm();
    const text = foreign(doc, "input");
    text.type = "text";
    expect(isTextEntry(text)).toBe(true);
    // And still not every input: a checkbox is pressed, never typed into.
    const box = foreign(doc, "input");
    box.type = "checkbox";
    expect(isTextEntry(box)).toBe(false);
  });

  it("leaves Escape to a field focused inside a frame", () => {
    // Asked of the host document, which is what the shortcut reads. From
    // there focus inside the frame is the iframe, and an iframe is no field —
    // so a shallow read would deselect under someone who is typing.
    const { frame, doc } = otherRealm();
    const field = foreign(doc, "textarea");
    doc.body.appendChild(field);
    field.focus();
    expect(document.activeElement).toBe(frame);

    expect(escapeOutcome(document)).toBe("leave-to-field");
  });
});

function registerLeaf(): void {
  if (hasBlock("realm/leaf")) return;
  registerBlocks(
    [
      {
        name: "realm/leaf",
        version: 1,
        description: "A leaf.",
        example: { props: {} },
        editor: { label: "Leaf" },
        render: () => React.createElement("p", null, "leaf"),
      },
    ] as never,
    { source: "dom-kind-test" }
  );
}

const PAIR = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "a", type: "realm/leaf", version: 1, props: {} },
    { id: "b", type: "realm/leaf", version: 1, props: {} },
  ] as BlockNode[],
} as BlockDocument;

function editorWith(selectedId: string | null): EditorState {
  return {
    document: PAIR,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    select: vi.fn(),
    apply: vi.fn(() => PAIR),
    applyAll: vi.fn(() => PAIR),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState;
}

/** A container inside another realm's body, for React to render into. */
function foreignContainer(): { doc: Document; container: HTMLDivElement } {
  const { doc } = otherRealm();
  const container = foreign(doc, "div");
  doc.body.appendChild(container);
  return { doc, container };
}

/**
 * The canvas and its toolbar, rendered into another realm's document.
 *
 * `prepare` runs on that document before anything renders, for a case that
 * has to equip the frame's window first.
 */
function toolbarInFrame(prepare?: (doc: Document) => void) {
  registerLeaf();
  const { doc, container } = foreignContainer();
  prepare?.(doc);
  const editor = editorWith("a");
  render(
    <ShortcutProvider>
      <BlockKeyboardActions onSaveAsPattern={() => undefined} editor={editor}>
        <Canvas
          document={editor.document}
          siteStyles={{ css: "", classes: {} } as never}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          overlay={<BlockToolbar editor={editor} />}
        />
      </BlockKeyboardActions>
    </ShortcutProvider>,
    { container }
  );
  // Found even while unplaced: an unplaced bar is `visibility: hidden`, and
  // the case that asserts placement has to reach its own assertion.
  const bar = within(container).getByRole("toolbar", { hidden: true });
  // The control: the bar and the root it measures against are foreign.
  expect(bar instanceof HTMLElement).toBe(false);
  return { doc, container, bar };
}

describe("the block toolbar in another realm", () => {
  it("places itself against a canvas root from that realm", () => {
    // Unplaced, the bar stays `visibility: hidden` — present, focusable and
    // invisible, which is the silent failure a realm-bound check produces.
    const { bar } = toolbarInFrame();
    expect(bar.style.visibility).not.toBe("hidden");
  });

  it("watches that root for size changes, with an observer from its window", () => {
    // Two recorders, one per window: the root's own window is where an
    // observer of its nodes has to come from, and the editor's is the one a
    // bare `new ResizeObserver` would have reached for.
    const observed: unknown[] = [];
    const strays: unknown[] = [];
    const recording = (into: unknown[]) =>
      class {
        observe(target: unknown) {
          into.push(target);
        }
        unobserve() {}
        disconnect() {}
      };
    vi.stubGlobal("ResizeObserver", recording(strays));
    const { container } = toolbarInFrame(doc => {
      const view = doc.defaultView;
      if (view === null) throw new Error("the frame has no window");
      Object.defineProperty(view, "ResizeObserver", {
        value: recording(observed),
      });
    });
    const root = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
    expect(root).not.toBeNull();
    // By identity rather than `toContain`, whose failure report cannot print
    // a node from another realm.
    expect(observed.includes(root)).toBe(true);
    expect(strays.includes(root)).toBe(false);
  });

  it("moves focus along its buttons with the arrow keys", () => {
    const { doc, bar } = toolbarInFrame();
    // Whether or not the bar is placed, which its own case decides.
    const buttons = within(bar).getAllByRole("button", { hidden: true });
    const [first, second] = buttons;
    if (first === undefined || second === undefined) {
      throw new Error("the bar offers fewer than two buttons");
    }
    first.focus();
    expectSame(doc.activeElement, first);

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expectSame(doc.activeElement, second);
  });
});

describe("the drop refusal in another realm", () => {
  it("anchors itself inside a canvas root from that realm", async () => {
    // Unanchored, it carries no position at all and draws wherever an
    // unpositioned box lands. jsdom measures every box at zero, so being
    // anchored shows as a position of zero — set, rather than missing.
    const { container } = foreignContainer();
    const drag: CanvasDragState = {
      draggingId: "a",
      draggingBlockName: "realm/leaf",
      target: null,
      refusal: {
        regionId: "root",
        reason: "restricted-at-root",
        permitted: [],
      } as never,
    } as CanvasDragState;
    registerLeaf();
    render(
      <Canvas
        document={PAIR}
        siteStyles={{ css: "", classes: {} } as never}
        drag={drag}
        overlay={<DropRefusal drag={drag} document={PAIR} />}
      />,
      { container }
    );
    await act(async () => undefined);

    const notice = container.querySelector<HTMLElement>(".nx-drop-refusal");
    // The control: it must be found, or an absent notice passes below.
    expect(notice).not.toBeNull();
    expect(notice?.style.left).toBe("0px");
    expect(notice?.style.top).toBe("0px");
  });
});

describe("the command palette with focus inside a frame", () => {
  it("returns focus to the control inside the frame, not to the frame", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    Element.prototype.scrollIntoView = function scrollIntoView() {};

    const { frame, doc } = otherRealm();
    const origin = foreign(doc, "button");
    doc.body.appendChild(origin);
    origin.focus();
    expect(document.activeElement).toBe(frame);
    const restored = vi.spyOn(origin, "focus");

    render(
      <ShortcutProvider>
        <CommandPalette
          commands={[{ id: "a", label: "Anything", run: () => {} }]}
        />
      </ShortcutProvider>
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "Escape" });

    // Observed on the element focus is handed to. Refocusing the iframe
    // instead leaves where focus lands inside it to the browser, which need
    // not be where the author was.
    await waitFor(() => expect(restored).toHaveBeenCalled());
  });
});

describe("a press that supersedes a picker, in another realm", () => {
  it("is recognised on a control built by that realm", () => {
    const { doc } = otherRealm();
    const control = foreign(doc, "button");
    for (const [name, value] of Object.entries(commitsFor("color"))) {
      control.setAttribute(name, value);
    }
    const icon = foreign(doc, "span");
    control.appendChild(icon);
    doc.body.appendChild(control);

    expect(supersedes(icon, "color")).toBe(true);
    // Still scoped to the field the control writes.
    expect(supersedes(icon, "background-color")).toBe(false);
  });
});
