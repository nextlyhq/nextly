// @vitest-environment jsdom

/**
 * The inspector over each kind of lock, and the bar that says what an edit
 * changes.
 *
 * - A block in a `contentOnly` area: its content props stay editable, its
 *   design (style, CSS id, attributes) is read-only with the reason, and the
 *   lock is said to be the containing block's, with no Unlock.
 * - A block in a slot locked `all`: the reason is said, every control stays
 *   editable, and there is no Unlock.
 * - Both at once: the Layers lock and the slot lock are said apart, and
 *   Unlock lifts only the Layers lock.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as React from "react";

import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
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

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "Some words.",
        example: { props: {} },
        editor: { label: "Text" },
        props: {
          body: { type: "text", role: "content" },
          tone: { type: "text" },
        },
        supports: { spacing: true },
        render: () => null,
      },
      {
        name: "acme/frame",
        version: 1,
        description: "A frame whose children keep their design.",
        example: { props: {} },
        editor: { label: "Frame" },
        props: {},
        slots: {
          children: {
            lock: "contentOnly",
            defaultBlock: [{ type: "acme/text" }],
          },
        },
        render: () => null,
      },
      {
        name: "acme/row",
        version: 1,
        description: "A row whose children stay as they are.",
        example: { props: {} },
        editor: { label: "Row" },
        props: {},
        slots: {
          children: { lock: "all", defaultBlock: [{ type: "acme/text" }] },
        },
        render: () => null,
      },
    ] as never,
    { source: "inspector-locks-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A document holding one text block inside a holder of the given type. */
function inside(holder: string, text: Partial<BlockNode> = {}): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "holder",
        type: holder,
        version: 1,
        props: {},
        slots: {
          children: [
            {
              id: "t",
              type: "acme/text",
              version: 1,
              props: { body: "Hello", tone: "warm" },
              ...text,
            } as BlockNode,
          ],
        },
      } as BlockNode,
    ],
  } as BlockDocument;
}

function editorFor(document: BlockDocument): EditorState & {
  apply: ReturnType<typeof vi.fn>;
} {
  return {
    document,
    selectedId: "t",
    selection: { ids: ["t"], primary: "t" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    // Nothing composed around the page: its own tree is all there is.
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

const disabled = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).matches(":disabled");

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Text" }), {
    key: "Enter",
  });
}

function openAdvanced(): void {
  fireEvent.click(screen.getByText("Advanced", { selector: "summary" }));
}

describe("a block inside a contentOnly area", () => {
  it("keeps its content editable and its design read-only, with the reason", () => {
    render(<InspectorPanel editor={editorFor(inside("acme/frame"))} />);

    expect(
      document.querySelector('[data-lock="contentOnly"]')?.textContent
    ).toMatch(
      /This area of Frame is locked to its content\..*can't be unlocked here/
    );
    // Content: the content prop is writable, the design prop is not.
    expect(disabled("Body")).toBe(false);
    expect(disabled("Tone")).toBe(true);
    // Advanced: read-only with the reason.
    openAdvanced();
    expect(disabled("CSS id")).toBe(true);
    expect(screen.getAllByText(/locked to its content/).length).toBeGreaterThan(
      0
    );
    // Style: read-only with the reason.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    expect(
      screen.getByText(/locked to its content/, {
        selector: "[data-read-only]",
      })
    ).toBeDefined();
    const padding = document.querySelector(
      '[data-property="padding"]'
    ) as HTMLElement;
    expect(
      (padding.querySelector("input") as HTMLInputElement).matches(":disabled")
    ).toBe(true);
  });

  it("holds Lock, with the reason: the area pins the block's own lock", () => {
    render(<InspectorPanel editor={editorFor(inside("acme/frame"))} />);
    openMenu();
    const lock = screen.getByRole("menuitem", { name: /^Lock/ });
    expect(lock.getAttribute("aria-disabled")).toBe("true");
    expect(lock.textContent).toContain("The area it sits in fixes this.");
    // The positive control: Rename is offered and not held.
    expect(
      screen
        .getByRole("menuitem", { name: "Rename" })
        .getAttribute("aria-disabled")
    ).toBeNull();
  });
});

