// @vitest-environment jsdom

/**
 * A collection list's custom source in the Content tab, with the host's
 * collections and named queries stood in for.
 *
 * - The Source menu lists the site's custom sources above its collections,
 *   each on two lines with a "Needs input" tag where one needs a value, and
 *   one search matches a source's line as well as its name.
 * - A source whose input needs a value is kept on screen and written only
 *   once it can run, in one write that clears every other source; the canvas
 *   is told to tag the list with what it still shows meanwhile.
 * - Filters and sort under a custom source are one read-only line.
 * - A stored source the site no longer registers is said so, its inputs
 *   kept; a read visitors can't read is a caution, never a refusal.
 */
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
import * as React from "react";

import {
  clearBlocks,
  COLLECTION_LIST_TYPE,
  defineNamedQuery,
  namedQueryDeclaration,
  param,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { ContentServices, LoopCollection } from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import type { CustomSource } from "./named-query-model";

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
          namedQuery: { type: "object", display: "listNamedQuery" },
        },
        slots: { children: {}, empty: {} },
        render: () => null,
      },
    ] as never,
    { source: "list-query-controls-named-test" }
  );
}

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [{ name: "title", label: "Title", kind: "text" }],
};

const run = () => Promise.resolve({ rows: [] });

/** A source with an input it needs: text, so it is typed rather than picked. */
const UPCOMING: CustomSource = {
  declaration: namedQueryDeclaration(
    defineNamedQuery({
      name: "events.upcoming",
      label: "Upcoming events",
      description: "Events from today on, soonest first.",
      params: {
        city: param.text({ label: "City", required: true }),
        within: param.number({ label: "Within", unit: "days", default: 30 }),
      },
      reads: { collections: ["events"] },
      rows: { key: "id", fields: [{ name: "id", type: "text" }] },
      total: true,
      run,
    })
  ),
  readsHidden: [],
};

/** A second source taking the same input as the first, under another name. */
const ARCHIVE: CustomSource = {
  declaration: namedQueryDeclaration(
    defineNamedQuery({
      name: "events.archive",
      label: "Events archive",
      description: "Past events, newest first.",
      params: { city: param.text({ label: "City", required: true }) },
      reads: { collections: ["events"] },
      rows: { key: "id", fields: [{ name: "id", type: "text" }] },
      run,
    })
  ),
  readsHidden: [],
};

/** A source with nothing it needs, which reads a collection visitors can't. */
const MOST_READ: CustomSource = {
  declaration: namedQueryDeclaration(
    defineNamedQuery({
      name: "posts.most-read",
      label: "Most read this month",
      description: "The posts with the most visits in the last 30 days.",
      reads: { collections: ["posts", "page-views"] },
      rows: { collection: "posts" },
      run,
    })
  ),
  readsHidden: [
    { collection: "page-views", label: "Page views", fields: ["views"] },
  ],
};

function editorFor(props: Record<string, unknown>) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "list",
        type: COLLECTION_LIST_TYPE,
        version: 1,
        props,
        slots: { children: [], empty: [] },
      } as BlockNode,
    ],
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
    tagListStillShowing: vi.fn(),
  } as unknown as EditorState & {
    apply: ReturnType<typeof vi.fn>;
    tagListStillShowing: ReturnType<typeof vi.fn>;
  };
}

function mount(
  props: Record<string, unknown>,
  services: Partial<ContentServices> = {}
) {
  register();
  const editor = editorFor(props);
  render(
    <InspectorPanel
      editor={editor}
      contentServices={{
        listLoopCollections: vi.fn(async () => [POSTS]),
        listCustomSources: vi.fn(async () => [UPCOMING, MOST_READ, ARCHIVE]),
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

async function openSource(name: string): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: `Source ${name}` })
  );
  // The custom sources arrive with their own read.
  await screen.findByRole("group", { name: "Custom sources" });
}

