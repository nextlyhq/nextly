// @vitest-environment jsdom

/**
 * Variables in the Style tab's fields that are not colours, driven through
 * the panel against a real editor's surface.
 *
 * `style-variables.ts` decides what a typed word names and what a field
 * offers, without a DOM. What is only true HERE is the wiring: which fields
 * draw the ◇, that a pick and a typed name both store a reference, and that a
 * held reference shows as the chip rather than as text.
 *
 * @module style-variables-panel.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { applyOps, type BuilderOp } from "./ops";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

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

/**
 * A site with a type size and its line height under one name, a spacing step
 * and a radius. Every length here is a `dimension`, so only the type-scale
 * rule keeps "Display" from appearing twice in a font size field.
 */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "font-size.display", kind: "dimension", values: { light: "48px" } },
    {
      name: "line-height.display",
      kind: "dimension",
      values: { light: "56px" },
    },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
    { name: "radius.pill", kind: "dimension", values: { light: "12px" } },
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
  ],
};

function register(
  supports: Record<string, boolean | Record<string, boolean>>
): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports,
        render: () => null,
      },
    ] as never,
    { source: "style-variables-panel-test" }
  );
}

function editorFor(
  document: BlockDocument
): EditorState & { applyAll: ReturnType<typeof vi.fn> } {
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
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
}

/**
 * The Style tab over one node. `null` tokens means the host supplied none,
 * spelled so because a default parameter cannot tell an omitted argument
 * from an explicit `undefined`.
 */
function mount(
  supports: Record<string, boolean | Record<string, boolean>>,
  values: Record<string, unknown> = {},
  tokens: SiteTokenSet | null = TOKENS
) {
  register(supports);
  const document_ = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/box",
        version: 1,
        props: {},
        styles: { base: { [BASE_BREAKPOINT]: values } } as NodeStyles,
      },
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

const fieldsOf = (property: string) =>
  within(
    document.querySelector(`[data-property="${property}"]`) as HTMLElement
  );

const written = (editor: ReturnType<typeof mount>): string =>
  JSON.stringify(editor.applyAll.mock.calls);

describe("a field whose property takes a variable", () => {
  it.each([
    ["font size", { typography: true }, "fontSize", "Font size"],
    ["line height", { typography: true }, "lineHeight", "Line height"],
    ["a spacing side", { spacing: true }, "padding", "Padding block start"],
    ["a radius", { border: { radius: true } }, "borderRadius", "Border radius"],
  ] as const)(
    "offers the site's variables on %s",
    (_, supports, property, label) => {
      mount(supports);
      expect(
        fieldsOf(property).getByRole("button", {
          name: `Variables for ${label}`,
        })
      ).toBeDefined();
    }
  );

  it("offers none on a field whose kind the site defines no variable of", () => {
    // Opacity takes a number variable; this site, defaults included, has none.
    mount({ effects: true });
    expect(
      fieldsOf("opacity").queryByRole("button", { name: /^Variables for/ })
    ).toBeNull();
  });

  it("offers none anywhere when the host supplied no variables", () => {
    mount({ typography: true }, {}, null);
    expect(screen.queryByRole("button", { name: /^Variables for/ })).toBeNull();
  });

  it("lists the type size in a font size field, not its line height", () => {
    mount({ typography: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Font size" })
    );
    const list = screen.getByRole("listbox", { name: "Variables" });
    expect(
      within(list).getAllByRole("option", { name: /^Display/ })
    ).toHaveLength(1);
    expect(
      within(list).getByRole("option", { name: "Display 48px" })
    ).toBeDefined();
  });

  it("stores a reference to the variable picked", () => {
    const editor = mount({ typography: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Font size" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).toContain(
      '"fontSize":{"$token":"font-size.display"}'
    );
  });

  it("stores the line height's own variable from a line height field", () => {
    const editor = mount({ typography: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Line height" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 56px" }));
    expect(written(editor)).toContain(
      '"lineHeight":{"$token":"line-height.display"}'
    );
  });

  it("keeps the hint short, and shows an empty field's ◇ at rest instead", () => {
    // "16 or a variable" was cut off in the field; the ◇ on an empty field is
    // what says a variable can be chosen now.
    mount({ typography: true });
    expect(
      (screen.getByLabelText("Font size") as HTMLInputElement).placeholder
    ).toBe("16");
    expect(
      screen
        .getByRole("button", { name: "Variables for Font size" })
        .hasAttribute("data-empty")
    ).toBe(true);
  });

  it("does not show the ◇ at rest on a field that holds a value", () => {
    mount({ typography: true }, { fontSize: "20px" });
    expect(
      screen
        .getByRole("button", { name: "Variables for Font size" })
        .hasAttribute("data-empty")
    ).toBe(false);
  });

  it("offers a spacing side the spacing steps, not the radii", () => {
    mount({ spacing: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Variables for Padding block start",
      })
    );
    const spacing = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(spacing).toContain("Sm 8px");
    expect(spacing.some(text => text?.startsWith("Pill"))).toBe(false);
  });

  it("offers a radius the radii, not the spacing steps", () => {
    mount({ border: { radius: true } });
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Border radius" })
    );
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Pill 12px"]);
  });
});

