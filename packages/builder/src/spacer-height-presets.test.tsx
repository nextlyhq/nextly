// @vitest-environment jsdom

/**
 * A Spacer's Height presets in the real Style panel: the site's spacing
 * variables, smallest first, over the Height field, each writing its variable.
 *
 * @module spacer-height-presets.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
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

const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "space.xl", kind: "dimension", values: { light: "64px" } },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
    { name: "space.md", kind: "dimension", values: { light: "16px" } },
    { name: "radius.pill", kind: "dimension", values: { light: "12px" } },
  ],
};

function mount(type: string, extra: Partial<BlockNode> = {}) {
  registerBlocks(
    [
      {
        name: type,
        version: 1,
        description: type,
        example: { props: {} },
        editor: { label: type },
        props: {},
        supports: { dimensions: true },
        baseStyles: { base: { base: { height: "2rem" } } },
        render: () => null,
      },
    ] as never,
    { source: "spacer-height-presets-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n", type, version: 1, props: {}, ...extra }],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "n",
    selection: { ids: ["n"], primary: "n" },
    applyAll: vi.fn(() => document),
    apply: vi.fn(() => document),
    select: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  render(<StyleInspectorPanel editor={editor} tokens={TOKENS} />);
  const heading = screen
    .getAllByRole("button", { name: /^Size/ })
    .find(button => button.hasAttribute("aria-expanded"));
  if (heading?.getAttribute("aria-expanded") !== "true")
    fireEvent.click(heading!);
  return editor;
}

const presets = () => screen.getByRole("radiogroup", { name: "Presets" });

describe("a Spacer's Height presets", () => {
  it("offers the site's spacing variables, smallest first, and no radius", () => {
    mount("core/spacer");
    const names = within(presets())
      .getAllByRole("radio")
      .map(radio => radio.textContent ?? "");
    // The site's own beside the builder's defaults, as a spacing side's
    // popover lists them: in size order, a radius never among them.
    const at = (name: string) => names.indexOf(name);
    expect(at("Sm 8px")).toBeGreaterThanOrEqual(0);
    expect(at("Sm 8px")).toBeLessThan(at("Md 16px"));
    expect(at("Md 16px")).toBeLessThan(at("Xl 64px"));
    expect(names.some(name => name.startsWith("Pill"))).toBe(false);
  });

  it("writes the chosen variable as the height at the edited device", () => {
    const editor = mount("core/spacer");
    fireEvent.click(within(presets()).getByRole("radio", { name: /^Md/ }));
    const op = JSON.stringify(editor.apply.mock.calls[0]?.[0]);
    expect(op).toContain('"height":{"$token":"space.md"}');
  });

  it("marks the variable the height holds", () => {
    mount("core/spacer", {
      styles: {
        base: { [BASE_BREAKPOINT]: { height: { $token: "space.xl" } } },
      },
    });
    expect(
      within(presets())
        .getByRole("radio", { name: /^Xl/ })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("is held on a Spacer locked in Layers", () => {
    mount("core/spacer", { locked: true });
    // Held by the section's fieldset, as the section's other fields are.
    for (const radio of within(presets()).getAllByRole("radio")) {
      expect(radio.matches(":disabled")).toBe(true);
    }
  });

  it("is not drawn on another block's Height", () => {
    mount("acme/panel");
    expect(screen.queryByRole("radiogroup", { name: "Presets" })).toBeNull();
  });
});
