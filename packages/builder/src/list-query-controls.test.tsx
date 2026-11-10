// @vitest-environment jsdom

/**
 * A collection list's query in the Content tab, with the host's collections
 * stood in for. Each control writes the stored shape the engine reads, in
 * one write; each problem is said inline.
 *
 * - Source: a collection, or a to-many relation of the page's entry; the
 *   menu says why when no relation can be offered; a new collection clears
 *   the filters and sort that named the old one's fields.
 * - Filters: only fields visitors can see are offered, none holding several
 *   values; a new filter opens open with its field menu; a row is written
 *   once complete, and says what it lacks until then; a closed row is one
 *   sentence that Enter opens and Escape closes.
 * - Sort: the direction in words for the field's kind; Alt+↑ and Alt+↓ on a
 *   focused row, and Move up and Move down in its menu, reorder the keys.
 * - How many: refused inline outside its bounds, written inside them.
 * - Canvas shows: the switch asks the editor to show the list empty.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  COLLECTION_LIST_TYPE,
  LIST_MAX_FILTERS,
  LIST_MAX_SORT_KEYS,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { ContentServices, LoopCollection } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
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

/** The list block, declared as the core block declares its query's props. */
function register(): void {
  registerBlocks(
    [
      {
        name: COLLECTION_LIST_TYPE,
        version: 1,
        description: "A list.",
        example: { props: {} },
        editor: { label: "Collection list" },
        props: {
          collection: { label: "Source", type: "text", display: "collection" },
          relation: { type: "object", display: "listRelation" },
          filters: { type: "array", display: "listFilters" },
          sort: { type: "text", display: "sort", collectionProp: "collection" },
          limit: { label: "Number of items", type: "number" },
          offset: { label: "Skip the first", type: "number" },
        },
        slots: { children: {}, empty: {} },
        render: () => null,
      },
    ] as never,
    { source: "list-query-controls-test" }
  );
}

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [
    { name: "title", label: "Title", kind: "text" },
    { name: "publishedAt", label: "Published date", kind: "date" },
    {
      name: "category",
      label: "Category",
      kind: "choice",
      options: [
        { value: "news", label: "News" },
        { value: "guides", label: "Guides" },
      ],
    },
    { name: "views", label: "Views", kind: "number" },
    { name: "author", label: "Author", kind: "entry", relationTo: "authors" },
  ],
  relations: [
    { field: "categories", label: "Categories", collection: "categories" },
  ],
  // `internalScore` is declared and withheld from visitors, so not offered.
  declared: [
    "id",
    "title",
    "publishedAt",
    "category",
    "views",
    "author",
    "categories",
    "internalScore",
  ],
};

const CATEGORIES: LoopCollection = {
  slug: "categories",
  label: "Categories",
  singular: "Category",
  fields: [{ name: "name", label: "Name", kind: "text" }],
};

const COLLECTIONS = [POSTS, CATEGORIES];

/** The selected list, as `place` puts it in the page; on its own by default. */
function editorFor(
  props: Record<string, unknown>,
  place: (selected: BlockNode) => BlockNode[] = selected => [selected]
) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: place({
      id: "list",
      type: COLLECTION_LIST_TYPE,
      version: 1,
      props,
      slots: { children: [], empty: [] },
    } as BlockNode),
  } as BlockDocument;
  return {
    document,
    selectedId: "list",
    selection: { ids: ["list"], primary: "list" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
    listsShowingEmpty: new Set<string>(),
    showListEmpty: vi.fn(),
  } as unknown as EditorState & {
    apply: ReturnType<typeof vi.fn>;
    showListEmpty: ReturnType<typeof vi.fn>;
  };
}

function mount(
  props: Record<string, unknown>,
  services: Partial<ContentServices> = {},
  place?: (selected: BlockNode) => BlockNode[]
) {
  register();
  const editor = editorFor(props, place);
  render(
    <InspectorPanel
      editor={editor}
      contentServices={{
        listLoopCollections: vi.fn(async () => COLLECTIONS),
        ...services,
      }}
    />
  );
  return editor;
}

/** The props of each write, in order. */
function writes(editor: { apply: ReturnType<typeof vi.fn> }): object[] {
  return editor.apply.mock.calls.map(
    call => (call[0] as { patch: { props: object } }).patch.props
  );
}

/** The rows an open picker lists, by their words. */
function listed(name: string): string[] {
  return within(screen.getByRole("listbox", { name }))
    .getAllByRole("option")
    .map(option => option.textContent ?? "");
}

