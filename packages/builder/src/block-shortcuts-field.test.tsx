// @vitest-environment jsdom

/**
 * The Section and Button shortcuts, and a background's overlay, drawn in the
 * real Style panel.
 *
 * @module block-shortcuts-field.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { applyOp } from "./ops";
import { pickedReference, StyleInspectorPanel } from "./style-inspector-panel";

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

const padding = {
  blockStart: { $token: "button.padding-y" },
  blockEnd: { $token: "button.padding-y" },
  inlineStart: { $token: "button.padding-x" },
  inlineEnd: { $token: "button.padding-x" },
};

function mount(
  type: string,
  styles?: BlockNode["styles"],
  target?: React.ComponentProps<typeof StyleInspectorPanel>["target"],
  entries?: readonly unknown[]
) {
  const block = (name: string, extra: Record<string, unknown>) => ({
    name,
    version: 1,
    description: name,
    example: { props: {} },
    editor: { label: name },
    props: {},
    render: () => null,
    ...extra,
  });
  registerBlocks(
    [
      block("core/section", {
        supports: { dimensions: true, background: true },
      }),
      block("core/button", {
        supports: { dimensions: true, spacing: true },
        baseStyles: { base: { base: { padding } } },
      }),
    ] as never,
    { source: "block-shortcuts-field-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n",
        type,
        version: 1,
        props: {},
        ...(styles === undefined ? {} : { styles }),
      },
    ],
  } as unknown as BlockDocument;
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
  render(
    <StyleInspectorPanel
      editor={editor}
      {...(target === undefined ? {} : { target })}
      {...(entries === undefined
        ? {}
        : { cascade: { entries, nodes: document.nodes } as never })}
    />
  );
  return editor;
}

/** Open a section of the panel by its heading. */
function open(section: string): void {
  const heading = screen.getByRole("button", {
    name: new RegExp(`^${section}`),
  });
  if (heading.getAttribute("aria-expanded") !== "true")
    fireEvent.click(heading);
}

