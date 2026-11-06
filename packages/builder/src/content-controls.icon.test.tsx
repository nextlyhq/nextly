// @vitest-environment jsdom

/**
 * An `icon` prop in the Content tab: one button showing the chosen icon,
 * which opens the search-first picker, and a clear button.
 *
 * - The button says the prop and the icon: "Icon: Star".
 * - Choosing an icon stores its id, as one update.
 * - Clearing removes the prop.
 * - An id the set does not draw is shown with a warning and not rewritten.
 * - A lock holds it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

/* Two icons, drawn as one line each: the control's behaviour, not the set's. */
vi.mock("./lucide-icon-source", () => {
  const icon = (name: string) => ({
    id: `lucide:${name}`,
    name,
    body: '<path d="M0 0h24"/>',
    viewBox: "0 0 24 24",
    stroked: true,
  });
  const icons = [icon("star"), icon("truck")];
  const source = {
    prefix: "lucide",
    label: "Lucide",
    search: (query: string) =>
      Promise.resolve(icons.filter(each => each.name.includes(query))),
    resolve: (id: string) =>
      Promise.resolve(icons.find(each => each.id === id) ?? null),
  };
  return { loadLucideIcons: () => Promise.resolve(source) };
});

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  // The picker's grid renders only the rows in view, sized from a
  // ResizeObserver and the scroll box's offset size, neither of which jsdom
  // provides, so the observer reports once on observe, as a real one does.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  for (const [key, size] of [
    ["offsetHeight", 320],
    ["offsetWidth", 360],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => size,
    });
  }
  Element.prototype.scrollTo ??= () => {};
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

function mount(
  props: Record<string, unknown>,
  { locked }: { locked?: boolean } = {}
) {
  registerBlocks(
    [
      {
        name: "acme/badge",
        version: 1,
        description: "A badge.",
        example: { props: {} },
        editor: { label: "Badge" },
        props: { icon: { label: "Icon", role: "content", type: "icon" } },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "content-controls-icon-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/badge",
        version: 1,
        props,
        ...(locked === true ? { locked: true } : {}),
      } as BlockNode,
    ],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  render(<InspectorPanel editor={editor} />);
  return editor;
}

describe("an icon prop in the Content tab", () => {
  it("is one button that says the prop and the chosen icon", async () => {
    mount({ icon: "lucide:star" });
    expect(
      await screen.findByRole("button", { name: "Icon: Star" })
    ).toBeDefined();
  });

  it("stores the id of the icon chosen in the picker, as one update", async () => {
    const editor = mount({ icon: "lucide:star" });
    fireEvent.click(await screen.findByRole("button", { name: "Icon: Star" }));
    fireEvent.click(await screen.findByRole("option", { name: "Truck" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { icon: "lucide:truck" } },
    });
  });

  it("removes the prop when cleared", async () => {
    const editor = mount({ icon: "lucide:star" });
    fireEvent.click(await screen.findByRole("button", { name: "Clear icon" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    const [op] = editor.apply.mock.calls[0] as [
      { patch: { props: Record<string, unknown> } },
    ];
    expect(op.patch.props.icon).toBeUndefined();
  });

  it("shows an icon the set does not draw with a warning, and keeps it", async () => {
    const editor = mount({ icon: "lucide:gone" });
    expect(
      await screen.findByText(
        "This icon is no longer available. Choose another."
      )
    ).toBeDefined();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Icon: gone, not found" })
      ).toBeDefined()
    );
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is held by a lock", async () => {
    mount({ icon: "lucide:star" }, { locked: true });
    const button = await screen.findByRole("button", { name: "Icon: Star" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Clear icon" })).toBeNull();
  });
});