describe("a list's source", () => {
  it("offers the page entry's relations above the collections", async () => {
    mount({ collection: "posts" }, { entryCollection: "posts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Posts" })
    );
    expect(listed("Sources")).toEqual([
      "This post's categories",
      "No collection",
      "Categories",
      "Posts",
    ]);
    expect(screen.getByText("Related to this post")).toBeDefined();
  });

  it("says why no relation is offered where none can be read", async () => {
    mount({ collection: "posts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Posts" })
    );
    expect(screen.getByText(/Not available here\./)).toBeDefined();
    expect(listed("Sources")).toEqual(["No collection", "Categories", "Posts"]);
  });

  it("offers each outer entry's relations only to a list drawn per entry", async () => {
    // A list of posts, holding the selected list in the slot it draws per
    // entry, or in its empty state, which is drawn with no post at all.
    const inPosts =
      (slot: "children" | "empty") =>
      (selected: BlockNode): BlockNode[] => [
        {
          id: "posts",
          type: COLLECTION_LIST_TYPE,
          version: 1,
          props: { collection: "posts" },
          slots: { children: [], empty: [], [slot]: [selected] },
        } as BlockNode,
      ];
    mount({ collection: "categories" }, {}, inPosts("children"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Categories" })
    );
    expect(listed("Sources")).toContain("Each post's categories");
    cleanup();
    clearBlocks();
    mount({ collection: "categories" }, {}, inPosts("empty"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Categories" })
    );
    expect(listed("Sources")).not.toContain("Each post's categories");
  });

  it("says a list in another list's When empty has no entry to relate to, and elsewhere why none is offered", async () => {
    const WHEN_EMPTY =
      "Not available in When empty: it only shows when the list has no entries, so there's no entry to relate to.";
    const GENERIC =
      "Not available here. On a collection's entry, or inside another list, a list can show the entry's related entries, such as its categories or tags.";
    const inEmptyOf = (selected: BlockNode): BlockNode[] => [
      {
        id: "posts",
        type: COLLECTION_LIST_TYPE,
        version: 1,
        props: { collection: "posts" },
        // Inside a box in the empty state: the nearest list still holds it
        // in its empty state.
        slots: {
          children: [],
          empty: [
            {
              id: "box",
              type: "core/group",
              version: 1,
              props: {},
              slots: { children: [selected] },
            } as BlockNode,
          ],
        },
      } as BlockNode,
    ];
    mount({ collection: "categories" }, {}, inEmptyOf);
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Categories" })
    );
    expect(screen.getByText(WHEN_EMPTY)).toBeDefined();
    expect(screen.queryByText(GENERIC)).toBeNull();
    cleanup();
    clearBlocks();
    // On its own, with no entry around it: the generic note.
    mount({ collection: "categories" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Categories" })
    );
    expect(screen.getByText(GENERIC)).toBeDefined();
    expect(screen.queryByText(WHEN_EMPTY)).toBeNull();
  });

  it("says, as the save does, that a Single's page has no entry to relate to", async () => {
    mount(
      {
        collection: "categories",
        relation: { of: "entry", field: "categories" },
      },
      { entryCollection: null }
    );
    expect(
      await screen.findByText(
        /This page isn't an entry in a collection, so it has no related entries to show\./
      )
    ).toBeDefined();
  });

  it("stores a relation and its collection in one write", async () => {
    const editor = mount(
      {
        collection: "posts",
        filters: [{ field: "title", op: "equals", value: "a" }],
      },
      { entryCollection: "posts" }
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Posts" })
    );
    fireEvent.click(
      screen.getByRole("option", { name: "This post's categories" })
    );
    expect(writes(editor)).toEqual([
      {
        collection: "categories",
        relation: { of: "entry", field: "categories" },
      },
    ]);
  });

  it("clears the filters and sort that named the old collection's fields", async () => {
    const editor = mount({
      collection: "posts",
      filters: [{ field: "title", op: "equals", value: "a" }],
      sort: "-publishedAt",
      limit: 6,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Source Posts" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Categories" }));
    expect(writes(editor)).toEqual([{ collection: "categories", limit: 6 }]);
  });
});

/** The text of the notes an element names as describing it. */
function describedText(element: HTMLElement): string | undefined {
  const ids = element.getAttribute("aria-describedby");
  if (ids === null) return undefined;
  return ids
    .split(" ")
    .map(each => document.getElementById(each)?.textContent ?? "")
    .join(" ");
}

