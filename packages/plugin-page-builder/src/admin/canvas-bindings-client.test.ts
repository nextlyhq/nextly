// @vitest-environment jsdom

/**
 * The canvas's binding sources: asked only for what the page's bindings read,
 * and kept per signed-in person, so no person is ever handed another's.
 */
import {
  composeEntryContent,
  defineNamedQuery,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The document the hook test edits; the other tests pass theirs in. */
const editing = vi.hoisted(() => ({
  userId: "u1" as string | null,
  identity: null as null | {
    kind: "collection";
    slug: string;
    documentId: string;
  },
}));
const writePluginRoute = vi.hoisted(() => vi.fn());

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => editing.userId,
  useDocumentIdentity: () => editing.identity,
  writePluginRoute,
}));

const { canvasBindingsFor, canvasBindingsRequest, useCanvasBindings } =
  await import("./canvas-bindings-client");
const { CanvasEntryProvider } = await import("./editor/canvas-entry");

/** The retries the editor has asked for, which a wrapper hands the canvas. */
let retries = 0;

const page = (bindings?: Record<string, unknown>): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: { text: "Fallback", level: "h1" },
        ...(bindings === undefined ? {} : { bindings }),
      },
    ],
  }) as BlockDocument;

const identity = {
  kind: "collection" as const,
  slug: "posts",
  documentId: "p1",
};

const answer = (title: string) => ({
  entry: { id: "p1", title },
  entryRef: { collection: "posts" },
  singles: [],
  shapes: [],
});

