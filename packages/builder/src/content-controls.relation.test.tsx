// @vitest-environment jsdom

/**
 * The relation control, with the host's `findEntries` stood in for.
 *
 * - Focusing the search reads the first matches; typing reads again; choosing
 *   one stores its id and nothing else; Clear drops the prop.
 * - A stored id is named by its title, read back by id; an entry the author
 *   can't read is said so, never shown as a bare id.
 * - A slow earlier read cannot replace the matches of a later one.
 * - Without the service, or without a collection, it says so and offers no
 *   search; on a locked block it is read-only.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type {
  ContentServices,
  EntryQuery,
  FoundEntry,
} from "./content-controls";
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

function register(relationTo: unknown = "posts"): void {
  registerBlocks(
    [
      {
        name: "acme/teaser",
        version: 1,
        description: "Points at one post.",
        example: { props: {} },
        editor: { label: "Teaser" },
        props: { post: { role: "content", type: "relation", relationTo } },
        render: () => null,
      },
    ] as never,
    { source: "content-controls-relation-test" }
  );
}

function editorFor(
  props: Record<string, unknown>,
  extra: Partial<BlockNode> = {}
) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/teaser",
        version: 1,
        props,
        ...extra,
      } as BlockNode,
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
    // Nothing composed around the page: its own tree is all there is.
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

const POSTS: readonly FoundEntry[] = [
  { id: "p-1", title: "First post" },
  { id: "p-2", title: "Hello world" },
];

/** A service answering from POSTS: by id, or by a case-blind title match. */
function postsService() {
  return vi.fn(
    async (query: EntryQuery): Promise<readonly FoundEntry[]> =>
      query.ids !== undefined
        ? POSTS.filter(post => query.ids?.includes(post.id))
        : POSTS.filter(post =>
            post.title
              .toLowerCase()
              .includes((query.search ?? "").toLowerCase())
          )
  );
}

function mount(
  props: Record<string, unknown>,
  services: ContentServices | undefined,
  extra: Partial<BlockNode> = {}
) {
  const editor = editorFor(props, extra);
  render(
    <InspectorPanel
      editor={editor}
      {...(services === undefined ? {} : { contentServices: services })}
    />
  );
  return editor;
}

const search = () => screen.getByRole("searchbox", { name: "Search Post" });

describe("the relation control", () => {
  it("reads matches when focused and as the author types, and stores only the id", async () => {
    register();
    const findEntries = postsService();
    const editor = mount({}, { findEntries });

    expect(screen.getByText("Nothing chosen.")).toBeDefined();
    // Nothing is read before the author asks.
    expect(findEntries).not.toHaveBeenCalled();
    fireEvent.focus(search());
    await screen.findByRole("button", { name: "First post" });
    expect(findEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: "posts", search: "", limit: 10 })
    );

    fireEvent.change(search(), { target: { value: "hello" } });
    await screen.findByRole("button", { name: "Hello world" });
    // The control: the non-matching post is gone from the list.
    expect(screen.queryByRole("button", { name: "First post" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hello world" }));
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { props: { post: "p-2" } },
    });
  });

  it("names a stored entry by its title, and drops the prop on Clear", async () => {
    register();
    const findEntries = postsService();
    const editor = mount({ post: "p-1" }, { findEntries });

    await screen.findByText("First post");
    expect(findEntries).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "posts", ids: ["p-1"] })
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Post" }));
    const call = editor.apply.mock.calls[0]?.[0] as {
      patch: { props: object };
    };
    expect(call.patch.props).toEqual({});
  });

  it("says when the stored entry can't be read, rather than showing its id", async () => {
    register();
    mount({ post: "p-gone" }, { findEntries: postsService() });
    await screen.findByText(
      "An entry you can't open here, or one that was removed."
    );
    expect(screen.queryByText("p-gone")).toBeNull();
  });

  it("keeps a later search's matches when an earlier read answers last", async () => {
    register();
    const pending: Array<{
      query: EntryQuery;
      answer: (entries: readonly FoundEntry[]) => void;
    }> = [];
    const findEntries = vi.fn(
      (query: EntryQuery) =>
        new Promise<readonly FoundEntry[]>(resolve => {
          pending.push({ query, answer: resolve });
        })
    );
    mount({}, { findEntries });

    fireEvent.focus(search());
    fireEvent.change(search(), { target: { value: "first" } });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(search(), { target: { value: "hello" } });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[1]?.answer([POSTS[1] as FoundEntry]);
    });
    await act(async () => {
      pending[0]?.answer([POSTS[0] as FoundEntry]);
    });
    expect(screen.getByRole("button", { name: "Hello world" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "First post" })).toBeNull();
    // The earlier read was told it was no longer wanted.
    expect(pending[0]?.query.signal?.aborted).toBe(true);
  });

  it("says when entries can't be searched here, and offers no search", () => {
    register();
    mount({}, {});
    expect(screen.getByText("Entries can't be searched here.")).toBeDefined();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("says when the prop names no collection", () => {
    register("");
    mount({}, { findEntries: postsService() });
    expect(
      screen.getByText("This field names no collection to choose from.")
    ).toBeDefined();
  });

  it("is read-only on a locked block, and reads nothing", async () => {
    register();
    const findEntries = postsService();
    mount({ post: "p-1" }, { findEntries }, { locked: true });
    await screen.findByText("First post");
    expect(search().matches(":disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Clear Post" }).matches(":disabled")
    ).toBe(true);
    fireEvent.focus(search());
    // Only the title read: a disabled field starts no search.
    expect(findEntries).toHaveBeenCalledTimes(1);
  });
});