describe("custom sources in the Source menu", () => {
  it("lists them above the collections, each with its line, and tags one that needs input", async () => {
    mount({ collection: "posts" });
    await openSource("Posts");
    const groups = within(
      screen.getByRole("listbox", { name: "Sources" })
    ).getAllByRole("group");
    expect(groups.map(group => group.getAttribute("aria-label"))).toEqual([
      "Custom sources",
      "Collections",
    ]);
    const upcoming = screen.getByRole("option", { name: /^Upcoming events/ });
    expect(upcoming.textContent).toContain(
      "Events from today on, soonest first."
    );
    expect(within(upcoming).getByText("Needs input")).toBeDefined();
    const mostRead = screen.getByRole("option", {
      name: /^Most read this month/,
    });
    expect(within(mostRead).queryByText("Needs input")).toBeNull();
  });

  it("finds a source by the words of its line, with one search over every group", async () => {
    mount({ collection: "posts" });
    await openSource("Posts");
    fireEvent.change(screen.getByRole("combobox", { name: "Search sources" }), {
      target: { value: "soonest" },
    });
    const options = within(
      screen.getByRole("listbox", { name: "Sources" })
    ).getAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      expect.stringContaining("Upcoming events"),
    ]);
  });
});

describe("choosing a custom source", () => {
  it("writes one with nothing it needs at once, clearing every other part of the source", async () => {
    const editor = mount({
      collection: "posts",
      filters: [{ field: "title", op: "equals", value: "a" }],
      sort: "-title",
      limit: 6,
    });
    await openSource("Posts");
    fireEvent.click(
      screen.getByRole("option", { name: /^Most read this month/ })
    );
    expect(writes(editor)).toEqual([
      { namedQuery: { name: "posts.most-read" }, limit: 6 },
    ]);
  });

  it("keeps one that needs an input on screen, writes nothing, and tags the canvas until it can run", async () => {
    const editor = mount({ collection: "posts", limit: 6 });
    await openSource("Posts");
    fireEvent.click(screen.getByRole("option", { name: /^Upcoming events/ }));
    // Chosen on screen, nothing written: the list still stores Posts.
    expect(editor.apply).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Source Upcoming events" })
    ).toBeDefined();
    expect(
      screen.getByText(
        "Upcoming events needs a city. Nothing on the page changes until it's entered."
      )
    ).toBeDefined();
    expect(
      screen.getByText("Enter city. Upcoming events needs it to run.")
    ).toBeDefined();
    await waitFor(() =>
      expect(editor.tagListStillShowing).toHaveBeenLastCalledWith(
        "list",
        "Still showing Posts"
      )
    );
    // The default shows as what empty means, and is not stored.
    expect(
      (screen.getByRole("spinbutton", { name: "Within" }) as HTMLInputElement)
        .placeholder
    ).toBe("30");
    const city = screen.getByRole("textbox", { name: "City" });
    fireEvent.change(city, { target: { value: "Lahore" } });
    fireEvent.keyDown(city, { key: "Enter" });
    // The source and its input in one write, every other source cleared.
    expect(writes(editor)).toEqual([
      {
        namedQuery: { name: "events.upcoming", params: { city: "Lahore" } },
        limit: 6,
      },
    ]);
  });

  it("writes a new source whose inputs equal the stored source's, since the source itself changed", async () => {
    const editor = mount({
      namedQuery: { name: "events.upcoming", params: { city: "Lahore" } },
    });
    await openSource("Upcoming events");
    fireEvent.click(screen.getByRole("option", { name: /^Events archive/ }));
    expect(editor.apply).not.toHaveBeenCalled();
    const city = screen.getByRole("textbox", { name: "City" });
    fireEvent.change(city, { target: { value: "Lahore" } });
    fireEvent.keyDown(city, { key: "Enter" });
    expect(writes(editor)).toEqual([
      { namedQuery: { name: "events.archive", params: { city: "Lahore" } } },
    ]);
  });

  it("puts a related or collection source back in one write that removes the custom one", async () => {
    const editor = mount({
      namedQuery: { name: "posts.most-read" },
      limit: 6,
    });
    await openSource("Most read this month");
    fireEvent.click(screen.getByRole("option", { name: "Posts" }));
    expect(writes(editor)).toEqual([{ collection: "posts", limit: 6 }]);
  });
});