describe("the canvas's binding sources", () => {
  it("asks for what the page's bindings read, and nothing for a page without", () => {
    expect(canvasBindingsRequest([page()], identity, "en")).toBeUndefined();
    expect(
      canvasBindingsRequest([page({ text: { $bind: "title" } })], null, "en")
    ).toBeUndefined();
    expect(
      canvasBindingsRequest(
        [page({ text: { $bind: "title" } })],
        identity,
        "en"
      )
    ).toEqual({
      source: { kind: "collection", slug: "posts", id: "p1" },
      demand: {
        entry: { fields: ["title"], follows: {} },
        singles: {},
        site: false,
        formatsDates: false,
      },
      lists: [],
      locale: "en",
    });
  });

  it("names the collections the page's lists draw", () => {
    // A list item's binding is judged by its list's public field shapes, so
    // the canvas asks for them as the published route reads them.
    const listed: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts" },
          slots: {
            template: [
              {
                id: "t",
                type: "core/heading",
                version: 1,
                props: { text: "Fallback", level: "h2" },
                bindings: { text: { $bind: "title", source: "item" } },
              },
            ],
          },
        },
      ],
    } as BlockDocument;
    expect(canvasBindingsRequest([listed], identity, undefined)?.lists).toEqual(
      ["posts"]
    );
  });

  it("names the collection a custom source's rows are entries of, given the site's queries", () => {
    // A list whose source is a named query of `posts` entries draws those
    // entries, so its item bindings need `posts`' shapes, as on the page.
    const listed: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { namedQuery: { name: "posts.latest", params: {} } },
          slots: {
            template: [
              {
                id: "t",
                type: "core/heading",
                version: 1,
                props: { text: "Fallback", level: "h2" },
                bindings: { text: { $bind: "title", source: "item" } },
              },
            ],
          },
        },
      ],
    } as BlockDocument;
    const latest = defineNamedQuery({
      name: "posts.latest",
      label: "Latest posts",
      reads: { collections: ["posts"] },
      rows: { collection: "posts" },
      run: () => Promise.resolve({ rows: [] }),
    });
    const namedQueries = {
      definitionOf: (name: string) =>
        name === "posts.latest" ? latest : undefined,
    };
    expect(
      canvasBindingsRequest([listed], identity, undefined, false, namedQueries)
        ?.lists
    ).toEqual(["posts"]);
    // Without the site's queries the custom source is no collection's, as
    // before they are read.
    expect(
      canvasBindingsRequest([listed], identity, undefined)?.lists ?? []
    ).toEqual([]);
  });

  it("asks for what a Layout region's bindings read, beside the page's", () => {
    // The page binds nothing; its header region binds a Single. The canvas
    // draws both, so it asks for both, as the published route reads them.
    const header = page({
      text: { $bind: "tagline", source: "single", sourceKey: "brand" },
    });
    expect(
      canvasBindingsRequest([page(), header], identity, "en")?.demand.singles
    ).toEqual({ brand: { fields: ["tagline"], follows: {} } });
  });

  it("asks no entry for a component's own document", () => {
    // A placed component reads each placing page's entry, so its preview
    // must not read the component's storage row as one.
    const bound = page({
      text: { $bind: "title" },
      level: { $bind: "size", source: "single", sourceKey: "brand" },
    });
    const asked = canvasBindingsRequest([bound], identity, "en", true);
    expect(asked?.demand.entry).toBeUndefined();
    expect(asked?.demand.singles).toEqual({
      brand: { fields: ["size"], follows: {} },
    });
    // With nothing else to read, nothing is asked at all.
    expect(
      canvasBindingsRequest(
        [page({ text: { $bind: "title" } })],
        identity,
        "en",
        true
      )
    ).toBeUndefined();
    // The control: the same page, not a component, asks for its entry.
    expect(
      canvasBindingsRequest([bound], identity, "en")?.demand.entry
    ).toEqual({ fields: ["title"], follows: {} });
  });

  it("reads them back as the renderer takes them", async () => {
    const request = canvasBindingsRequest(
      [page({ text: { $bind: "title" } })],
      identity,
      undefined
    );
    if (request === undefined) throw new Error("no ask");
    const bindings = await canvasBindingsFor(request, "reader-1", async () =>
      answer("Draft title")
    );
    expect(bindings.entry).toEqual({ id: "p1", title: "Draft title" });
    expect(bindings.singles).toBeInstanceOf(Map);
  });

  it("never hands one person's kept answer to another", async () => {
    const request = canvasBindingsRequest(
      [page({ text: { $bind: "title" } })],
      identity,
      "fr"
    );
    if (request === undefined) throw new Error("no ask");
    const ask = vi.fn(async () => answer("A's draft"));
    const first = await canvasBindingsFor(request, "author-a", ask);
    // The same ask again for the same person is answered from what was kept.
    await canvasBindingsFor(request, "author-a", ask);
    expect(ask).toHaveBeenCalledTimes(1);
    // Another person signs in in the same tab: they are asked for afresh.
    const other = vi.fn(async () => answer("B's view"));
    const second = await canvasBindingsFor(request, "author-b", other);
    expect(other).toHaveBeenCalledTimes(1);
    expect(second.entry).toEqual({ id: "p1", title: "B's view" });
    expect(first.entry).toEqual({ id: "p1", title: "A's draft" });
  });

  it("asks afresh for a read the editor asks again, whatever was kept", async () => {
    const request = canvasBindingsRequest(
      [page({ text: { $bind: "title" } })],
      identity,
      "de"
    );
    if (request === undefined) throw new Error("no ask");
    const ask = vi.fn(async () => answer("Old title"));
    await canvasBindingsFor(request, "author-f", ask);
    // The control: the same ask again is answered from what was kept.
    await canvasBindingsFor(request, "author-f", ask);
    expect(ask).toHaveBeenCalledTimes(1);
    // Asked again, as a retry or the window back in focus asks it: read
    // afresh, and the new answer is the one handed back.
    ask.mockImplementationOnce(async () => answer("New title"));
    const fresh = await canvasBindingsFor(request, "author-f", ask, true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(fresh.entry).toEqual({ id: "p1", title: "New title" });
  });

  it("drops the earlier answer when a changed ask fails", async () => {
    editing.identity = identity;
    const bound = [page({ text: { $bind: "title" } })];
    writePluginRoute.mockResolvedValueOnce(answer("English title"));
    const { result, rerender } = renderHook(
      ({ locale }: { locale: string }) => useCanvasBindings(bound, locale),
      { initialProps: { locale: "en" } }
    );
    await waitFor(() =>
      expect(result.current.entry).toEqual({ id: "p1", title: "English title" })
    );
    // The editor switches locale and that read fails: the English value must
    // not go on standing in for the German page.
    writePluginRoute.mockRejectedValueOnce(new Error("offline"));
    rerender({ locale: "de" });
    await waitFor(() => expect(result.current.entry).toBeUndefined());
    expect(writePluginRoute).toHaveBeenCalledTimes(2);
    editing.identity = null;
  });

  it("asks nothing while the signed-in person is not known", async () => {
    // The route answers whoever the session names, and before the person is
    // known that may already be another account: nothing is asked or kept.
    editing.identity = identity;
    editing.userId = null;
    writePluginRoute.mockClear();
    writePluginRoute.mockResolvedValue(answer("Someone's draft"));
    const { result } = renderHook(() =>
      useCanvasBindings([page({ text: { $bind: "title" } })], "es")
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(writePluginRoute).not.toHaveBeenCalled();
    expect(result.current.entry).toBeUndefined();
    editing.userId = "u1";
    editing.identity = null;
  });

  it("asks again once an answer has been kept its while", async () => {
    // A source can change while what the page asks stays the same: the
    // author saves a new title, or someone updates a Single.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      editing.identity = identity;
      writePluginRoute.mockReset();
      writePluginRoute
        .mockResolvedValueOnce(answer("Before the save"))
        .mockResolvedValueOnce(answer("After the save"));
      const drawn = [page({ text: { $bind: "title" } })];
      const { result } = renderHook(() => useCanvasBindings(drawn, "it"));
      await waitFor(() =>
        expect(result.current.entry).toEqual({
          id: "p1",
          title: "Before the save",
        })
      );
      await vi.advanceTimersByTimeAsync(15_001);
      await waitFor(() =>
        expect(result.current.entry).toEqual({
          id: "p1",
          title: "After the save",
        })
      );
      expect(writePluginRoute).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      editing.identity = null;
    }
  });
});

