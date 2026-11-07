// @vitest-environment jsdom

/**
 * A bound prop's Format row: drawn for a text prop bound to a date or a
 * number and for nothing else, offering what the engine's `checkFormat`
 * accepts for that field, writing the chosen preset as the binding's
 * `format`, and showing a stored format the engine refuses as refused.
 */
import {
  clearBlocks,
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  BindingFieldChoice,
  BindingFieldSource,
} from "./binding-services";
import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // What Radix's select asks of an element, which jsdom does not draw.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
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

const FIELDS: readonly BindingFieldChoice[] = [
  { name: "title", type: "text", public: true },
  { name: "publishedAt", type: "date", public: true },
  { name: "eventDay", type: "date", dateOnly: true, public: true },
  { name: "price", type: "number", public: true },
];

const SOURCES: readonly BindingFieldSource[] = [
  { binding: { source: "entry" }, label: "Post", fields: FIELDS },
];

/**
 * A block with one text prop, bound as given, over a mocked editor; inside a
 * list of `inList`'s collection when given, for an item binding.
 */
function mount(
  bindings: BlockNode["bindings"],
  inList?: { collection: string; services: Partial<ContentServices> }
): EditorState {
  registerBlocks(
    [
      {
        name: "acme/badge",
        version: 1,
        description: "A badge.",
        example: { props: {} },
        editor: { label: "Badge" },
        props: { label: { label: "Text", role: "content", type: "text" } },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "binding-format-test" }
  );
  const badge = {
    id: "a",
    type: "acme/badge",
    version: 1,
    props: {},
    bindings,
  } as BlockNode;
  // The list as the engine finds an item's list: the block in its entry slot.
  const list = {
    id: "list",
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props: { collection: inList?.collection },
    slots: { [LIST_ENTRY_SLOT]: [badge] },
  } as BlockNode;
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [inList === undefined ? badge : list],
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
  } as unknown as EditorState;
  render(
    <InspectorPanel
      editor={editor}
      contentServices={{
        listBindingFields: async () => SOURCES,
        ...inList?.services,
      }}
    />
  );
  return editor;
}

/** The Format menu, once the fields are read and the chip drawn. */
async function formatMenu(): Promise<HTMLElement> {
  return screen.findByRole("combobox", { name: "Format" });
}

/** The presets the open menu lists, by name. */
function listed(): string[] {
  return screen.getAllByRole("option").map(option => option.textContent ?? "");
}