describe("a Section's Min height presets", () => {
  it("are the Min height row while no min height draws the field", () => {
    const editor = mount("core/section");
    open("Size");
    expect(
      screen.getByRole("radiogroup", { name: "Min height" })
    ).toBeDefined();
    expect(
      screen.getByRole("radio", { name: "Auto" }).getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Full screen" }));
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      '"minHeight":"100svh"'
    );
  });

  it("stand over the Min height field once it is drawn, one label for both", () => {
    mount("core/section", {
      base: { [BASE_BREAKPOINT]: { minHeight: "100svh" } },
    });
    open("Size");
    expect(
      screen
        .getByRole("radio", { name: "Full screen" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("radiogroup", { name: "Min height presets" })
    ).toBeDefined();
    // The field's label is the one on screen; no second "Height" row.
    expect(screen.getAllByText("Min height")).toHaveLength(1);
    const presets = document.querySelector('[data-control="section-height"]');
    const field = document.querySelector('[data-property="minHeight"]');
    expect(presets?.nextElementSibling).toBe(field);
  });
});

describe("a Section's Min height presets, chosen from the keyboard", () => {
  it("keep focus on the chosen preset as the field they stand over comes and goes", () => {
    // A live editor: each write redraws the panel, so Full screen draws the
    // Min height field and the presets move over it, and Auto moves them back.
    const editor = mount("core/section");
    let document = editor.document;
    const view = (): React.JSX.Element => (
      <StyleInspectorPanel editor={{ ...editor, document }} />
    );
    editor.apply.mockImplementation(op => {
      document = applyOp(document, op).document;
      rerender();
      return document;
    });
    cleanup();
    const rendered = render(view());
    function rerender(): void {
      rendered.rerender(view());
    }
    open("Size");
    const auto = screen.getByRole("radio", { name: "Auto" });
    auto.focus();
    fireEvent.keyDown(auto, { key: "ArrowRight" });
    expect(
      screen.getByRole("radiogroup", { name: "Min height presets" })
    ).toBeDefined();
    expect(globalThis.document.activeElement).toBe(
      screen.getByRole("radio", { name: "Full screen" })
    );
    fireEvent.keyDown(globalThis.document.activeElement as Element, {
      key: "ArrowLeft",
    });
    expect(
      screen.getByRole("radiogroup", { name: "Min height" })
    ).toBeDefined();
    expect(globalThis.document.activeElement).toBe(
      screen.getByRole("radio", { name: "Auto" })
    );
  });
});

describe("a Button's Size and Full width", () => {
  it("writes the button's own tokens scaled for Small", () => {
    const editor = mount("core/button");
    open("Size");
    fireEvent.click(screen.getByRole("radio", { name: "Small" }));
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      '{"$token":"button.padding-y","times":0.75}'
    );
  });

  it("says Custom for a size set another way, choosing none", () => {
    mount("core/button", { base: { [BASE_BREAKPOINT]: { fontSize: "2rem" } } });
    open("Size");
    for (const name of ["Small", "Medium", "Large"]) {
      expect(
        screen.getByRole("radio", { name }).getAttribute("aria-checked")
      ).toBe("false");
    }
    expect(screen.getByText(/^Custom:/)).toBeDefined();
  });

  it("writes a width of 100% for Full width", () => {
    const editor = mount("core/button");
    open("Size");
    fireEvent.click(screen.getByRole("switch", { name: "Full width" }));
    expect(JSON.stringify(editor.apply.mock.calls[0]?.[0])).toContain(
      '"width":"100%"'
    );
  });

  it("shows a scaled token as the token times its factor", () => {
    mount("core/button", {
      base: {
        [BASE_BREAKPOINT]: {
          padding: {
            blockStart: { $token: "button.padding-y", times: 0.75 },
            blockEnd: { $token: "button.padding-y", times: 0.75 },
            inlineStart: { $token: "button.padding-x", times: 0.75 },
            inlineEnd: { $token: "button.padding-x", times: 0.75 },
          },
          fontSize: "0.875em",
        },
      },
    });
    open("Size");
    expect(
      screen.getByRole("radio", { name: "Small" }).getAttribute("aria-checked")
    ).toBe("true");
    open("Spacing");
    expect(
      screen.getAllByText("button.padding-y × 0.75").length
    ).toBeGreaterThan(0);
  });
});

describe("a background's overlay", () => {
  const overlayLabels = () =>
    screen.queryAllByText(/^Overlay/).map(each => each.textContent);

  it("is not offered with nothing to cover", () => {
    mount("core/section");
    open("Background");
    expect(overlayLabels()).toEqual([]);
  });

  it("is not offered over an image cleared with none", () => {
    // `none` clears an image; the compiler lays no layer over it.
    mount("core/section", {
      base: { [BASE_BREAKPOINT]: { background: { url: "none" } } },
    });
    open("Background");
    expect(overlayLabels()).toEqual([]);
  });

  it("is offered over an image, its strength in percent", () => {
    mount("core/section", {
      base: { [BASE_BREAKPOINT]: { background: { url: "/hills.jpg" } } },
    });
    open("Background");
    expect(overlayLabels()).toEqual(["Overlay", "Overlay strength"]);
    expect(
      screen
        .getByRole("slider", { name: /overlay strength/i })
        .getAttribute("aria-valuenow")
    ).toBe("50");
  });
});

describe("a shared style's overlay", () => {
  const overlayLabels = () =>
    screen.queryAllByText(/^Overlay/).map(each => each.textContent);
  /** A shared style storing what is given, as the panel's target. */
  const shared = (styles: BlockNode["styles"]) => ({
    kind: "shared" as const,
    worn: [],
    style: { id: "cls-1", name: "Hero", styles } as never,
    readOnly: undefined,
    write: async () => undefined,
  });

  it("is offered over the style's own image while the block has none", () => {
    mount(
      "core/section",
      undefined,
      shared({
        base: { [BASE_BREAKPOINT]: { background: { url: "/hills.jpg" } } },
      })
    );
    open("Background");
    expect(overlayLabels()).toEqual(["Overlay", "Overlay strength"]);
  });

  it("is not offered over the block's image while the style has none", () => {
    mount(
      "core/section",
      { base: { [BASE_BREAKPOINT]: { background: { url: "/hills.jpg" } } } },
      shared({ base: { [BASE_BREAKPOINT]: { color: "#fff" } } })
    );
    open("Background");
    expect(overlayLabels()).toEqual([]);
  });
});

describe("the overlay, judged by the image that wins here", () => {
  const overlayLabels = () =>
    screen.queryAllByText(/^Overlay/).map(each => each.textContent);
  /** The background image the cascade records for the Section. */
  const image = (value: string) => ({
    origin: { kind: "node", id: "n" },
    property: "background-image",
    value,
    state: "base",
    breakpoint: BASE_BREAKPOINT,
  });

  it("is not offered where the winning image is none, whatever another state stores", () => {
    mount(
      "core/section",
      {
        base: { [BASE_BREAKPOINT]: { background: { url: "none" } } },
        hover: { [BASE_BREAKPOINT]: { background: { url: "/hills.jpg" } } },
      },
      undefined,
      [image("none")]
    );
    open("Background");
    expect(overlayLabels()).toEqual([]);
  });

  it("is offered where the winning image paints", () => {
    mount("core/section", undefined, undefined, [
      image('var(--nx-pb-overlay-layer,) url("/hills.jpg")'),
    ]);
    open("Background");
    expect(overlayLabels()).toEqual(["Overlay", "Overlay strength"]);
  });

  it("stays offered while an overlay of its own is stored, so it can be cleared", () => {
    mount(
      "core/section",
      {
        base: {
          [BASE_BREAKPOINT]: { background: { url: "none", overlay: "#000" } },
        },
      },
      undefined,
      [image("none")]
    );
    open("Background");
    expect(overlayLabels()).toEqual(["Overlay", "Overlay strength"]);
  });
});

describe("replacing a scaled variable", () => {
  it("keeps its scale, the size it was set to", () => {
    expect(pickedReference("space.3", 0.75)).toEqual({
      $token: "space.3",
      times: 0.75,
    });
    expect(pickedReference("space.3", undefined)).toEqual({
      $token: "space.3",
    });
  });
});