describe("a block in a slot locked all", () => {
  it("says why it can't move, and leaves every control editable", () => {
    render(<InspectorPanel editor={editorFor(inside("acme/row"))} />);

    expect(document.querySelector('[data-lock="all"]')?.textContent).toMatch(
      /Row fixes which blocks it holds and their order.*can't be unlocked here/
    );
    expect(disabled("Body")).toBe(false);
    expect(disabled("Tone")).toBe(false);
    openAdvanced();
    expect(disabled("CSS id")).toBe(false);
    openMenu();
    // The arrangement lock leaves the block's own lock its own.
    expect(screen.queryByRole("menuitem", { name: /^Unlock/ })).toBeNull();
    expect(
      screen
        .getByRole("menuitem", { name: "Lock" })
        .getAttribute("aria-disabled")
    ).toBeNull();
  });
});

describe("both locks at once", () => {
  it("says each apart, and Unlock lifts only the Layers lock", () => {
    // A slot locked `all` fixes the arrangement and leaves the block's own
    // lock its own, so Unlock is offered and removes only that.
    const editor = editorFor(inside("acme/row", { locked: true }));
    render(<InspectorPanel editor={editor} />);

    expect(document.querySelector('[data-lock="layers"]')).not.toBeNull();
    expect(document.querySelector('[data-lock="all"]')).not.toBeNull();
    // Every control read-only while the Layers lock holds, content included.
    expect(disabled("Body")).toBe(true);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unlock" }));
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "t",
      patch: {},
      unset: ["locked"],
    });
  });

  it("holds Unlock where a contentOnly area pins the block's own lock", () => {
    render(
      <InspectorPanel
        editor={editorFor(inside("acme/frame", { locked: true }))}
      />
    );

    expect(document.querySelector('[data-lock="layers"]')).not.toBeNull();
    expect(document.querySelector('[data-lock="contentOnly"]')).not.toBeNull();
    openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: /^Unlock/ })
        .getAttribute("aria-disabled")
    ).toBe("true");
  });
});

describe("the bar that says what an edit changes", () => {
  it("names this block, the device and the state, following its props", () => {
    const document = inside("acme/row");
    const editor = editorFor(document);
    const breakpoints = {
      viewport: [
        { id: BASE_BREAKPOINT, label: "Desktop" },
        { id: "tablet", label: "Tablet", maxWidth: 991 },
      ],
      container: [],
    } as never;
    const { rerender } = render(
      <InspectorPanel
        editor={editor}
        breakpoints={breakpoints}
        breakpoint={BASE_BREAKPOINT}
        styleState={{ state: "base", onChange: vi.fn() }}
      />
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    const bar = screen.getByRole("region", { name: "What you're editing" });
    expect(bar.querySelector("[data-edit-target]")?.textContent).toBe(
      "This block"
    );
    expect(bar.querySelector("[data-edit-state]")?.textContent).toBe("Normal");
    const baseDevice = bar.querySelector("[data-edit-device]")?.textContent;

    rerender(
      <InspectorPanel
        editor={editor}
        breakpoints={breakpoints}
        breakpoint={"tablet" as never}
        styleState={{ state: "hover", onChange: vi.fn() }}
      />
    );
    expect(bar.querySelector("[data-edit-state]")?.textContent).toBe("Hover");
    expect(bar.querySelector("[data-edit-device]")?.textContent).toBe("Tablet");
    expect(baseDevice).toBe("Desktop");
  });
});

describe("Advanced's own write path", () => {
  it("refuses a write once a lock lands after the panel drew", () => {
    // The fieldset makes a locked design read-only; this is the write path
    // asking the live document itself, for a lock set after the panel drew.
    const free = inside("acme/row");
    const editor = editorFor(free);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();
    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });

    const holder = free.nodes[0] as BlockNode;
    const child = (holder.slots?.children ?? [])[0] as BlockNode;
    editor.document = {
      ...free,
      nodes: [{ ...holder, slots: { children: [{ ...child, locked: true }] } }],
    } as BlockDocument;
    fireEvent.blur(field);

    expect(editor.apply).not.toHaveBeenCalled();
  });
});
