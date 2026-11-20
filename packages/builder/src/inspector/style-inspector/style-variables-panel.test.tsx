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

import type { EditorState } from "../../editor-state";
import { applyOps, type BuilderOp } from "../../ops";
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
    [
      "font size",
      { typography: true },
      "fontSize",
      "Font size",
      "Display 48px",
    ],
    [
      "a spacing side",
      { spacing: true },
      "padding",
      "Padding block start",
      "Sm 8px",
    ],
    [
      "a radius",
      { border: { radius: true } },
      "borderRadius",
      "Border radius",
      "Pill 12px",
    ],
  ] as const)(
    "lists the site's variables first in the unit menu of %s, with no button of their own",
    (_, supports, property, label, variable) => {
      mount(supports);
      const field = fieldsOf(property);
      expect(
        field.queryByRole("button", { name: /^Variables for/ })
      ).toBeNull();
      fireEvent.click(
        field.getByRole("combobox", { name: `Unit for ${label}` })
      );
      const options = screen
        .getAllByRole("option")
        .map(option => option.textContent);
      expect(options).toContain(variable);
      expect(options).toContain("px");
      // Every variable before the first unit.
      expect(options.indexOf(variable)).toBeLessThan(options.indexOf("px"));
    }
  );

  it('heads the spacing steps "Your spacing" and other lengths "Your sizes"', () => {
    mount({ spacing: true });
    fireEvent.click(
      fieldsOf("padding").getByRole("combobox", {
        name: "Unit for Padding block start",
      })
    );
    const spacing = screen.getByRole("group", { name: "Your spacing" });
    expect(
      within(spacing).getByRole("option", { name: "Sm 8px" })
    ).toBeDefined();
    cleanup();
    clearBlocks();
    mount({ typography: true });
    fireEvent.click(
      fieldsOf("fontSize").getByRole("combobox", { name: "Unit for Font size" })
    );
    const sizes = screen.getByRole("group", { name: "Your sizes" });
    expect(
      within(sizes).getByRole("option", { name: "Display 48px" })
    ).toBeDefined();
  });

  it("offers a line height's variables from a menu at its end, as it has no unit menu", () => {
    mount({ typography: true });
    const menu = fieldsOf("lineHeight").getByRole("button", {
      name: "Variables for Line height",
    });
    // A chevron, never a ◇.
    expect(menu.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(menu.querySelector(".lucide-diamond")).toBeNull();
  });

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
    // The unit menu holds its units alone.
    fireEvent.click(
      screen.getByRole("combobox", { name: "Unit for Font size" })
    );
    expect(screen.getAllByRole("option")[0]?.textContent).toBe("px");
    expect(screen.queryByRole("group", { name: /^Your / })).toBeNull();
  });

  it("lists the type size in a font size field, not its line height", () => {
    mount({ typography: true });
    fireEvent.click(
      screen.getByRole("combobox", { name: "Unit for Font size" })
    );
    const list = screen.getByRole("listbox");
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
      screen.getByRole("combobox", { name: "Unit for Font size" })
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

  it("keeps the hint short, the unit menu being where a variable is chosen", () => {
    // "16 or a variable" was cut off in the field.
    mount({ typography: true });
    expect(
      (screen.getByLabelText("Font size") as HTMLInputElement).placeholder
    ).toBe("16");
    expect(
      screen.getByRole("combobox", { name: "Unit for Font size" })
    ).toBeDefined();
  });

  it("offers the variables on a field that holds a value, and a pick replaces it", () => {
    const editor = mount({ typography: true }, { fontSize: "20px" });
    fireEvent.click(
      screen.getByRole("combobox", { name: "Unit for Font size" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    expect(written(editor)).toContain(
      '"fontSize":{"$token":"font-size.display"}'
    );
  });

  it("opens on the variables alone over a value no unit can act on", () => {
    // A unit choice over `calc()` would do nothing, so no unit is listed; the
    // menu stays, as the way to the variables.
    mount({ typography: true }, { fontSize: "calc(1rem + 2px)" });
    expect(
      screen.queryByRole("combobox", { name: "Unit for Font size" })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Variables for Font size" })
    );
    const options = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(options).toContain("Display 48px");
    expect(options).not.toContain("px");
  });

  it("offers a spacing side the spacing steps, not the radii", () => {
    mount({ spacing: true });
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Unit for Padding block start",
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
      screen.getByRole("combobox", { name: "Unit for Border radius" })
    );
    expect(
      within(screen.getByRole("group", { name: "Your sizes" }))
        .getAllByRole("option")
        .map(option => option.textContent)
    ).toEqual(["Pill 12px"]);
    expect(screen.queryByRole("group", { name: "Your spacing" })).toBeNull();
  });
});

describe("a field holding a variable", () => {
  it("shows the variable by name in a green chip in place of the text, and Unlink keeps its value", async () => {
    const editor = mount(
      { typography: true },
      { fontSize: { $token: "font-size.display" } }
    );
    const fontSize = fieldsOf("fontSize");
    expect(fontSize.queryByRole("textbox")).toBeNull();
    const chip = fontSize.getByRole("group", { name: "Font size" });
    expect(chip.classList.contains("nx-variable-chip")).toBe(true);
    // A type size reads as its name and pair.
    expect(chip.textContent).toBe("Display · 48 / 56px");
    // The name the author gave it, never the code path it is stored under;
    // the whole of what it is in the name's tooltip, never a title.
    expect(fontSize.queryByText(/font-size\.display/)).toBeNull();
    expect(chip.getAttribute("title")).toBeNull();
    const name = within(chip).getByRole("button", {
      name: "Variables for Font size: Display · 48 / 56px",
    });
    fireEvent.keyDown(document.body, { key: "Tab" });
    name.focus();
    expect((await screen.findAllByRole("tooltip"))[0]?.textContent).toBe(
      "Type size variable Display · 48px · --site-font-size-display"
    );
    // No ✕: removing the value is the row's Reset.
    expect(
      within(chip).queryByRole("button", { name: "Clear Font size" })
    ).toBeNull();
    fireEvent.click(
      within(chip).getByRole("button", { name: "Unlink Font size" })
    );
    // One commit, writing the value as a plain one.
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).toContain('"fontSize":"48px"');
    expect(written(editor)).not.toContain("font-size.display");
  });

  it("unlinks a scaled reference to the value it draws", () => {
    const editor = mount(
      { spacing: true },
      { padding: { blockStart: { $token: "space.sm", times: 0.75 } } }
    );
    fireEvent.click(
      fieldsOf("padding").getByRole("button", {
        name: "Unlink Padding block start",
      })
    );
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).toContain('"blockStart":"6px"');
  });

  it("chooses another variable from the chip's name", () => {
    const editor = mount(
      { spacing: true },
      { padding: { blockStart: { $token: "space.sm" } } }
    );
    const padding = fieldsOf("padding");
    expect(
      padding.queryByRole("button", {
        name: /^Variables for Padding block start$/,
      })
    ).toBeNull();
    fireEvent.click(
      padding.getByRole("button", {
        name: "Variables for Padding block start: Sm",
      })
    );
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
  it("lands on the colour field, holding the colour, once Unlink keeps it", async () => {
    register({ color: { text: true } });
    render(<LivePanel values={{ color: { $token: "color.ink" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Unlink Colour" }));
    const field = (await waitFor(() =>
      fieldsOf("color").getByRole("textbox")
    )) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.value).toBe("#111111");
  });

  it("lands on the chip's name once a pick from the unit menu turns the field into the chip", async () => {
    register({ typography: true });
    render(<LivePanel values={{}} />);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Unit for Font size" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    const chip = await screen.findByRole("group", { name: "Font size" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        fieldsOf("fontSize").getByRole("button", {
          name: "Variables for Font size: Display · 48 / 56px",
        })
      )
    );
    // A type size reads as its name and pair.
    expect(chip.textContent).toBe("Display · 48 / 56px");
    // Focus a script moved after a mouse pick opens no tooltip over the
    // field just changed: it would take the Escape that leaves the panel.
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lands on the typed field, holding the value, once Unlink keeps it", async () => {
    register({ typography: true });
    render(
      <LivePanel values={{ fontSize: { $token: "font-size.display" } }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlink Font size" }));
    const field = (await screen.findByLabelText(
      "Font size"
    )) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    // Shown beside its unit, as any typed length is.
    expect(field.value).toBe("48");
    expect(
      screen.getByRole("combobox", { name: "Unit for Font size" }).textContent
    ).toContain("px");
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
    // Let the device's preference arrive, as it does after mount: the unit
    // menu offers the dark-only variable once it has.
    fireEvent.click(
      fieldsOf("padding").getByRole("combobox", {
        name: "Unit for Padding block start",
      })
    );
    expect(
      await screen.findByRole("option", { name: "Night 12px" })
    ).toBeDefined();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
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
      screen.getByRole("combobox", { name: "Unit for Font size" })
    );
    expect(
      await screen.findByRole("option", { name: "Mode 24px" })
    ).toBeDefined();
  });

  it("follows a canvas pinned dark on a light device, in the list and the chip", async () => {
    deviceIsDark(false);
    const unpin = canvasPinnedTo("dark");
    try {
      const editor = mount(
        { typography: true },
        { fontSize: { $token: "font-size.mode" } },
        NIGHT
      );
      const chip = fieldsOf("fontSize").getByRole("group", {
        name: "Font size",
      });
      await waitFor(() => expect(chip.textContent).toBe("Mode · 24"));
      fireEvent.click(
        screen.getByRole("button", {
          name: "Variables for Font size: Mode · 24",
        })
      );
      expect(screen.getByRole("option", { name: "Mode 24px" })).toBeDefined();
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
      // Unlink keeps the value the canvas shows, the dark one.
      fireEvent.click(screen.getByRole("button", { name: "Unlink Font size" }));
      expect(written(editor)).toContain('"fontSize":"24px"');
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
        screen.getByRole("combobox", { name: "Unit for Font size" })
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
    expect(chip.textContent).toBe("Big (font-size.hero) · 48");
    expect(
      within(chip).getByRole("button", {
        name: "Unlink Font size",
      })
    ).toBeDefined();
    fireEvent.click(
      fieldsOf("fontSize").getByRole("button", {
        name: "Variables for Font size: Big (font-size.hero) · 48",
      })
    );
    expect(
      screen.getByRole("option", { name: "Big (font-size.hero) 48px" })
    ).toBeDefined();
  });
});

describe("a spacing side holding a variable", () => {
  it("names it in green, marks it among the popover's presets, and changes it there", () => {
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
    // A side of the box is named by its place on screen, then its value.
    const side = padding.getByRole("button", { name: "Padding top Sm" });
    expect(side.hasAttribute("data-bound")).toBe(true);
    // No ◇ in the box: the side's popover is the way to choose another.
    expect(
      padding.queryByRole("button", { name: /^Variables for / })
    ).toBeNull();
    fireEvent.click(side);
    const presets = screen.getByRole("radiogroup", { name: "Presets" });
    expect(
      within(presets)
        .getByRole("radio", { name: "Sm 8px" })
        .getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(
      within(presets).getByRole("radio", { name: "Space 4 1rem" })
    );
    expect(written(editor)).toContain('{"$token":"space.4"}');
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
      screen.getByRole("combobox", { name: "Unit for Font size" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    await screen.findByRole("group", { name: "Font size" });
    // Focus lands in the field after the pick; that is not the author's.
    await waitFor(() =>
      expect(field().contains(document.activeElement)).toBe(true)
    );
    expect(field().hasAttribute("data-provenance-quiet")).toBe(true);

    // The author comes back to it from elsewhere: the line height, which the
    // type size picked set as well.
    const elsewhere = screen.getByRole("button", {
      name: /^Variables for Line height/,
    });
    elsewhere.focus();
    fireEvent.focusIn(
      within(field()).getByRole("button", { name: "Unlink Font size" }),
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
    // Many fields, each with a value menu or a typed-name match that reads
    // the mode.
    expect(
      screen.getAllByRole("combobox", { name: /^Unit for/ }).length
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
        screen.getByRole("combobox", { name: "Unit for Font size" })
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
  it("offers a font weight only the number variables its number form takes, first in its list", () => {
    const editor = mount(
      { typography: true },
      {},
      {
        tokens: [
          { name: "weight.heavy", kind: "number", values: { light: "700" } },
          { name: "weight.over", kind: "number", values: { light: "1500" } },
        ],
      }
    );
    const weight = fieldsOf("fontWeight");
    expect(weight.queryByRole("button", { name: /^Variables for/ })).toBeNull();
    fireEvent.click(weight.getByRole("combobox"));
    const names = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(names[0]).toBe("Heavy 700");
    expect(names.some(text => text?.startsWith("Over"))).toBe(false);
    fireEvent.click(screen.getByRole("option", { name: "Heavy 700" }));
    expect(written(editor)).toContain('"fontWeight":{"$token":"weight.heavy"}');
  });
});

describe("a held weight unlinked", () => {
  it("writes a numeric weight variable as the number a weight is stored as", () => {
    const editor = mount(
      { typography: true },
      { fontWeight: { $token: "font-weight.strong" } },
      {
        tokens: [
          {
            name: "font-weight.strong",
            kind: "fontWeight",
            values: { light: "700" },
          },
        ],
      }
    );
    fireEvent.click(
      fieldsOf("fontWeight").getByRole("button", { name: "Unlink Font weight" })
    );
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).toContain('"fontWeight":700');
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