describe("a field holding a variable", () => {
  it("shows the variable by name in place of the text, and ✕ removes it", () => {
    const editor = mount(
      { typography: true },
      { fontSize: { $token: "font-size.display" } }
    );
    const fontSize = fieldsOf("fontSize");
    expect(fontSize.queryByRole("textbox")).toBeNull();
    const chip = fontSize.getByRole("group", { name: "Font size" });
    expect(chip.textContent).toBe("Display 48px");
    // The name the author gave it, never the code path it is stored under,
    // and the whole name and value on hover where the field cuts them short.
    expect(fontSize.queryByText(/font-size\.display/)).toBeNull();
    expect(chip.title).toBe("Display 48px");
    fireEvent.click(
      within(chip).getByRole("button", {
        name: "Clear Font size",
      })
    );
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).not.toContain("font-size.display");
  });

  it("keeps the ◇ beside the chip, to choose another", () => {
    const editor = mount(
      { spacing: true },
      { padding: { blockStart: { $token: "space.sm" } } }
    );
    const choose = fieldsOf("padding").getByRole("button", {
      name: "Variables for Padding block start",
    });
    expect(choose.hasAttribute("data-bound")).toBe(true);
    fireEvent.click(choose);
    expect(
      screen
        .getByRole("option", { name: "Sm 8px" })
        .hasAttribute("data-current")
    ).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: "Space 4 1rem" }));
    expect(written(editor)).toContain('{"$token":"space.4"}');
  });
});

describe("a variable's name typed into a field", () => {
  it("stores the variable rather than refusing the word as a length", () => {
    const editor = mount({ typography: true });
    const field = screen.getByLabelText("Font size");
    fireEvent.change(field, { target: { value: "display" } });
    fireEvent.blur(field);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(written(editor)).toContain(
      '"fontSize":{"$token":"font-size.display"}'
    );
  });

  it("stores a line height's variable typed by name", () => {
    const editor = mount({ typography: true });
    const field = screen.getByLabelText("Line height");
    fireEvent.change(field, { target: { value: "Display" } });
    fireEvent.blur(field);
    expect(written(editor)).toContain(
      '"lineHeight":{"$token":"line-height.display"}'
    );
  });

  it("stores a colour variable typed by name into a colour field", () => {
    const editor = mount({ color: { text: true } });
    const field = fieldsOf("color").getByRole("textbox");
    fireEvent.change(field, { target: { value: "Ink" } });
    fireEvent.blur(field);
    expect(written(editor)).toContain('"color":{"$token":"color.ink"}');
  });

  it("still refuses a word that names no variable, as before", () => {
    const editor = mount({ typography: true });
    const field = screen.getByLabelText("Font size");
    fireEvent.change(field, { target: { value: "Huge" } });
    fireEvent.blur(field);
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("is not a length");
  });
});

/**
 * The panel over an editor whose document MOVES when it is written to, so a
 * field that is replaced by a write is replaced here too.
 */