describe("the canvas's entry, for a template", () => {
  /** The template being edited: an entry of the templates collection. */
  const template = {
    kind: "collection" as const,
    slug: "templates",
    documentId: "t1",
  };

  /** The source the route was asked to read, from the last ask. */
  const askedSource = () =>
    (
      writePluginRoute.mock.calls.at(-1)?.[0] as
        | { body: { source: unknown } }
        | undefined
    )?.body.source;

  it("reads the previewed entry of the template's collection, not the template's own row", async () => {
    editing.identity = template;
    writePluginRoute.mockReset();
    writePluginRoute.mockResolvedValue(answer("A post"));
    const drawn = [page({ text: { $bind: "title" } })];
    renderHook(() => useCanvasBindings(drawn, "pt"), {
      wrapper: ({ children }) =>
        CanvasEntryProvider({
          identity: { kind: "collection", slug: "posts", documentId: "p9" },
          children,
        }),
    });
    await waitFor(() => expect(writePluginRoute).toHaveBeenCalled());
    expect(askedSource()).toEqual({
      kind: "collection",
      slug: "posts",
      id: "p9",
    });
    editing.identity = null;
  });

  it("reads no entry while there is none to preview, so bound text draws its fallback", async () => {
    editing.identity = template;
    writePluginRoute.mockReset();
    writePluginRoute.mockResolvedValue(answer("unused"));
    const drawn = [page({ text: { $bind: "title" } })];
    renderHook(() => useCanvasBindings(drawn, "nl"), {
      wrapper: ({ children }) =>
        CanvasEntryProvider({
          identity: { kind: "collection", slug: "posts" },
          children,
        }),
    });
    await waitFor(() => expect(writePluginRoute).toHaveBeenCalled());
    expect(askedSource()).toEqual({ kind: "collection", slug: "posts" });
    editing.identity = null;
  });

  it("reads a page's own entry where no entry is given (the control)", async () => {
    editing.identity = identity;
    writePluginRoute.mockReset();
    writePluginRoute.mockResolvedValue(answer("Its own title"));
    const drawn = [page({ text: { $bind: "title" } })];
    renderHook(() => useCanvasBindings(drawn, "sv"));
    await waitFor(() => expect(writePluginRoute).toHaveBeenCalled());
    expect(askedSource()).toEqual({
      kind: "collection",
      slug: "posts",
      id: "p1",
    });
    editing.identity = null;
  });
});

