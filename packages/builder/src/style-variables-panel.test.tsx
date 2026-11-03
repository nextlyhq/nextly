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
    { name: "radius.card", kind: "dimension", values: { light: "12px" } },
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

  it("hints that a variable may be chosen, where one can be", () => {
    mount({ typography: true });
    expect(
      (screen.getByLabelText("Font size") as HTMLInputElement).placeholder
    ).toBe("16px or 50% or a variable");
  });

  it("keeps the hint as it was where no variable can be chosen", () => {
    mount({ effects: true });
    expect(
      (screen.getByLabelText("Opacity") as HTMLInputElement).placeholder
    ).toBe("0 to 1");
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
    fireEvent.click(
      within(chip).getByRole("button", {
        name: "Remove Display from Font size",
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
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Display from Font size" })
    );
    const field = await screen.findByLabelText("Font size");
    await waitFor(() => expect(document.activeElement).toBe(field));
  });
});
