// @vitest-environment jsdom

/**
 * A placement's setting bound to data from its inspector: the bind button on
 * a text, link or image setting, the picker listing the list's entry first
 * for a placement inside a list, the binding written on the placement under
 * the setting's key, and an unbind that keeps the setting's stored value.
 */
import {
  applyOp,
  clearBlocks,
  COLLECTION_LIST_TYPE,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  LIST_ENTRY_SLOT,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { BindingFieldSource } from "./binding-services";
import type { ContentServices, LoopCollection } from "./content-controls";
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

const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "entry" },
    label: "Page",
    fields: [{ name: "title", type: "text", public: true, preview: "Jobs" }],
  },
];

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [],
  readable: [{ name: "title", type: "text" }],
};

/** A card whose title and tone are its settings. */
const CARD: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "t",
      type: "acme/card-title",
      version: 1,
      props: { text: "Card title", tone: "light" },
    },
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "t",
      propPath: "text",
      type: "text",
    },
    {
      id: "tone",
      label: "Tone",
      nodeId: "t",
      propPath: "tone",
      type: "select",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
  ],
} as ComponentDocument;

/** The card placed in a Posts list's entry, as given. */
function mount(
  placement: Partial<BlockNode> = {}
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  registerBlocks(
    [
      {
        name: "acme/card-title",
        version: 1,
        description: "A title.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: {
          text: { label: "Text", role: "content", type: "text" },
          tone: { label: "Tone", type: "select", options: ["light", "dark"] },
        },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "instance-panel-binding-test" }
  );
  const node = {
    id: "p",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "card" },
    ...placement,
  } as BlockNode;
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "list",
        type: COLLECTION_LIST_TYPE,
        version: 1,
        props: { collection: "posts", limit: 3 },
        slots: { [LIST_ENTRY_SLOT]: [node] },
      },
    ],
  } as BlockDocument;
  let current = document;
  const editor = {
    document,
    selectedId: "p",
    selection: { ids: ["p"], primary: "p" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn((op: BuilderOp) => {
      current = applyOp(current, op).document;
      return current;
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  const services: ContentServices = {
    listBindingFields: async () => SOURCES,
    listLoopCollections: async () => [POSTS],
    readListSample: async () => ({ title: "Highway 9 realignment" }),
  };
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{
        definitions: new Map([["card", CARD]]),
        components: [{ id: "card", title: "Card", document: CARD }],
      }}
      contentServices={services}
    />
  );
  return editor;
}

describe("a placement's setting bound to data", () => {
  it("binds the Title setting to each post's title, under the setting's key, naming the list", async () => {
    const editor = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Bind Title to a field" })
    );
    const list = await screen.findByRole("listbox", {
      name: "Fields for Title",
    });
    // The list's entry first, for a placement inside a list.
    const item = await within(list).findByRole("group", {
      name: "Each post in the list",
    });
    expect(within(list).getAllByRole("group")[0]).toBe(item);
    fireEvent.click(
      await within(item).findByRole("option", { name: /^Title/ })
    );
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "p",
      patch: {
        // The list is named: composing moves the binding onto the card's
        // block, which may sit in a list of the card's own.
        bindings: {
          "overrides.title": { $bind: "title", source: "item", list: "list" },
        },
      },
    });
  });

  it("offers no binding for a setting no field fills", () => {
    mount();
    expect(screen.getByRole("button", { name: "Bind Title to a field" }));
    expect(
      screen.queryByRole("button", { name: "Bind Tone to a field" })
    ).toBeNull();
  });

  it("shows a bound setting as its field, in place of its value", async () => {
    mount({
      bindings: {
        "overrides.title": { $bind: "title", source: "item", list: "list" },
      },
    });
    expect(
      await screen.findByRole("button", {
        name: /^Title: bound to Title of each post/,
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Bind Title to a field" })
    ).toBeNull();
  });

  it("unbinds and keeps the value the placement stores for the setting", async () => {
    const editor = mount({
      props: { componentId: "card", overrides: { title: "Typed here" } },
      bindings: {
        "overrides.title": { $bind: "title", source: "item", list: "list" },
      },
    });
    const chip = await screen.findByRole("button", {
      name: /^Title: bound to/,
    });
    fireEvent.keyDown(chip, { key: "Enter" });
    const unbind = await screen.findByRole("menuitem", {
      name: "Unbind, keep the title",
    });
    fireEvent.pointerUp(unbind, { pointerType: "mouse", button: 0 });
    await waitFor(() =>
      expect(editor.apply).toHaveBeenCalledWith({
        kind: "update",
        id: "p",
        patch: {
          props: { componentId: "card", overrides: { title: "Typed here" } },
        },
        unset: ["bindings"],
      })
    );
  });

  it("holds the bind button while the placement is locked", () => {
    mount({ locked: true });
    expect(
      (
        screen.getByRole("button", {
          name: "Bind Title to a field",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
