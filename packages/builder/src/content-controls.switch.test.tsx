// @vitest-environment jsdom

/**
 * A two-option select its block asks to show as a switch (`display: "switch"`,
 * `switchOn`), as an image's loading is.
 *
 * - One switch, named by the words of the option it turns on, with the
 *   block's hint as its description; off while the default applies.
 * - Turning it on and off stores the two options' own values.
 * - A stored value that is neither stays in the menu, which can show it.
 * - A declaration a switch cannot draw keeps the menu.
 * - A lock holds it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

beforeAll(() => {
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

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A block whose `loading` is declared as `core/image` declares it. */
function register(switchOn = "eager"): void {
  registerBlocks(
    [
      {
        name: "acme/picture",
        version: 1,
        description: "A picture.",
        example: { props: {} },
        editor: { label: "Picture" },
        props: {
          loading: {
            label: "Loading",
            optionLabels: {
              lazy: "Load when near the screen",
              eager: "Load immediately",
            },
            display: "switch",
            switchOn,
            hint: "Turn on for images at the top of the page.",
            type: "select",
            options: ["lazy", "eager"],
          },
        },
        defaultProps: { loading: "lazy" },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-switch-test" }
  );
}

function mount(
  props: Record<string, unknown>,
  { switchOn, locked }: { switchOn?: string; locked?: boolean } = {}
) {
  register(switchOn);
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/picture",
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

describe("a pair of options drawn as a switch", () => {
  it("is one switch named by what on does, described by the block's hint, off by default", () => {
    mount({});
    const toggle = screen.getByRole("switch", { name: "Load immediately" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    const hint = document.getElementById(
      toggle.getAttribute("aria-describedby") ?? ""
    );
    expect(hint?.textContent).toBe(
      "Turn on for images at the top of the page."
    );
    // No menu beside it: the switch replaces it.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("is on for the option it turns on", () => {
    mount({ loading: "eager" });
    expect(
      screen
        .getByRole("switch", { name: "Load immediately" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("stores the on option's value when turned on", () => {
    const editor = mount({});
    fireEvent.click(screen.getByRole("switch", { name: "Load immediately" }));
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { loading: "eager" } },
    });
  });

  it("stores the other option's value when turned off", () => {
    const editor = mount({ loading: "eager" });
    fireEvent.click(screen.getByRole("switch", { name: "Load immediately" }));
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { loading: "lazy" } },
    });
  });

  it("leaves a stored value that is neither option to the menu", () => {
    const editor = mount({ loading: "auto" });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Loading" })).toBeDefined();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("keeps the menu where the option it would turn on is not offered", () => {
    mount({}, { switchOn: "instant" });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Loading" })).toBeDefined();
  });

  it("is held by a lock", () => {
    mount({}, { locked: true });
    expect(
      screen
        .getByRole("switch", { name: "Load immediately" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