describe("a list whose source is a custom one", () => {
  it("says the query sets filters and sort, and offers no control for them", async () => {
    mount({ namedQuery: { name: "posts.most-read" } });
    expect(
      await screen.findByText(
        "Set by Most read this month: it decides which entries show, and their order."
      )
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add filter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add sort" })).toBeNull();
  });

  it("cautions, naming the fields, that it reads what visitors can't, and refuses nothing", async () => {
    mount({ namedQuery: { name: "posts.most-read" } });
    expect(
      await screen.findByText(
        "It reads views from Page views, which visitors can't read, so visitors see the rows without them."
      )
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Source Most read this month" })
        .getAttribute("aria-invalid")
    ).toBeNull();
  });

  it("names a stored query this site no longer registers, keeping its inputs", async () => {
    mount({ namedQuery: { name: "events.gone", params: { city: "lahore" } } });
    expect(
      await screen.findByRole("button", {
        name: "Source events.gone · not available",
      })
    ).toBeDefined();
    expect(
      screen.getByText(
        '"events.gone" isn\'t set up on this site any more, so visitors see the empty state. Choose another source.'
      )
    ).toBeDefined();
    expect(
      screen.getByText(
        "Kept as stored until you choose another source: city “lahore”."
      )
    ).toBeDefined();
  });

  it("writes nothing while an input is emptied that the query needs", async () => {
    const editor = mount({
      namedQuery: { name: "events.upcoming", params: { city: "Lahore" } },
    });
    const city = await screen.findByRole("textbox", { name: "City" });
    fireEvent.change(city, { target: { value: "" } });
    fireEvent.blur(city);
    expect(editor.apply).not.toHaveBeenCalled();
    expect(
      screen.getByText("Enter city. Upcoming events needs it to run.")
    ).toBeDefined();
  });
});

describe("custom sources when a read fails", () => {
  it("offers them at once while the collections are still being read", async () => {
    const editor = mount(
      { collection: "posts" },
      // Never answers: the collections are still loading.
      { listLoopCollections: vi.fn(() => new Promise<never>(() => undefined)) }
    );
    await openSource("posts");
    fireEvent.click(
      screen.getByRole("option", { name: /^Most read this month/ })
    );
    expect(writes(editor)).toEqual([
      { namedQuery: { name: "posts.most-read" } },
    ]);
  });

  it("offers them alone when the collections cannot be listed", async () => {
    mount(
      { namedQuery: { name: "posts.most-read" } },
      { listLoopCollections: vi.fn(() => Promise.reject(new Error("down"))) }
    );
    expect(
      await screen.findByText(
        "The site's collections could not be listed, so only its custom sources are offered here."
      )
    ).toBeDefined();
    await openSource("Most read this month");
    const groups = within(
      screen.getByRole("listbox", { name: "Sources" })
    ).getAllByRole("group");
    expect(groups.map(group => group.getAttribute("aria-label"))).toEqual([
      "Custom sources",
    ]);
  });

  it("asks again for the custom sources after a failed read, without the field being drawn again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const listCustomSources = vi
        .fn<() => Promise<readonly CustomSource[]>>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue([UPCOMING]);
      mount({ collection: "posts" }, { listCustomSources });
      await waitFor(() => expect(listCustomSources).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await waitFor(() => expect(listCustomSources).toHaveBeenCalledTimes(2));
      await openSource("Posts");
      expect(
        screen.getByRole("option", { name: /^Upcoming events/ })
      ).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
