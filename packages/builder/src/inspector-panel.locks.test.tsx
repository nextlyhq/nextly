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
    // Style: read-only, its reason said once, by the card's line above, not
    // again under the tab's bar.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    expect(document.querySelector('[data-read-only="style"]')).toBeNull();
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

describe("several blocks, some inside a contentOnly area", () => {
  /** A frame's text `t` plus free texts beside it, all of them selected. */
  function selected(free: readonly string[]) {
    const page = inside("acme/frame");
    const document = {
      ...page,
      nodes: [
        ...page.nodes,
        ...free.map(
          id =>
            ({
              id,
              type: "acme/text",
              version: 1,
              props: {},
            }) as BlockNode
        ),
      ],
    } as BlockDocument;
    const editor = editorFor(document);
    editor.selection = { ids: ["t", ...free], primary: "t" } as never;
    render(<InspectorPanel editor={editor} />);
    return editor;
  }

  function openSelectionMenu(count: number): void {
    fireEvent.keyDown(
      screen.getByRole("button", { name: `Actions for ${count} blocks` }),
      { key: "Enter" }
    );
  }

  it("locks only the blocks whose own lock may change, and says why", () => {
    // The held block is left out of the edit: it is applied as one group, and
    // the save refusing the held one would change none of the others.
    const editor = selected(["free"]);
    expect(document.querySelector('[data-lock="held"]')?.textContent).toBe(
      "1 of them sits in an area that fixes its lock, so it can't be locked or unlocked here."
    );
    openSelectionMenu(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "Lock the others" }));
    expect(editor.applyAll).toHaveBeenCalledWith([
      { kind: "update", id: "free", patch: { locked: true } },
    ]);
  });

  it("holds the item, with the reason, when none of them may change", () => {
    const editor = editorFor(inside("acme/frame"));
    const frame = editor.document.nodes[0] as BlockNode;
    const t = (frame.slots?.children ?? [])[0] as BlockNode;
    editor.document = {
      ...editor.document,
      nodes: [
        {
          ...frame,
          slots: { children: [t, { ...t, id: "t2" }] },
        } as BlockNode,
      ],
    } as BlockDocument;
    editor.selection = { ids: ["t", "t2"], primary: "t" } as never;
    render(<InspectorPanel editor={editor} />);

    openSelectionMenu(2);
    const item = screen.getByRole("menuitem", { name: /^Lock all/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("The area each sits in fixes this.");
    expect(document.querySelector('[data-lock="held"]')?.textContent).toMatch(
      /^Each sits in an area/
    );
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
    // Named for what the edit reaches: the unconditional tier is every device.
    expect(baseDevice).toBe("All devices");
  });
});

describe("the devices the bar says an edit reaches", () => {
  it("names a narrower tier and those below it, from the site's own list", () => {
    const breakpoints = {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "phone", label: "Phone", maxWidth: 600 },
      ],
      container: [],
    } as never;
    const { rerender } = render(
      <InspectorPanel
        editor={editorFor(inside("acme/row"))}
        breakpoints={breakpoints}
        breakpoint={"tablet" as never}
        styleState={{ state: "base", onChange: vi.fn() }}
      />
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    const device = () => document.querySelector("[data-edit-device]");
    expect(device()?.textContent).toBe("Tablet and smaller");
    rerender(
      <InspectorPanel
        editor={editorFor(inside("acme/row"))}
        breakpoints={breakpoints}
        breakpoint={"phone" as never}
        styleState={{ state: "base", onChange: vi.fn() }}
      />
    );
    // The narrowest reaches only itself.
    expect(device()?.textContent).toBe("Phone");
  });

  it("says an edit to the unconditional tier reaches all devices", () => {
    // A site's breakpoints list only its narrower tiers; the unconditional
    // one is built in, and an edit there reaches every device.
    const breakpoints = {
      viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
      container: [],
    } as never;
    render(
      <InspectorPanel
        editor={editorFor(inside("acme/row"))}
        breakpoints={breakpoints}
        breakpoint={BASE_BREAKPOINT}
        styleState={{ state: "base", onChange: vi.fn() }}
      />
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    const device = document.querySelector("[data-edit-device]");
    expect(device?.textContent).toBe("All devices");
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