describe("a list's filters", () => {
  it("turns Add filter off at the most filters a list holds, and says why", async () => {
    const filtersOf = (count: number) =>
      Array.from({ length: count }, () => ({
        field: "title",
        op: "contains" as const,
        value: "a",
      }));
    mount({ collection: "posts", filters: filtersOf(LIST_MAX_FILTERS - 1) });
    const below = (await screen.findByRole("button", {
      name: "Add filter",
    })) as HTMLButtonElement;
    expect(below.disabled).toBe(false);
    expect(below.getAttribute("aria-describedby")).toBeNull();
    cleanup();
    clearBlocks();
    mount({ collection: "posts", filters: filtersOf(LIST_MAX_FILTERS) });
    const full = (await screen.findByRole("button", {
      name: "Add filter",
    })) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    expect(describedText(full)).toBe(
      `Up to ${String(LIST_MAX_FILTERS)} filters.`
    );
  });

  it("offers only the fields visitors can see, none holding several values, and says so", async () => {
    mount({ collection: "posts" });
    fireEvent.click(await screen.findByRole("button", { name: "Add filter" }));
    // A new filter opens open, its field menu with it.
    const fields = listed("Fields to filter by");
    expect(
      fields.map(row => row.replace(/(Text|Date|Choice|Number|Entry)$/, ""))
    ).toEqual(["Title", "Published date", "Category", "Views", "Author"]);
    expect(fields.join(" ")).not.toMatch(/Internal|Categories/);
    expect(
      screen.getByText("Only fields visitors can see are listed.")
    ).toBeDefined();
  });

  it("writes a new row once it is complete, and nothing before", async () => {
    const editor = mount({ collection: "posts" });
    fireEvent.click(await screen.findByRole("button", { name: "Add filter" }));
    fireEvent.click(screen.getByRole("option", { name: /^Title/ }));
    // A field and an operator but no value yet: kept here, and said.
    expect(editor.apply).not.toHaveBeenCalled();
    expect(
      screen.getByText("Choose a value for Title, or remove this filter.")
    ).toBeDefined();
    const value = screen.getByRole("textbox", { name: /^Filter Title is/ });
    fireEvent.change(value, { target: { value: "build" } });
    fireEvent.keyDown(value, { key: "Enter" });
    expect(writes(editor)).toEqual([
      {
        collection: "posts",
        filters: [{ field: "title", op: "equals", value: "build" }],
      },
    ]);
  });

  it("reads a closed row as one sentence that Enter opens and Escape closes", async () => {
    mount({
      collection: "posts",
      filters: [{ field: "category", op: "in", value: ["news", "guides"] }],
    });
    const line = await screen.findByRole("button", {
      name: "Category is any of News, Guides",
    });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(line);
    const close = screen.getByRole("button", {
      name: "Close filter: Category is any of News, Guides",
    });
    expect(screen.getByRole("checkbox", { name: "News" })).toBeDefined();
    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Category is any of News, Guides" })
      ).toBeDefined()
    );
  });

  it("removes a row in one write, and stores no filters for none", async () => {
    const editor = mount({
      collection: "posts",
      filters: [{ field: "title", op: "contains", value: "build" }],
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove filter: Title contains “build”",
      })
    );
    expect(writes(editor)).toEqual([{ collection: "posts" }]);
  });

  it("says, from the engine, why a stored filter on a hidden field can't be read", async () => {
    mount({
      collection: "posts",
      filters: [{ field: "internalScore", op: "greater_than", value: 3 }],
    });
    expect(
      await screen.findByText(/"internalScore", which visitors can't see/)
    ).toBeDefined();
  });
});

