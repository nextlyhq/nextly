// @vitest-environment jsdom

/**
 * "Make this a setting of the component" from a placement's inspector: the
 * component's text props that are not settings yet, each with a field
 * picker; a pick asks the host to add the setting and binds the placement's
 * new setting to the field in one edit, and a refusal is said and changes
 * nothing.
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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { BindingFieldSource } from "./bindings/binding-services";
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
    {
      id: "k",
      type: "acme/card-title",
      name: "Kicker",
      version: 1,
      props: { text: "New" },
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
  placement: Partial<BlockNode> = {},
  extra: Partial<ContentServices> = {}
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
    ...extra,
  };
  render(
    <InspectorPanel
      editor={editor}
      componentLibrary={{
        definitions: new Map([["card", CARD]]),
        components: [{ id: "card", title: "Card", usedOn: 3, document: CARD }],
      }}
      contentServices={services}
    />
  );
  return editor;
}

/** Pick each post's Title for the Kicker's text, from its row. */
async function pickTitleForKicker(): Promise<void> {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Make Kicker · Text a setting, bound to a field",
    })
  );
  const list = await screen.findByRole("listbox", {
    name: "Fields for Kicker · Text",
  });
  const item = await within(list).findByRole("group", {
    name: "Each post in the list",
  });
  fireEvent.click(await within(item).findByRole("option", { name: /^Title/ }));
}

describe("making a component's prop a setting, from a placement", () => {
  it("lists the component's text props that are not settings yet", () => {
    mount({}, { makeComponentSetting: vi.fn() });
    const section = screen.getByRole("region", {
      name: "Make this a setting of the component",
    });
    // The Heading's text is the Title setting already, so the Kicker's alone.
    expect(
      within(section)
        .getAllByRole("button")
        .map(button => button.getAttribute("aria-label"))
    ).toEqual(["Make Kicker · Text a setting, bound to a field"]);
    // Said once: the change reaches every page placing the component.
    expect(section.textContent).toContain("Card is used on 3 pages");
  });

  it("adds the setting named after the field and binds the placement's new setting, in one edit", async () => {
    const makeComponentSetting = vi.fn(async () => ({ settingId: "title-2" }));
    const editor = mount({}, { makeComponentSetting });
    await pickTitleForKicker();
    await waitFor(() =>
      expect(makeComponentSetting).toHaveBeenCalledWith({
        componentId: "card",
        nodeId: "k",
        propPath: "text",
        label: "Title",
      })
    );
    await waitFor(() => expect(editor.apply).toHaveBeenCalledTimes(1));
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "p",
      patch: {
        // Naming the list around the placement, as every setting binding.
        bindings: {
          "overrides.title-2": { $bind: "title", source: "item", list: "list" },
        },
      },
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "saved with the page"
    );
  });

  it("drops an answer that comes after its row has gone", async () => {
    // The author moved on meanwhile; the row's document is no longer the
    // editor's, and binding against it would undo what they did since.
    let answer: (settingId: string) => void = () => undefined;
    const makeComponentSetting = vi.fn(
      () =>
        new Promise<{ settingId: string }>(resolve => {
          answer = settingId => resolve({ settingId });
        })
    );
    const editor = mount({}, { makeComponentSetting });
    await pickTitleForKicker();
    await waitFor(() => expect(makeComponentSetting).toHaveBeenCalled());
    cleanup();
    await act(async () => {
      answer("kicker");
      await Promise.resolve();
    });
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("says why the host refused, and changes nothing", async () => {
    const makeComponentSetting = vi.fn(async () => ({
      refusal: "Card is locked by someone else.",
    }));
    const editor = mount({}, { makeComponentSetting });
    await pickTitleForKicker();
    expect((await screen.findByRole("status")).textContent).toBe(
      "Card is locked by someone else."
    );
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("offers nothing where the host adds no settings", () => {
    mount();
    expect(
      screen.queryByRole("region", {
        name: "Make this a setting of the component",
      })
    ).toBeNull();
  });

  it("offers nothing while the placement is locked", () => {
    mount({ locked: true }, { makeComponentSetting: vi.fn() });
    expect(
      screen.queryByRole("region", {
        name: "Make this a setting of the component",
      })
    ).toBeNull();
  });
});
