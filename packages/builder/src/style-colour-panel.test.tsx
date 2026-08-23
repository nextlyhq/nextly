// @vitest-environment jsdom

/**
 * The colour control, driven through the Style tab against a real editor.
 *
 * `style-colour.ts` decides what a value resolves to and whether a pair can be
 * measured, and asserts that without a DOM. What is only true HERE is the
 * wiring: that a colour leaf draws a swatch rather than a bare text field, that
 * a stored TOKEN reaches this control instead of the read-only surface, that
 * the name shown is the token's current one while the document keeps its
 * identity, and that a readout appears only where both halves of a pair can be
 * read.
 *
 * @module style-colour-panel.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
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

/**
 * A site whose second token is RENAMED, so identity and name differ.
 *
 * The panel must show one and store the other, and a fixture where they match
 * cannot tell a correct control from one that has them the wrong way round.
 */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#ffffff" },
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
        supports: { color: { text: true }, background: { color: true } },
        render: () => null,
      },
    ] as never,
    { source: "style-colour-panel-test" }
  );
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
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
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

/**
 * Mount the Style tab over one node's stored styles.
 *
 * `null` means the host supplied NO table, and is spelled that way rather than
 * as `undefined` because a default parameter cannot tell an omitted argument
 * from an explicit `undefined` — measured: `mount(styles, undefined)` silently
 * took the default and the no-table test asserted against the full fixture.
 */
function mount(styles?: NodeStyles, tokens: SiteTokenSet | null = TOKENS) {
  register();
  const document_: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/box", version: 1, props: {}, styles },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = editorFor(document_);
  render(
    <StyleInspectorPanel
      editor={editor}
      {...(tokens === null ? {} : { tokens })}
    />
  );
  return editor;
}

/** Styles holding a text colour, and optionally a background, at base/base. */
function styles(color?: unknown, backgroundColor?: unknown): NodeStyles {
  return {
    base: {
      base: {
        ...(color === undefined ? {} : { color }),
        ...(backgroundColor === undefined ? {} : { backgroundColor }),
      },
    },
  } as unknown as NodeStyles;
}

const swatch = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