describe("the judgement the group shows", () => {
  it("is the save's: a public field it does not offer is no problem", async () => {
    mount(
      { collection: "notes", sort: "-body" },
      {
        listLoopCollections: vi.fn(async () => [
          {
            slug: "notes",
            label: "Notes",
            fields: [{ name: "title", label: "Title", kind: "text" as const }],
            declared: ["id", "title", "body", "secret"],
            readable: [
              { name: "id", type: "text" },
              { name: "title", type: "text" },
              { name: "body", type: "richText" },
            ],
          },
        ]),
      }
    );
    await screen.findByRole("button", { name: "Source Notes" });
    // Not offered, so marked as not in the list; but the save takes it.
    expect(screen.queryByText(/visitors can't see|does not have/)).toBeNull();
  });
});

describe("the judgement for a host naming no readable fields", () => {
  it("judges each offered field by its kind, so a choice or a yes/no field filters and sorts as offered", async () => {
    mount(
      {
        collection: "notes",
        filters: [
          { field: "kind", op: "in", value: ["news"] },
          { field: "pinned", op: "equals", value: true },
          { field: "author", op: "equals", value: "a1" },
        ],
        sort: "kind,-pinned,-views,-due,title",
      },
      {
        listLoopCollections: vi.fn(async () => [
          {
            slug: "notes",
            label: "Notes",
            fields: [
              { name: "title", label: "Title", kind: "text" as const },
              {
                name: "kind",
                label: "Kind",
                kind: "choice" as const,
                options: [{ value: "news", label: "News" }],
              },
              { name: "pinned", label: "Pinned", kind: "boolean" as const },
              { name: "views", label: "Views", kind: "number" as const },
              { name: "due", label: "Due", kind: "date" as const },
              {
                name: "author",
                label: "Author",
                kind: "entry" as const,
                relationTo: "authors",
              },
            ],
          },
        ]),
      }
    );
    await screen.findByRole("button", { name: "Source Notes" });
    // Every kind a field is offered with, judged as a field of that kind.
    expect(screen.queryAllByText(/cannot compare|cannot order by/)).toEqual([]);
  });
});

describe("a list's sort", () => {
  it("names the direction in words for the field's kind", async () => {
    mount({ collection: "posts", sort: "-publishedAt,title,-views" });
    const directions = await screen.findAllByRole("combobox", {
      name: /^Order of/,
    });
    expect(directions.map(each => each.textContent)).toEqual([
      "Newest first",
      "A–Z",
      "Highest first",
    ]);
  });

  it("moves the focused row with Alt+↑ and Alt+↓, in one write each", async () => {
    const editor = mount({ collection: "posts", sort: "-publishedAt,title" });
    const second = await screen.findByRole("combobox", {
      name: "Order of Title",
    });
    fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
    expect(writes(editor)).toEqual([
      { collection: "posts", sort: "title,-publishedAt" },
    ]);
    fireEvent.keyDown(second, { key: "ArrowDown", altKey: true });
    // The stored document did not change in this stand-in, so the row is
    // still second: down from the last row writes nothing.
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });

  it("moves a row from its menu, which has no up and down arrows beside it", async () => {
    const editor = mount({ collection: "posts", sort: "-publishedAt,title" });
    const more = await screen.findByRole("button", {
      name: "More for sort by Published date",
    });
    fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Move down/ }));
    expect(writes(editor)).toEqual([
      { collection: "posts", sort: "title,-publishedAt" },
    ]);
    expect(
      screen.queryByRole("button", { name: /^Move (up|down)$/ })
    ).toBeNull();
  });

  it("moves a row dragged by its handle to the row it is dropped on, in one write", async () => {
    const editor = mount({ collection: "posts", sort: "-publishedAt,title" });
    await screen.findByRole("combobox", { name: "Order of Title" });
    const rows = Array.from(document.querySelectorAll(".nx-list-sort"));
    const handle = rows[0]?.querySelector(".nx-list-sort__handle");
    if (!(handle instanceof HTMLElement) || rows[1] === undefined) {
      throw new Error("the rows were not drawn");
    }
    handle.setPointerCapture = () => undefined;
    // jsdom lays nothing out, so the row under the pointer is stood in for.
    const target = rows[1];
    document.elementFromPoint = () => target;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(writes(editor)).toEqual([
      { collection: "posts", sort: "title,-publishedAt" },
    ]);
  });

  it("adds a key from the fields a list may sort by, newest first for a date", async () => {
    const editor = mount({ collection: "posts" });
    fireEvent.click(await screen.findByRole("button", { name: "Add sort" }));
    // A relation orders by nothing an author reads, so it is not offered.
    expect(listed("Fields to sort by").join(" ")).not.toContain("Author");
    fireEvent.click(screen.getByRole("option", { name: /^Published date/ }));
    expect(writes(editor)).toEqual([
      { collection: "posts", sort: "-publishedAt" },
    ]);
  });

  it("offers no key past the most a list sorts by, as the save refuses one", async () => {
    // More fields than a list may sort by, so one is always left to add.
    const wide: LoopCollection = {
      slug: "wide",
      label: "Wide",
      singular: "Wide",
      fields: Array.from({ length: LIST_MAX_SORT_KEYS + 1 }, (_, index) => ({
        name: `f${String(index)}`,
        label: `Field ${String(index)}`,
        kind: "text" as const,
      })),
    };
    const sortBy = (count: number) =>
      Array.from({ length: count }, (_, index) => `f${String(index)}`).join(
        ","
      );
    const services = { listLoopCollections: vi.fn(async () => [wide]) };
    // Each read once the collection's fields are in, which name the rows.
    const addSortWith = async (count: number) => {
      mount({ collection: "wide", sort: sortBy(count) }, services);
      await screen.findByRole("button", {
        name: `Sort ${String(count)} of ${String(count)}, by Field ${String(count - 1)}`,
      });
      return screen.getByRole("button", { name: "Add sort" });
    };
    const below = (await addSortWith(
      LIST_MAX_SORT_KEYS - 1
    )) as HTMLButtonElement;
    expect(below.disabled).toBe(false);
    expect(below.getAttribute("aria-describedby")).toBeNull();
    expect(
      screen.queryByText(`Up to ${String(LIST_MAX_SORT_KEYS)} sorts.`)
    ).toBeNull();
    cleanup();
    clearBlocks();
    const full = (await addSortWith(LIST_MAX_SORT_KEYS)) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    // Off, and saying why, as Add filter does at its own limit.
    expect(describedText(full)).toBe(
      `Up to ${String(LIST_MAX_SORT_KEYS)} sorts.`
    );
  });

  it("marks a stored key the collection no longer has, with the engine's reason", async () => {
    mount({ collection: "posts", sort: "-rating" });
    expect(
      await screen.findByRole("button", {
        name: "Sort 1 of 1, by rating · not in this collection",
      })
    ).toBeDefined();
    expect(
      // The collection by the name authors read it by, not its slug.
      screen.getByText(
        /sorts by "rating", which Posts doesn.t have\. Choose another field\./
      )
    ).toBeDefined();
  });
});