function LivePanel({
  values,
}: {
  values: Record<string, unknown>;
}): React.JSX.Element {
  const [document_, setDocument] = React.useState<BlockDocument>(
    () =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "acme/box",
            version: 1,
            props: {},
            styles: { base: { [BASE_BREAKPOINT]: values } } as NodeStyles,
          },
        ] as BlockNode[],
      }) as BlockDocument
  );
  const editor = {
    ...editorFor(document_),
    applyAll: (ops: BuilderOp[]) => {
      const applied = applyOps(document_, ops);
      if (applied.document !== null) setDocument(applied.document);
      return applied.document;
    },
  } as unknown as EditorState;
  return <StyleInspectorPanel editor={editor} tokens={TOKENS} />;
}

describe("where focus goes as a field changes shape", () => {
  it("lands on the field's ◇ once a pick turns the field into the chip", async () => {
    register({ typography: true });
    render(<LivePanel values={{}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Font size" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    const chip = await screen.findByRole("group", { name: "Font size" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        fieldsOf("fontSize").getByRole("button", {
          name: "Variables for Font size",
        })
      )
    );
    expect(chip.textContent).toBe("Display 48px");
  });

  it("lands on the typed field once ✕ removes the variable", async () => {
    register({ typography: true });
    render(
      <LivePanel values={{ fontSize: { $token: "font-size.display" } }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Font size" }));
    const field = await screen.findByLabelText("Font size");
    await waitFor(() => expect(document.activeElement).toBe(field));
  });
});

/**
 * The device's colour-scheme preference, as `matchMedia` answers it. jsdom
 * has no `matchMedia`, so without this every test reads as light.
 */
function deviceIsDark(dark: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/** A canvas root under a page root pinned to one mode, as the editor writes it. */
function canvasPinnedTo(mode: "light" | "dark"): () => void {
  const page = document.createElement("div");
  page.setAttribute("data-nx-theme", mode);
  const canvas = document.createElement("div");
  canvas.className = "nx-canvas";
  page.append(canvas);
  document.body.append(page);
  return () => page.remove();
}

describe("the mode a field's variables are read in", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  /** A length whose light value is not a length, so only dark offers it. */
  const NIGHT: SiteTokenSet = {
    tokens: [
      {
        name: "space.night",
        kind: "dimension",
        values: { light: "#ff0000", dark: "12px" },
      },
      {
        name: "space.day",
        kind: "dimension",
        values: { light: "12px", dark: "#ff0000" },
      },
      {
        name: "font-size.mode",
        kind: "dimension",
        values: { light: "16px", dark: "24px" },
      },
      {
        name: "color.ink",
        kind: "color",
        values: { light: "#111111", dark: "#eeeeee" },
      },
    ],
  };

  it("in dark, a typed name picks what the picker offers there, and nothing else", async () => {
    deviceIsDark(true);
    const editor = mount({ spacing: true }, {}, NIGHT);
    const field = fieldsOf("padding").getByLabelText("Block start");
    // Let the device's preference arrive, as it does after mount.
    await waitFor(() =>
      expect(
        fieldsOf("padding").getAllByRole("button", { name: /^Variables for/ })
      ).not.toHaveLength(0)
    );
    fireEvent.change(field, { target: { value: "night" } });
    fireEvent.blur(field);
    expect(written(editor)).toContain('{"$token":"space.night"}');

    fireEvent.change(field, { target: { value: "day" } });
    fireEvent.blur(field);
    expect(written(editor)).not.toContain('{"$token":"space.day"}');
  });

  it("follows the device when no marker pins the canvas", async () => {
    deviceIsDark(true);
    mount({ typography: true }, {}, NIGHT);
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Font size" })
    );
    expect(
      await screen.findByRole("option", { name: "Mode 24px" })
    ).toBeDefined();
  });

  it("follows a canvas pinned dark on a light device, in the list and the chip", async () => {
    deviceIsDark(false);
    const unpin = canvasPinnedTo("dark");
    try {
      mount(
        { typography: true },
        { fontSize: { $token: "font-size.mode" } },
        NIGHT
      );
      const chip = fieldsOf("fontSize").getByRole("group", {
        name: "Font size",
      });
      await waitFor(() => expect(chip.textContent).toBe("Mode 24px"));
      fireEvent.click(
        screen.getByRole("button", { name: "Variables for Font size" })
      );
      expect(screen.getByRole("option", { name: "Mode 24px" })).toBeDefined();
    } finally {
      unpin();
    }
  });

  it("follows a canvas pinned light on a dark device", async () => {
    deviceIsDark(true);
    const unpin = canvasPinnedTo("light");
    try {
      mount({ typography: true }, {}, NIGHT);
      fireEvent.click(
        screen.getByRole("button", { name: "Variables for Font size" })
      );
      // Given time for the device's dark answer to arrive, the pin still wins.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(screen.getByRole("option", { name: "Mode 16px" })).toBeDefined();
    } finally {
      unpin();
    }
  });

  it("paints the colour picker's variables in the same pinned mode", async () => {
    deviceIsDark(false);
    const unpin = canvasPinnedTo("dark");
    try {
      mount({ color: { text: true } }, {}, NIGHT);
      fireEvent.click(
        fieldsOf("color").getByRole("button", { name: /^Colour for/ })
      );
      const ink = await screen.findByRole("option", { name: "Ink" });
      await waitFor(() =>
        expect(
          (
            ink.querySelector(".nx-vars__swatch--main") as HTMLElement
          ).style.getPropertyValue("--nx-swatch")
        ).toBe("#eeeeee")
      );
    } finally {
      unpin();
    }
  });
});