describe("a bound prop's Format", () => {
  it("is offered for a date and a number, saying what an unset one means", async () => {
    mount({ label: { $bind: "publishedAt" } });
    expect(await formatMenu()).toBeTruthy();
    expect(
      screen.getByText(/^A date shows as text only through a format/)
    ).toBeTruthy();
    cleanup();
    clearBlocks();
    mount({ label: { $bind: "price" } });
    expect(await formatMenu()).toBeTruthy();
  });

  it("is not offered for a text field", async () => {
    // The control: the same prop bound to text, its chip drawn once the
    // fields are read, and no Format.
    mount({ label: { $bind: "title" } });
    await screen.findByRole("button", {
      name: "Text: bound to Title of this post",
    });
    expect(screen.queryByRole("combobox", { name: "Format" })).toBeNull();
  });

  it("offers only what the field can show: no time for a calendar date", async () => {
    mount({ label: { $bind: "eventDay" } });
    fireEvent.click(await formatMenu());
    const day = listed();
    expect(day).toContain("Long date");
    expect(day).not.toContain("Date and time");
    expect(day).not.toContain("Time");
    cleanup();
    clearBlocks();
    // A date-time can be shown with its time.
    mount({ label: { $bind: "publishedAt" } });
    fireEvent.click(await formatMenu());
    expect(listed()).toEqual(
      expect.arrayContaining(["Long date", "Date and time", "Time"])
    );
  });

  it("writes the chosen preset as the binding's format, keeping its fallback", async () => {
    const editor = mount({
      label: { $bind: "publishedAt", fallback: "Soon" },
    });
    fireEvent.click(await formatMenu());
    fireEvent.click(screen.getByRole("option", { name: "Long date" }));
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      kind: "update",
      id: "a",
      patch: {
        bindings: {
          label: {
            $bind: "publishedAt",
            fallback: "Soon",
            format: { type: "date", options: { dateStyle: "long" } },
          },
        },
      },
    });
  });

  it("shows a stored format the engine refuses as refused, in its words", async () => {
    mount({
      label: { $bind: "price", format: { type: "currency", currency: "ZZZ" } },
    });
    const menu = await formatMenu();
    expect(menu.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "A currency format needs a three-letter ISO 4217 code, such as EUR."
    );
  });

  it("names a format set elsewhere in full on the menu's tooltip", async () => {
    // Accepted by the engine, named by no preset: the value is cut where the
    // panel is narrow, so its whole words are on the trigger's title.
    mount({
      label: {
        $bind: "publishedAt",
        format: { type: "date", options: { dateStyle: "medium" } },
      },
    });
    const menu = await formatMenu();
    expect(menu.textContent).toBe("Set elsewhere");
    expect(menu.getAttribute("title")).toBe("Set elsewhere");
  });

  it("titles a preset's menu with its own words", async () => {
    // The control: the title follows the value shown, not one fixed text.
    mount({
      label: {
        $bind: "publishedAt",
        format: { type: "date", options: { dateStyle: "long" } },
      },
    });
    expect((await formatMenu()).getAttribute("title")).toBe("Long date");
  });

  it("shows a stored format the engine accepts as it is", async () => {
    // The control for the refusal above: a known code, the same row.
    mount({
      label: { $bind: "price", format: { type: "currency", currency: "EUR" } },
    });
    const menu = await formatMenu();
    expect(menu.getAttribute("aria-invalid")).toBeNull();
    expect(menu.textContent).toBe("Currency");
    expect(
      (screen.getByRole("textbox", { name: "Code" }) as HTMLInputElement).value
    ).toBe("EUR");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses an empty currency code, writing nothing and saying why", async () => {
    const editor = mount({
      label: { $bind: "price", format: { type: "currency", currency: "EUR" } },
    });
    await formatMenu();
    const code = screen.getByRole("textbox", { name: "Code" });
    fireEvent.change(code, { target: { value: "" } });
    fireEvent.blur(code);
    expect(screen.getByRole("alert").textContent).toBe(
      "A currency format needs a three-letter ISO 4217 code, such as EUR."
    );
    expect(code.getAttribute("aria-invalid")).toBe("true");
    // The stored code stays the binding's: nothing is written.
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("lets a currency only picked go when its code is left empty", async () => {
    // Picked, never stored: left empty, the menu shows again what the
    // binding holds (no format) rather than a currency it doesn't.
    const editor = mount({ label: { $bind: "price" } });
    fireEvent.click(await formatMenu());
    fireEvent.click(screen.getByRole("option", { name: "Currency" }));
    const code = await screen.findByRole("textbox", { name: "Code" });
    fireEvent.blur(code);
    expect(screen.getByRole("alert").textContent).toBe(
      "A currency format needs a three-letter ISO 4217 code, such as EUR."
    );
    expect((await formatMenu()).textContent).toBe("Choose a format");
    expect(screen.queryByRole("textbox", { name: "Code" })).toBeNull();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("writes a currency once a known code is given", async () => {
    // The control for the two above: the same pick, a code typed.
    const editor = mount({ label: { $bind: "price" } });
    fireEvent.click(await formatMenu());
    fireEvent.click(screen.getByRole("option", { name: "Currency" }));
    const code = await screen.findByRole("textbox", { name: "Code" });
    fireEvent.change(code, { target: { value: "usd" } });
    fireEvent.blur(code);
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      patch: {
        bindings: {
          label: {
            $bind: "price",
            format: { type: "currency", currency: "USD" },
          },
        },
      },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is offered for a list item bound to a number, by the list's collection", async () => {
    // A list's item is no source the picker lists: its fields are the list
    // collection's, as the host lists that collection for a list.
    mount(
      { label: { $bind: "price", source: "item" } },
      {
        collection: "bound-entries",
        services: {
          listLoopCollections: async () => [
            {
              slug: "bound-entries",
              label: "Blog posts",
              singular: "Blog post",
              fields: [],
              readable: [
                { name: "title", type: "text" },
                { name: "price", label: "Price", type: "number" },
              ],
            },
          ],
        },
      }
    );
    expect(
      await screen.findByRole("button", {
        name: "Text: bound to Price of each blog post in the list",
      })
    ).toBeTruthy();
    fireEvent.click(await formatMenu());
    expect(listed()).toContain("Currency");
  });

  it("is not offered for a list item bound to text", async () => {
    // The control for the item above: the same list, a text field.
    mount(
      { label: { $bind: "title", source: "item" } },
      {
        collection: "bound-entries",
        services: {
          listLoopCollections: async () => [
            {
              slug: "bound-entries",
              label: "Blog posts",
              fields: [],
              readable: [{ name: "title", type: "text" }],
            },
          ],
        },
      }
    );
    await screen.findByRole("button", {
      name: /^Text: bound to Title of each/,
    });
    expect(screen.queryByRole("combobox", { name: "Format" })).toBeNull();
  });
});