describe("a fallen-back sort's Choose a field", () => {
  it("takes the author to the list's first sort row, on the Content tab", async () => {
    register();
    const editor = editorFor({ collection: "posts", sort: "-rating,title" });
    const services = { listLoopCollections: vi.fn(async () => COLLECTIONS) };
    const { rerender } = render(
      <InspectorPanel editor={editor} contentServices={services} />
    );
    await screen.findByRole("button", { name: /^Sort 1 of 2, by/ });
    // The author is styling the list when its note's action is pressed.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    fireEvent.click(screen.getByRole("tab", { name: "Style" }));
    rerender(
      <InspectorPanel
        editor={{ ...editor, sortFieldAsked: { id: "list", seq: 1 } }}
        contentServices={services}
      />
    );
    const first = screen.getByRole("button", { name: /^Sort 1 of 2, by/ });
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(
      screen.getByRole("tab", { name: "Content" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("answers an ask made as the list is selected, when React runs its effects twice", async () => {
    register();
    const editor = editorFor({ collection: "posts", sort: "-rating" });
    render(
      <React.StrictMode>
        <InspectorPanel
          editor={{ ...editor, sortFieldAsked: { id: "list", seq: 1 } }}
          contentServices={{
            listLoopCollections: vi.fn(async () => COLLECTIONS),
          }}
        />
      </React.StrictMode>
    );
    const first = await screen.findByRole("button", {
      name: /^Sort 1 of 1, by/,
    });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it("asks nothing of a list it was not pressed for", async () => {
    register();
    const editor = editorFor({ collection: "posts", sort: "-rating" });
    render(
      <InspectorPanel
        editor={{ ...editor, sortFieldAsked: { id: "another", seq: 1 } }}
        contentServices={{
          listLoopCollections: vi.fn(async () => COLLECTIONS),
        }}
      />
    );
    const first = await screen.findByRole("button", {
      name: /^Sort 1 of 1, by/,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.activeElement).not.toBe(first);
  });
});

describe("how many entries a list shows", () => {
  it("refuses a number of items outside 1 to 100 inline, writing nothing", async () => {
    const editor = mount({ collection: "posts", limit: 6 });
    const field = await screen.findByLabelText("Number of items");
    fireEvent.change(field, { target: { value: "101" } });
    fireEvent.blur(field);
    expect(screen.getByText("Show between 1 and 100 entries.")).toBeDefined();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "8" } });
    fireEvent.blur(field);
    expect(writes(editor)).toEqual([{ collection: "posts", limit: 8 }]);
  });

  it("skips a whole number of entries, refusing a negative one", async () => {
    const editor = mount({ collection: "posts" });
    const field = await screen.findByLabelText("Skip the first");
    fireEvent.change(field, { target: { value: "-1" } });
    fireEvent.blur(field);
    expect(
      screen.getByText("Skip a whole number of entries, 0 or more.")
    ).toBeDefined();
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.blur(field);
    expect(writes(editor)).toEqual([{ collection: "posts", offset: 3 }]);
  });

  it("shows 0 to skip when none is stored, and stores nothing for it", async () => {
    const editor = mount({ collection: "posts" });
    const field = (await screen.findByLabelText(
      "Skip the first"
    )) as HTMLInputElement;
    // The value a list reads, as a value rather than a hint.
    expect(field.value).toBe("0");
    fireEvent.blur(field);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "2" } });
    fireEvent.blur(field);
    expect(writes(editor)).toEqual([{ collection: "posts", offset: 2 }]);
  });
});

describe("how many entries match, for the selected list", () => {
  it("says how many match and how many show, from one count", async () => {
    const countListEntries = vi.fn(async () => ({ matching: 4, shown: 3 }));
    const editor = mount(
      { collection: "posts", limit: 3, offset: 0 },
      { countListEntries }
    );
    expect(
      await screen.findByText("4 entries match, so 3 show.")
    ).toBeDefined();
    expect(countListEntries).toHaveBeenCalledTimes(1);
    expect(countListEntries).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "posts", limit: 3 })
    );
    // Drawn again with the same query, nothing is counted again.
    fireEvent.click(screen.getByRole("radio", { name: "When empty" }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(countListEntries).toHaveBeenCalledTimes(1);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("speaks of one entry as one", async () => {
    mount(
      { collection: "posts" },
      { countListEntries: vi.fn(async () => ({ matching: 1, shown: 1 })) }
    );
    expect(
      await screen.findByText("1 entry matches, so 1 shows.")
    ).toBeDefined();
  });

  it("says nothing where no count is made, or the count fails", async () => {
    mount(
      { collection: "posts" },
      { countListEntries: vi.fn(async () => undefined) }
    );
    await screen.findByLabelText("Number of items");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByText(/match(es)?, so/)).toBeNull();
    cleanup();
    clearBlocks();
    mount(
      { collection: "posts" },
      {
        countListEntries: vi.fn(async () => {
          throw new Error("Visitors can't read posts.");
        }),
      }
    );
    await screen.findByLabelText("Number of items");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByText(/match(es)?, so/)).toBeNull();
  });
});

describe("what the canvas shows", () => {
  it("asks the editor to draw the list's empty state, which writes nothing", async () => {
    const editor = mount({ collection: "posts" });
    fireEvent.click(await screen.findByRole("radio", { name: "When empty" }));
    expect(editor.showListEmpty).toHaveBeenCalledWith("list", true);
    expect(editor.apply).not.toHaveBeenCalled();
  });
});

/**
 * Whether a control has a name a screen reader reads: its own label, one it
 * points at, its words, or a label for its id.
 */
function hasName(element: HTMLElement): boolean {
  const said = (name: string) => (element.getAttribute(name) ?? "") !== "";
  const labelled =
    element.id !== "" &&
    document.querySelector(`label[for="${element.id}"]`) !== null;
  return (
    said("aria-label") ||
    said("aria-labelledby") ||
    (element.textContent ?? "").trim() !== "" ||
    labelled
  );
}

describe("the group, from the keyboard", () => {
  it("reaches every control in tab order, with a name", async () => {
    mount({
      collection: "posts",
      filters: [{ field: "title", op: "contains", value: "build" }],
      sort: "-publishedAt",
    });
    await screen.findByRole("button", { name: "Source Posts" });
    const group = document.querySelector('[data-content-control="listQuery"]');
    const focusable = Array.from(
      group?.querySelectorAll<HTMLElement>("button, input, [tabindex]") ?? []
    ).filter(element => element.getAttribute("tabindex") !== "-1");
    for (const element of focusable) {
      expect(hasName(element), element.outerHTML).toBe(true);
    }
    expect(focusable.length).toBeGreaterThan(8);
  });
});

// Keep React in scope for the JSX in this file under the classic runtime.
void React;