describe("a held variable whose name another shares", () => {
  it("is named on the chip as the list names it, with what tells them apart", () => {
    const twins: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.display",
          label: "Big",
          kind: "dimension",
          values: { light: "48px" },
        },
        {
          name: "font-size.hero",
          label: "Big",
          kind: "dimension",
          values: { light: "48px" },
        },
      ],
    };
    mount(
      { typography: true },
      { fontSize: { $token: "font-size.hero" } },
      twins
    );
    const chip = fieldsOf("fontSize").getByRole("group", {
      name: "Font size",
    });
    expect(chip.textContent).toBe("Big (font-size.hero) 48px");
    expect(
      within(chip).getByRole("button", {
        name: "Clear Font size",
      })
    ).toBeDefined();
    fireEvent.click(
      fieldsOf("fontSize").getByRole("button", {
        name: "Variables for Font size",
      })
    );
    expect(
      screen.getByRole("option", { name: "Big (font-size.hero) 48px" })
    ).toBeDefined();
  });
});

describe("a spacing side holding a variable", () => {
  it("names it, opens the list from the name, and clears it, with no separate ◇", () => {
    // Drawn as the box only where the element's axes are known.
    register({ spacing: true });
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/box",
          version: 1,
          props: {},
          styles: {
            base: {
              [BASE_BREAKPOINT]: {
                padding: { blockStart: { $token: "space.sm" } },
              },
            },
          } as NodeStyles,
        },
      ] as BlockNode[],
    } as BlockDocument);
    render(
      <StyleInspectorPanel
        editor={editor}
        tokens={TOKENS}
        sideOrientation={{ writingMode: "horizontal-tb", direction: "ltr" }}
      />
    );
    const padding = fieldsOf("padding");
    expect(document.querySelector(".nx-spacing-box")).not.toBeNull();
    // A side of the box is named by its place on screen.
    const chip = padding.getByRole("group", { name: "Padding top" });
    // The name is the way to choose another, as a colour's trigger is.
    const choose = within(chip).getByRole("button", {
      name: /^Variables for Padding .+: Sm$/,
    });
    // No ◇ beside it: the side has room for the name and its clear alone.
    const side = chip.closest("[data-side]") as HTMLElement;
    expect(
      within(side).queryByRole("button", { name: /^Variables for [^:]+$/ })
    ).toBeNull();
    fireEvent.click(choose);
    fireEvent.click(screen.getByRole("option", { name: "Space 4 1rem" }));
    expect(written(editor)).toContain('{"$token":"space.4"}');
    fireEvent.click(
      within(chip).getByRole("button", { name: /^Clear Padding/ })
    );
    expect(editor.applyAll).toHaveBeenCalledTimes(2);
  });
});

