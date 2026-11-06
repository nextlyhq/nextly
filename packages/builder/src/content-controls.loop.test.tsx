// @vitest-environment jsdom

/**
 * A collection loop's Content-tab controls, with the host's collection list
 * stood in for.
 *
 * - Collection: a menu of the site's collections by name, alphabetical, with
 *   a search once there are more than ten; picking one stores its slug; a
 *   stored slug the list lacks is shown, marked, and not rewritten.
 * - Sort: a menu of the chosen collection's fields, dates first, and a
 *   direction toggle, both writing the `field` / `-field` string; further
 *   stored keys are kept as they are; a stored field the collection lacks is
 *   shown, marked.
 * - Without the host's list, or when it fails, both are typed as text.
 * - Both are named for a screen reader and held by a lock.
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

/** A block declared as `core/collection-loop` declares its two props. */
function register(): void {
  registerBlocks(
    [
      {
        name: "acme/loop",
        version: 1,
        description: "A loop.",
        example: { props: {} },
        editor: { label: "Loop" },
        props: {
          collection: {
            label: "Collection",
            type: "text",
            display: "collection",
          },
          sort: {
            label: "Sort by",
            type: "text",
            display: "sort",
            collectionProp: "collection",
          },
        },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-loop-test" }
  );
}

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Blog posts",
  fields: [
    { name: "title", label: "Title", kind: "text" },
    { name: "publishedAt", label: "Published date", kind: "date" },
    // A relation filters a list and never sorts it, so the menu leaves it out.
    { name: "author", label: "Author", kind: "entry", relationTo: "authors" },
    { name: "createdAt", label: "Created", kind: "date" },
  ],
};

const COLLECTIONS: readonly LoopCollection[] = [
  { slug: "events", label: "Events", fields: [] },
  POSTS,
  { slug: "authors", label: "authors", fields: [] },
];

function editorFor(
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/loop", version: 1, props, ...extra } as BlockNode,
    ],
  } as BlockDocument;
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
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

function mount(
  props: Record<string, unknown>,
  services: ContentServices = {
    listLoopCollections: vi.fn(async () => COLLECTIONS),
  },
  extra: Partial<BlockNode> = {}
) {
  register();
  const editor = editorFor(props, extra);
  render(<InspectorPanel editor={editor} contentServices={services} />);
  return editor;
}

/** The props the one write stored. */
function written(editor: { apply: ReturnType<typeof vi.fn> }): object {
  expect(editor.apply).toHaveBeenCalledTimes(1);
  return (editor.apply.mock.calls[0]?.[0] as { patch: { props: object } }).patch
    .props;
}

/** The rows an open picker lists, by their words. */
function listed(name: string): string[] {
  const list = screen.getByRole("listbox", { name });
  return within(list)
    .getAllByRole("option")
    .map(option => option.textContent ?? "");
}

