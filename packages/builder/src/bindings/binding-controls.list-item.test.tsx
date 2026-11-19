// @vitest-environment jsdom

/**
 * The field picker for a block inside a collection list's item: the item's
 * own fields first, named for the list's entries ("Each post in the
 * list"), then the page, its Singles and the site; the field bound now marked; and each
 * field's value as the author would see it, a draft's included.
 */
import {
  applyOp,
  clearBlocks,
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { BindingFieldSource } from "./binding-services";
import type {
  ContentServices,
  LoopCollection,
} from "../inspector/content/content-controls";
import type { EditorState } from "../editor-state";
import { InspectorPanel } from "../inspector/inspector-panel";

beforeAll(() => {
  // What the picker asks of an element, which jsdom does not draw: its
  // active option scrolled into view.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** The page's own sources, as the host lists them: the page, a Single, the site. */
const SOURCES: readonly BindingFieldSource[] = [
  {
    binding: { source: "entry" },
    label: "Page",
    fields: [
      // A page not published yet: its title is a draft's, shown with the
      // value the author typed and marked as a draft.
      {
        name: "title",
        type: "text",
        public: true,
        draft: true,
        preview: "QA blocks 3",
      },
    ],
  },
  {
    binding: { source: "single", sourceKey: "homepage" },
    label: "Homepage",
    fields: [{ name: "title", type: "text", public: true, preview: "Home" }],
  },
  {
    binding: { source: "site" },
    label: "Site",
    fields: [
      {
        name: "applicationName",
        type: "text",
        public: true,
        preview: "Foursight",
      },
    ],
  },
];

/** The Posts collection as the host lists it for a list. */
const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [],
  readable: [
    { name: "title", type: "text" },
    { name: "summary", type: "text" },
  ],
};

/** The Categories collection, for a Posts list inside its entries. */
const CATEGORIES: LoopCollection = {
  slug: "categories",
  label: "Categories",
  singular: "Category",
  fields: [],
  readable: [{ name: "name", type: "text" }],
};

/** The list the block sits in, by its stored props. */
const LIST_PROPS = { collection: "posts", limit: 3 };

/**
 * A Heading-like block with one text prop, bound as given, inside the entry
 * slot of a Posts list, or on the page itself with `inList: false`.
 */
function mount(
  bindings: BlockNode["bindings"],
  {
    inList = true,
    inCategories = false,
    services = {},
  }: {
    inList?: boolean;
    /** The Posts list inside a Categories list's entry. */
    inCategories?: boolean;
    services?: Partial<ContentServices>;
  } = {}
): { editor: EditorState; readListSample: ReturnType<typeof vi.fn> } {
  registerBlocks(
    [
      {
        name: "acme/title",
        version: 1,
        description: "A title.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: { text: { label: "Text", role: "content", type: "text" } },
        defaultProps: {},
        render: () => null,
      },
    ] as never,
    { source: "binding-list-item-test" }
  );
  const heading = {
    id: "h",
    type: "acme/title",
    version: 1,
    props: { text: "A section title" },
    ...(bindings === undefined ? {} : { bindings }),
  } as BlockNode;
  const list = {
    id: "list",
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props: LIST_PROPS,
    slots: { [LIST_ENTRY_SLOT]: [heading] },
  } as BlockNode;
  const categories = {
    id: "categories",
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props: { collection: "categories", limit: 3 },
    slots: { [LIST_ENTRY_SLOT]: [list] },
  } as BlockNode;
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [inCategories ? categories : inList ? list : heading],
  } as BlockDocument;
  let current = document;
  const editor = {
    document,
    selectedId: "h",
    selection: { ids: ["h"], primary: "h" },
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
    composed: () => undefined,
  } as unknown as EditorState;
  // The first post as the canvas reads the list: its title and summary.
  const readListSample = vi.fn(async () => ({
    title: "Highway 9 realignment",
    summary: "Topographic survey",
  }));
  const contentServices: ContentServices = {
    listBindingFields: async () => SOURCES,
    listLoopCollections: async () => [POSTS, CATEGORIES],
    readListSample,
    ...services,
  };
  render(<InspectorPanel editor={editor} contentServices={contentServices} />);
  return { editor, readListSample };
}

/** Open the picker from the bind button, once the fields are read. */
async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Bind Text to a field" }));
  return screen.findByRole("listbox", { name: "Fields for Text" });
}