describe("a colour leaf draws a colour control", () => {
  it("offers a swatch beside the field, where before there was only a field", () => {
    mount(styles("#3b82f6"));
    // The gap C-5 fills: this leaf used to fall through to a plain text field.
    expect(swatch("Colour for Color")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "#3b82f6"
    );
  });

  it("paints the swatch with the colour the value resolves to", () => {
    mount(styles("#3b82f6"));
    expect(
      swatch("Colour for Color").style.getPropertyValue("--nx-swatch")
    ).toBe("#3b82f6");
  });

  it("paints NOTHING for a colour it cannot resolve, and keeps the value", () => {
    // `oklch()` is a valid colour the engine stores and `parseColor` declines.
    // The swatch must not guess, and the text must not be rewritten.
    mount(styles("oklch(0.7 0.1 200)"));
    const button = swatch("Colour for Color");
    expect(button.style.getPropertyValue("--nx-swatch")).toBe("");
    expect(button.getAttribute("data-empty")).toBe("");
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "oklch(0.7 0.1 200)"
    );
  });

  it("paints nothing for a value that resolves somewhere else", () => {
    // `var()` in the panel would resolve against the PANEL's custom properties
    // rather than the canvas's, so a painted swatch would show a colour the
    // page does not have.
    mount(styles("var(--site-color-primary)"));
    expect(
      swatch("Colour for Color").style.getPropertyValue("--nx-swatch")
    ).toBe("");
  });

  it("commits a typed colour on blur", () => {
    const editor = mount(styles("#3b82f6"));
    const field = screen.getByRole("textbox", { name: "Color" });
    fireEvent.change(field, { target: { value: "#ff0000" } });
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("CLEARS rather than storing an empty colour", () => {
    const editor = mount(styles("#3b82f6"));
    const field = screen.getByRole("textbox", { name: "Color" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    const op = editor.apply.mock.calls[0]?.[0] as { patch?: unknown };
    expect(editor.apply).toHaveBeenCalledTimes(1);
    // The entry is removed, so the property falls back through the cascade.
    // Written as an empty string it would instead pin the property to nothing.
    expect(JSON.stringify(op.patch)).not.toContain('"color":""');
  });
});

describe("a stored token reference", () => {
  it("reaches the colour control rather than the read-only surface", () => {
    // Before this control, `ControlValue` returned the generic token surface for
    // every reference — see-it-or-clear-it, with no way to choose another. The
    // swatch is what says a colour reference is now editable.
    mount(styles({ $token: "color.ink" }));
    expect(swatch("Colour for Color")).toBeDefined();
  });

  it("shows the token's CURRENT name, not the identity the document holds", () => {
    // The renamed token: stored as `color.primary`, displayed as `brand.main`.
    // A control reading the stored string straight onto the screen shows an
    // author a name they already changed.
    mount(styles({ $token: "color.primary" }));
    expect(screen.getByText("brand.main")).toBeDefined();
    expect(screen.queryByText("color.primary")).toBeNull();
  });

  it("paints the swatch with the colour the token resolves to", () => {
    mount(styles({ $token: "color.ink" }));
    expect(
      swatch("Colour for Color").style.getPropertyValue("--nx-swatch")
    ).toBe("#111111");
  });

  it("falls back to the stored identity when the site defines no such token", () => {
    // A dangling reference still compiles — an unknown token is a warning, not
    // an error — so the author is shown the string their document holds rather
    // than an empty space.
    mount(styles({ $token: "color.missing" }));
    expect(screen.getByText("color.missing")).toBeDefined();
  });

  it("shows the identity when the host supplied no table at all", () => {
    // Omitting `tokens` means the question was never asked, so there is no name
    // to resolve to and the identity is the only string available.
    mount(styles({ $token: "color.primary" }), null);
    expect(screen.getByText("color.primary")).toBeDefined();
  });

  it("offers a clear that removes the reference", () => {
    const editor = mount(styles({ $token: "color.ink" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear Color" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });
});

describe("the contrast readout", () => {
  it("reports a ratio when both halves of the pair can be read", () => {
    mount(styles("#000000", "#ffffff"));
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);
  });

  it("says a failing pair fails, without refusing the value", () => {
    mount(styles("#777777", "#888888"));
    expect(
      screen.getAllByText(/below AA for body text/).length
    ).toBeGreaterThan(0);
    // Still editable: a low ratio is a warning about a valid value, never a
    // refusal. The same position Gutenberg's contrast checker takes.
    expect(screen.getByRole("textbox", { name: "Color" })).toHaveProperty(
      "value",
      "#777777"
    );
  });

  it("measures a pair written as TOKENS, by resolving both sides", () => {
    mount(styles({ $token: "color.ink" }, { $token: "color.primary" }));
    expect(
      screen.getAllByText(/Contrast 1[0-9]\.[0-9]:1/).length
    ).toBeGreaterThan(0);
  });

  it("reports NOTHING when the partner is unset", () => {
    // The honest half. A colour on its own has no contrast, and inventing a
    // background to measure against would be a number an author acts on.
    mount(styles("#000000"));
    expect(screen.queryByText(/Contrast/)).toBeNull();
  });

  it("reports nothing when either half cannot be read", () => {
    mount(styles("var(--brand)", "#ffffff"));
    expect(screen.queryByText(/Contrast/)).toBeNull();
  });

  it("appears on the BACKGROUND control too, not only the foreground", () => {
    // Each control answers for the pair it is part of, so an author editing the
    // background sees the same verdict as one editing the text. The two sit in
    // different accordion sections and Radix renders only the open one, so this
    // has to open Background rather than counting two readouts at once — which
    // is itself worth knowing: an author never sees both controls together.
    mount(styles("#000000", "#ffffff"));
    fireEvent.click(screen.getByRole("button", { name: /^Background/ }));
    expect(
      screen.getByRole("textbox", { name: "Background color" })
    ).toHaveProperty("value", "#ffffff");
    expect(swatch("Colour for Background color")).toBeDefined();
    expect(screen.getAllByText(/Contrast 21\.0:1/).length).toBeGreaterThan(0);
  });
});