describe("the collection a loop repeats over", () => {
  it("shows the stored collection by its name, in a button named with its label", async () => {
    mount({ collection: "posts" });
    const button = await screen.findByRole("button", {
      name: "Collection Blog posts",
    });
    expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    // The label names the button, so a label points at a control drawn.
    expect(screen.getByText("Collection").getAttribute("for")).toBe(button.id);
  });

  it("lists the collections alphabetically, ignoring case, with no search for a few", async () => {
    mount({});
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Collection Choose a collection",
      })
    );
    expect(listed("Collections")).toEqual([
      "No collection",
      "authors",
      "Blog posts",
      "Events",
    ]);
    expect(
      screen.queryByRole("combobox", { name: "Search collections" })
    ).toBeNull();
  });

  it("stores the slug of the collection picked", async () => {
    const editor = mount({ collection: "posts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Collection Blog posts" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Events" }));
    expect(written(editor)).toEqual({ collection: "events" });
  });

  it("offers a search once there are more than ten collections, and not at ten", async () => {
    const many = (count: number): LoopCollection[] =>
      Array.from({ length: count }, (_, index) => ({
        slug: `c${index}`,
        label: `Collection ${String(index).padStart(2, "0")}`,
        fields: [],
      }));
    mount({}, { listLoopCollections: vi.fn(async () => many(10)) });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Collection Choose a collection",
      })
    );
    expect(
      screen.queryByRole("combobox", { name: "Search collections" })
    ).toBeNull();
    cleanup();
    clearBlocks();

    mount({}, { listLoopCollections: vi.fn(async () => many(11)) });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Collection Choose a collection",
      })
    );
    const search = screen.getByRole("combobox", {
      name: "Search collections",
    });
    fireEvent.change(search, { target: { value: "10" } });
    expect(listed("Collections")).toEqual(["Collection 10"]);
  });

  it("shows a stored slug the list lacks, marked, and writes nothing", async () => {
    const editor = mount({ collection: "retired" });
    const button = await screen.findByRole("button", {
      name: "Collection retired · not available",
    });
    expect(button.closest("[data-unknown]")).not.toBeNull();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("is typed as text where the host lends no list", () => {
    mount({ collection: "posts" }, {});
    const field = screen.getByLabelText("Collection");
    expect((field as HTMLInputElement).value).toBe("posts");
  });

  it("is typed as text where the list cannot be read", async () => {
    mount(
      { collection: "posts" },
      { listLoopCollections: vi.fn(async () => Promise.reject(new Error("x"))) }
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Collection") as HTMLInputElement).value
      ).toBe("posts")
    );
  });

  it("reads the list once for both controls", async () => {
    const list = vi.fn(async () => COLLECTIONS);
    mount({ collection: "posts" }, { listLoopCollections: list });
    await screen.findByRole("button", { name: "Collection Blog posts" });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("keeps no answer once it has arrived, so the next drawing asks the host again", async () => {
    // An answer is one signed-in author's: kept, it could be handed to the
    // next person to sign in on this tab without the route judging them.
    const list = vi.fn(async () => COLLECTIONS);
    mount({ collection: "posts" }, { listLoopCollections: list });
    await screen.findByRole("button", { name: "Collection Blog posts" });
    cleanup();
    clearBlocks();
    mount({ collection: "posts" }, { listLoopCollections: list });
    await screen.findByRole("button", { name: "Collection Blog posts" });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("is held by a lock", async () => {
    mount({ collection: "posts" }, undefined, { locked: true });
    const button = await screen.findByRole("button", {
      name: "Collection Blog posts",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});

describe("the order a loop's entries come in", () => {
  it("shows the first key's field by its label, and its direction on the toggle", async () => {
    mount({ collection: "posts", sort: "-publishedAt" });
    await screen.findByRole("button", { name: "Sort by Published date" });
    const toggle = screen.getByRole("button", { name: "Descending" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("lists the collection's fields with the dates first", async () => {
    mount({ collection: "posts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sort by Default order" })
    );
    expect(listed("Fields to sort by")).toEqual([
      "Default order",
      "Published date",
      "Created",
      "Title",
    ]);
  });

  it("sorts a newly picked date newest first, and other fields A to Z", async () => {
    const editor = mount({ collection: "posts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sort by Default order" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Published date" }));
    expect(written(editor)).toEqual({
      collection: "posts",
      sort: "-publishedAt",
    });
    cleanup();
    clearBlocks();

    const again = mount({ collection: "posts" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sort by Default order" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Title" }));
    expect(written(again)).toEqual({ collection: "posts", sort: "title" });
  });

  it("keeps the chosen direction when the field changes", async () => {
    const editor = mount({ collection: "posts", sort: "title" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sort by Title" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Created" }));
    expect(written(editor)).toEqual({ collection: "posts", sort: "createdAt" });
  });

  it("flips the direction from the toggle", async () => {
    const editor = mount({ collection: "posts", sort: "-publishedAt" });
    await screen.findByRole("button", { name: "Sort by Published date" });
    fireEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(written(editor)).toEqual({
      collection: "posts",
      sort: "publishedAt",
    });
  });

  it("keeps further keys as stored, and names them", async () => {
    const editor = mount({ collection: "posts", sort: "-publishedAt, title" });
    await screen.findByRole("button", { name: "Sort by Published date" });
    expect(screen.getByText("Then by Title.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(written(editor)).toEqual({
      collection: "posts",
      sort: "publishedAt,title",
    });
  });

  it("drops a further key the collection cannot sort by at the next change, and says so first", async () => {
    const editor = mount({
      collection: "posts",
      sort: "-publishedAt,rating,title",
    });
    await screen.findByRole("button", { name: "Sort by Published date" });
    expect(
      screen.getByText(
        "Then by rating · not in this collection, Title. A key not in this collection is dropped at the next change."
      )
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Descending" }));
    expect(written(editor)).toEqual({
      collection: "posts",
      sort: "publishedAt,title",
    });
  });

  it("removes the sort, further keys and all, for Default order", async () => {
    const editor = mount({ collection: "posts", sort: "-publishedAt,title" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sort by Published date" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Default order" }));
    expect(written(editor)).toEqual({ collection: "posts" });
  });

  it("shows a stored field the collection lacks, marked, and writes nothing", async () => {
    const editor = mount({ collection: "posts", sort: "-rating" });
    const button = await screen.findByRole("button", {
      name: "Sort by rating · not in this collection",
    });
    expect(button.closest("[data-unknown]")).not.toBeNull();
    // The stored direction still reads, but flipping a key the collection
    // cannot sort by would change nothing on the page, so it waits for a
    // field of this collection to be picked.
    const toggle = screen.getByRole("button", { name: "Descending" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.hasAttribute("disabled")).toBe(true);
    fireEvent.click(toggle);
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("waits for a collection before offering fields", async () => {
    mount({});
    const button = await screen.findByRole("button", {
      name: "Sort by Choose a collection first",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Descending" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("is typed as text where the host lends no list", () => {
    mount({ collection: "posts", sort: "-publishedAt" }, {});
    expect((screen.getByLabelText("Sort by") as HTMLInputElement).value).toBe(
      "-publishedAt"
    );
  });

  it("is held by a lock", async () => {
    mount({ collection: "posts", sort: "title" }, undefined, { locked: true });
    const button = await screen.findByRole("button", {
      name: "Sort by Title",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Descending" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