/** The picker's groups, by heading, in the order they are listed. */
function groupNames(list: HTMLElement): (string | null)[] {
  return within(list)
    .getAllByRole("group")
    .map(group => group.getAttribute("aria-label"));
}

/** A group's rows, as a reader hears each: name, then value or tags. */
function rows(list: HTMLElement, group: string): (string | null)[] {
  return within(within(list).getByRole("group", { name: group }))
    .getAllByRole("option")
    .map(option => option.textContent);
}

describe("the field picker inside a collection list's item", () => {
  it("lists the item's fields first, then this page, Singles and the site", async () => {
    mount(undefined);
    const list = await openPicker();
    // The item group is drawn once the list's collection is read.
    await within(list).findByRole("group", { name: "Each post in the list" });
    // Singles and the site start folded while the item is listed.
    expect(groupNames(list)).toEqual([
      "Each post in the list",
      "This page",
      "Singles · Site",
    ]);
  });

  it("lists no item group for a block outside every list", async () => {
    // The control: the same block and services, on the page itself.
    mount(undefined, { inList: false });
    const list = await openPicker();
    expect(groupNames(list)).toEqual(["This page", "Homepage", "Site"]);
  });

  it("shows each item field's value from the list's first entry", async () => {
    const { readListSample } = mount(undefined);
    const list = await openPicker();
    await within(list).findByText("Highway 9 realignment");
    expect(rows(list, "Each post in the list")).toEqual([
      "TitleHighway 9 realignment",
      "SummaryTopographic survey",
    ]);
    // Asked of the list the block sits in, by its stored props.
    expect(readListSample).toHaveBeenCalledWith(LIST_PROPS);
  });

  it("shows a draft's value with a Draft tag, not the tag alone", async () => {
    mount(undefined);
    const list = await openPicker();
    await within(list).findByRole("group", { name: "This page" });
    expect(rows(list, "This page")).toEqual(["TitleQA blocks 3Draft"]);
  });

  it("binds a pick of the item's Title to the item, so each row shows its own", async () => {
    const { editor } = mount(undefined);
    const list = await openPicker();
    fireEvent.click(
      await within(
        await within(list).findByRole("group", {
          name: "Each post in the list",
        })
      ).findByRole("option", { name: /^Title/ })
    );
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      kind: "update",
      id: "h",
      patch: { bindings: { text: { $bind: "title", source: "item" } } },
    });
  });

  it("marks the field bound now: the item's Title, not the page's", async () => {
    mount({ text: { $bind: "title", source: "item" } });
    const chip = await screen.findByRole("button", {
      name: /^Text: bound to Title of each post/,
    });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Change field…" })
    );
    const list = await screen.findByRole("listbox", {
      name: "Fields for Text",
    });
    const item = await within(list).findByRole("group", {
      name: "Each post in the list",
    });
    const marked = list.querySelectorAll("[data-current]");
    expect(marked).toHaveLength(1);
    expect(item.contains(marked[0] ?? null)).toBe(true);
    expect(marked[0]?.textContent).toMatch(/^Title/);
  });

  it("binds a pick of the OUTER list's field to that list, by its id", async () => {
    const { editor } = mount(undefined, { inCategories: true });
    const list = await openPicker();
    fireEvent.click(
      await within(
        await within(list).findByRole("group", {
          name: "Each category in the list",
        })
      ).findByRole("option", { name: /^Name/ })
    );
    const op = vi.mocked(editor.apply).mock.calls[0]?.[0] as BuilderOp;
    expect(op).toMatchObject({
      kind: "update",
      id: "h",
      patch: {
        bindings: {
          text: { $bind: "name", source: "item", list: "categories" },
        },
      },
    });
  });

  it("names and marks an outer list's binding by that list", async () => {
    mount(
      { text: { $bind: "name", source: "item", list: "categories" } },
      { inCategories: true }
    );
    const chip = await screen.findByRole("button", {
      name: /^Text: bound to Name of each category/,
    });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Change field…" })
    );
    const list = await screen.findByRole("listbox", {
      name: "Fields for Text",
    });
    const outer = await within(list).findByRole("group", {
      name: "Each category in the list",
    });
    const marked = list.querySelectorAll("[data-current]");
    expect(marked).toHaveLength(1);
    expect(outer.contains(marked[0] ?? null)).toBe(true);
  });
});