describe("the source caption after a variable is picked", () => {
  it("is held back after a pick, and shown again when the author focuses the field", async () => {
    register({ typography: true });
    render(<LivePanel values={{}} />);
    const field = () =>
      document.querySelector(
        '[data-property="fontSize"] .nx-inspector__field'
      ) as HTMLElement;
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Font size" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    await screen.findByRole("group", { name: "Font size" });
    // Focus lands in the field after the pick; that is not the author's.
    await waitFor(() =>
      expect(field().contains(document.activeElement)).toBe(true)
    );
    expect(field().hasAttribute("data-provenance-quiet")).toBe(true);

    // The author comes back to it from elsewhere.
    const elsewhere = screen.getByRole("button", {
      name: "Variables for Line height",
    });
    elsewhere.focus();
    fireEvent.focusIn(
      within(field()).getByRole("button", { name: "Clear Font size" }),
      { relatedTarget: elsewhere }
    );
    expect(field().hasAttribute("data-provenance-quiet")).toBe(false);
  });
});

describe("one reading of the canvas's mode for the whole panel", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("asks the device once, however many fields the panel draws", async () => {
    const asked = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: asked,
    });
    mount({ typography: true, spacing: true, border: { radius: true } });
    // Many fields, each with a ◇ or a typed-name match that reads the mode.
    expect(
      screen.getAllByRole("button", { name: /^Variables for/ }).length
    ).toBeGreaterThan(4);
    await waitFor(() => expect(asked).toHaveBeenCalled());
    const scheme = asked.mock.calls.filter(([query]) =>
      query.includes("prefers-color-scheme")
    );
    expect(scheme).toHaveLength(1);
  });

  it("reads the mode where the selected block is drawn, under a nested marker", async () => {
    deviceIsDark(false);
    const canvas = document.createElement("div");
    canvas.className = "nx-canvas";
    const nested = document.createElement("div");
    nested.setAttribute("data-nx-theme", "dark");
    const node = document.createElement("div");
    node.setAttribute("data-nx-node", "a");
    nested.append(node);
    canvas.append(nested);
    document.body.append(canvas);
    try {
      mount(
        { typography: true },
        {},
        {
          tokens: [
            {
              name: "font-size.mode",
              kind: "dimension",
              values: { light: "16px", dark: "24px" },
            },
          ],
        }
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Variables for Font size" })
      );
      expect(
        await screen.findByRole("option", { name: "Mode 24px" })
      ).toBeDefined();
    } finally {
      canvas.remove();
    }
  });
});

describe("a folded field in the panel", () => {
  it("offers a font weight only the number variables its number form takes", () => {
    mount(
      { typography: true },
      {},
      {
        tokens: [
          { name: "weight.heavy", kind: "number", values: { light: "700" } },
          { name: "weight.over", kind: "number", values: { light: "1500" } },
        ],
      }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Font weight" })
    );
    const names = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(names).toContain("Heavy 700");
    expect(names.some(text => text?.startsWith("Over"))).toBe(false);
  });
});

describe("the source caption after the value changes elsewhere", () => {
  it("is held back when an undo or another edit changes the value", () => {
    register({ typography: true });
    const at = (fontSize: string): BlockDocument =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "acme/box",
            version: 1,
            props: {},
            styles: {
              base: { [BASE_BREAKPOINT]: { fontSize } },
            } as NodeStyles,
          },
        ] as BlockNode[],
      }) as BlockDocument;
    const { rerender } = render(
      <StyleInspectorPanel editor={editorFor(at("20px"))} tokens={TOKENS} />
    );
    const row = () =>
      document.querySelector(
        '[data-property="fontSize"] .nx-inspector__field'
      ) as HTMLElement;
    expect(row().hasAttribute("data-provenance-quiet")).toBe(false);
    // The document moves without a commit in this field, as an undo does.
    rerender(
      <StyleInspectorPanel editor={editorFor(at("24px"))} tokens={TOKENS} />
    );
    expect(row().hasAttribute("data-provenance-quiet")).toBe(true);
  });
});