describe("a retry the editor asks for", () => {
  it("is pending while its read is on its way, not answered by the read before it", async () => {
    editing.identity = {
      kind: "collection",
      slug: "templates",
      documentId: "t2",
    };
    writePluginRoute.mockReset();
    writePluginRoute.mockResolvedValueOnce(answer("Old title"));
    const heard: { entryId: string | undefined; state: string }[] = [];
    const onRead = (read: { entryId: string | undefined; state: string }) =>
      heard.push(read);
    let retry = 0;
    const drawn = [page({ text: { $bind: "title" } })];
    const { rerender } = renderHook(() => useCanvasBindings(drawn, "es"), {
      wrapper: ({ children }) =>
        CanvasEntryProvider({
          identity: { kind: "collection", slug: "posts", documentId: "p8" },
          retry,
          onRead,
          children,
        }),
    });
    // The control: the first read is answered.
    await waitFor(() =>
      expect(heard.at(-1)).toEqual({ entryId: "p8", state: "answered" })
    );

    // The window back in focus: a retry, whose read has not answered yet.
    let release: (value: unknown) => void = () => {};
    writePluginRoute.mockImplementationOnce(
      () => new Promise(resolve => (release = resolve))
    );
    retry = 1;
    rerender();
    await waitFor(() =>
      expect(heard.at(-1)).toEqual({ entryId: "p8", state: "pending" })
    );
    release(answer("New title"));
    await waitFor(() =>
      expect(heard.at(-1)).toEqual({ entryId: "p8", state: "answered" })
    );
    editing.identity = null;
  });
});

describe("a binding inside a template's Entry content", () => {
  it("is asked for once the previewed entry's blocks are composed in, as the published page asks", () => {
    // The template holds no binding of its own; the entry's Body holds a
    // heading bound to its excerpt.
    const template = {
      formatVersion: 1,
      kind: "template",
      nodes: [
        {
          id: "ec",
          type: "core/entry-content",
          version: 1,
          props: { field: "body" },
        },
      ],
    } as BlockDocument;
    const body = page({ text: { $bind: "excerpt" } });
    // The control: the template as stored asks for nothing.
    expect(canvasBindingsRequest([template], identity, "en")).toBeUndefined();
    const composed = composeEntryContent(template, {
      valueOf: field => (field === "body" ? body : undefined),
    });
    expect(
      canvasBindingsRequest([composed], identity, "en")?.demand.entry
    ).toEqual({ fields: ["excerpt"], follows: {} });
  });
});

describe("the canvas's read, as the template's strip hears it", () => {
  it("says the read failed, and asks again when the editor retries", async () => {
    editing.identity = {
      kind: "collection",
      slug: "templates",
      documentId: "t1",
    };
    writePluginRoute.mockReset();
    writePluginRoute.mockRejectedValueOnce(new Error("offline"));
    const heard: { entryId: string | undefined; state: string }[] = [];
    const onRead = (read: { entryId: string | undefined; state: string }) =>
      heard.push(read);
    const drawn = [page({ text: { $bind: "title" } })];
    const { rerender } = renderHook(() => useCanvasBindings(drawn, "da"), {
      wrapper: ({ children }) =>
        CanvasEntryProvider({
          identity: { kind: "collection", slug: "posts", documentId: "p7" },
          retry: retries,
          onRead,
          children,
        }),
    });
    await waitFor(() =>
      expect(heard.at(-1)).toEqual({ entryId: "p7", state: "failed" })
    );
    // Nothing asks again on its own: the same ask is not remade.
    expect(writePluginRoute).toHaveBeenCalledTimes(1);

    writePluginRoute.mockResolvedValueOnce(answer("A post"));
    retries = 1;
    rerender();
    await waitFor(() =>
      expect(heard.at(-1)).toEqual({ entryId: "p7", state: "answered" })
    );
    expect(writePluginRoute).toHaveBeenCalledTimes(2);

    // Answered and kept, a retry still reads afresh: the window back in
    // focus asks one, and the canvas must not answer it from what it kept.
    writePluginRoute.mockResolvedValueOnce(answer("A post, retitled"));
    retries = 2;
    rerender();
    await waitFor(() => expect(writePluginRoute).toHaveBeenCalledTimes(3));
    retries = 0;
    editing.identity = null;
  });
});
