// @vitest-environment jsdom

/**
 * The canvas's binding sources: asked only for what the page's bindings read,
 * and kept per signed-in person, so no person is ever handed another's.
 */
import {
  clearBlocks,
  composeEntryContent,
  defineNamedQuery,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { act, renderHook, waitFor } from "@testing-library/react";
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
/** What the canvas handed its change check on each render. */
const checked = vi.hoisted(() => [] as unknown[]);
/** The first mark the canvas handed its change check on each render. */
const firstMarks = vi.hoisted(() => [] as unknown[]);

// The change check has its own tests; here it would share the mocked route
// with the read under test, so only what it is handed is recorded.
vi.mock("./editor/canvas-source-check", async importOriginal => ({
  // The rule for when the first reads are in stays real; only the check
  // itself is watched.
  ...(await importOriginal<typeof import("./editor/canvas-source-check")>()),
  useCanvasSourceCheck: (
    asked: unknown,
    _userId: unknown,
    _ask: unknown,
    _firstReadsIn: unknown,
    firstMark: unknown
  ) => {
    checked.push(asked);
    firstMarks.push(firstMark);
  },
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => editing.userId,
  useDocumentIdentity: () => editing.identity,
  writePluginRoute,
}));

const {
  canvasBindingsFor,
  canvasBindingsRequest,
  listConditionsFor,
  siteTimeZoneFor,
  useCanvasBindings,
} = await import("./canvas-bindings-client");
const { CanvasEntryProvider } = await import("./editor/canvas-entry");
const { canvasSourcesChanged } = await import("./canvas-sources");

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

  it("asks under what the page has left, `null` where the site sets no limit", () => {
    const ask = (allowance: number) =>
      canvasBindingsRequest(
        [page({ text: { $bind: "title" } })],
        identity,
        "en",
        false,
        undefined,
        { allowance }
      )?.allowance;
    expect(ask(12.5)).toBe(12);
    // JSON has no Infinity: it would arrive as a null the route refuses.
    expect(ask(Number.POSITIVE_INFINITY)).toBeNull();
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

  it("asks for a list's field shapes where only its entries' conditions read them, and nothing of the entry", () => {
    // Nothing binds: the list's entry block has only conditions, judged by
    // the list's public field shapes while conditions are applied.
    const withEntries = (child: Record<string, unknown>): BlockDocument =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "list",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts" },
            slots: {
              children: [
                {
                  id: "t",
                  type: "core/text",
                  version: 1,
                  props: { text: "Members only" },
                  ...child,
                },
              ],
            },
          },
        ],
      }) as BlockDocument;
    const plain = withEntries({});
    const conditioned = withEntries({
      visibility: {
        conditions: [[{ field: "price", op: "greater_than", value: 10 }]],
      },
    });
    const ask = (page: BlockDocument) => {
      const conditions = listConditionsFor(page.nodes);
      return canvasBindingsRequest(
        [page],
        identity,
        undefined,
        false,
        undefined,
        conditions === undefined ? {} : { conditions }
      );
    };
    // CONTROL: the same page with no condition asks nothing.
    expect(listConditionsFor(plain.nodes)).toBeUndefined();
    expect(ask(plain)).toBeUndefined();
    // The page's own condition is what asks: the list's shapes, nothing of
    // the entry, and the site's zone, since it orders a value.
    const request = ask(conditioned);
    expect(request?.lists).toEqual(["posts"]);
    expect(request?.demand.entry).toBeUndefined();
    expect(request?.conditions).toEqual({
      any: true,
      entryFields: [],
      ordersValues: true,
    });
    // A stored alias orders a value too, read as the engine reads it.
    const legacy = withEntries({
      visibility: {
        conditions: [[{ field: "publishedAt", op: "lt", value: "2026-03-02" }]],
      },
    });
    expect(listConditionsFor(legacy.nodes)?.ordersValues).toBe(true);
    // An equality orders nothing, so the zone is not asked for.
    const equality = withEntries({
      visibility: {
        conditions: [[{ field: "title", op: "equals", value: "Alder" }]],
      },
    });
    expect(listConditionsFor(equality.nodes)?.ordersValues).toBe(false);
    // A gate a placement carries onto a component's root orders a value too.
    const carried = withEntries({
      visibility: {
        within: [
          {
            conditions: [
              [{ field: "publishedAt", op: "less_than", value: "2026-03-02" }],
            ],
          },
        ],
      },
    });
    expect(listConditionsFor(carried.nodes)?.ordersValues).toBe(true);
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

  it("keeps an answer while the ask stays the same, however long", async () => {
    // A lock renewal, an edit to an unrelated block or a minute's wait asks
    // nothing again: only the ask or the data it read changing does.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      editing.identity = identity;
      writePluginRoute.mockReset();
      writePluginRoute.mockResolvedValue(answer("Kept"));
      const bound = page({ text: { $bind: "title" } });
      const { result, rerender } = renderHook(
        ({ drawn }: { drawn: BlockDocument[] }) =>
          useCanvasBindings(drawn, "it"),
        { initialProps: { drawn: [bound] } }
      );
      await waitFor(() =>
        expect(result.current.entry).toEqual({ id: "p1", title: "Kept" })
      );
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      // A new tree in which only a prop nothing binds changed.
      const [heading] = bound.nodes;
      if (heading === undefined) throw new Error("no heading");
      rerender({
        drawn: [
          {
            ...bound,
            nodes: [{ ...heading, props: { ...heading.props, level: "h2" } }],
          },
        ],
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writePluginRoute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      editing.identity = null;
    }
  });

  it("asks again once the sources it read have changed", async () => {
    // A source can change while what the page asks stays the same: the
    // author saves a new title, or someone updates a Single.
    editing.identity = identity;
    try {
      writePluginRoute.mockReset();
      writePluginRoute
        .mockResolvedValueOnce(answer("Before the save"))
        .mockResolvedValueOnce(answer("After the save"));
      const drawn = [page({ text: { $bind: "title" } })];
      const { result } = renderHook(() => useCanvasBindings(drawn, "pt"));
      await waitFor(() =>
        expect(result.current.entry).toEqual({
          id: "p1",
          title: "Before the save",
        })
      );
      act(() => canvasSourcesChanged());
      await waitFor(() =>
        expect(result.current.entry).toEqual({
          id: "p1",
          title: "After the save",
        })
      );
      expect(writePluginRoute).toHaveBeenCalledTimes(2);
    } finally {
      editing.identity = null;
    }
  });

  it("checks the collection a bound list draws once the answer is in, not its stored fallback", async () => {
    editing.identity = identity;
    try {
      checked.length = 0;
      writePluginRoute.mockReset();
      writePluginRoute.mockResolvedValue({
        ...answer("Kinds"),
        entry: { id: "p1", title: "Kinds", kind: "products" },
      });
      // A loop stored over posts whose collection is bound to the entry's
      // "kind", which names products.
      const listing: BlockDocument = {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "l",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts" },
            bindings: { collection: { $bind: "kind" } },
          },
        ],
      } as BlockDocument;
      registerBlocks(coreBlocks, { source: "page-builder" });
      renderHook(() => useCanvasBindings([listing], "en"));
      await waitFor(() =>
        expect(
          (checked.at(-1) as { lists?: string[] } | undefined)?.lists
        ).toContain("products")
      );
    } finally {
      clearBlocks();
      editing.identity = null;
    }
  });

  it("hands the change check the mark its first reads carried", async () => {
    editing.identity = identity;
    try {
      firstMarks.length = 0;
      writePluginRoute.mockReset();
      writePluginRoute.mockResolvedValue({ ...answer("Marked"), stamp: "m1" });
      renderHook(() =>
        useCanvasBindings([page({ text: { $bind: "title" } })], "de")
      );
      await waitFor(() => expect(firstMarks.at(-1)).toBe("m1"));
      // Nothing before the answer was in.
      expect(firstMarks.slice(0, -1).every(mark => mark === undefined)).toBe(
        true
      );
    } finally {
      editing.identity = null;
    }
  });

  it("hands no first mark where the check asks about more than the reads did", async () => {
    editing.identity = identity;
    try {
      firstMarks.length = 0;
      checked.length = 0;
      writePluginRoute.mockReset();
      writePluginRoute.mockResolvedValue({
        ...answer("Kinds"),
        entry: { id: "p1", title: "Kinds", kind: "products" },
        stamp: "m2",
      });
      // The answer binds the list to products, which the reads did not mark.
      const listing: BlockDocument = {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "l",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts" },
            bindings: { collection: { $bind: "kind" } },
          },
        ],
      } as BlockDocument;
      registerBlocks(coreBlocks, { source: "page-builder" });
      renderHook(() => useCanvasBindings([listing], "nl"));
      await waitFor(() =>
        expect(
          (checked.at(-1) as { lists?: string[] } | undefined)?.lists
        ).toContain("products")
      );
      expect(firstMarks.at(-1)).toBeUndefined();
    } finally {
      clearBlocks();
      editing.identity = null;
    }
  });

  it("checks a page that only lists entries for changes to them, though it binds nothing", () => {
    editing.identity = identity;
    try {
      checked.length = 0;
      const listing: BlockDocument = {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "l",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts" },
          },
        ],
      } as BlockDocument;
      renderHook(() => useCanvasBindings([listing], "fr"));
      // In the language being edited, as the list's rows are read.
      expect(checked.at(-1)).toEqual({
        source: { kind: "collection", slug: "posts", id: "p1" },
        singles: [],
        lists: ["posts"],
        locale: "fr",
      });
      // CONTROL: a page that reads nothing is checked for nothing.
      renderHook(() => useCanvasBindings([page()], "fr"));
      expect(checked.at(-1)).toBeUndefined();
    } finally {
      editing.identity = null;
    }
  });
});

describe("the site's time zone, for the inspector's previews", () => {
  /** The route's answer for a page that formats a date in a zone. */
  const zoned = (timeZone?: string) => ({
    entryRef: { collection: "posts" },
    singles: [],
    shapes: [],
    ...(timeZone === undefined ? {} : { timeZone }),
  });

  it("is not asked by a canvas whose page formats no date, though it binds", () => {
    // The control the inspector's own read exists for: a page binding only
    // text asks the canvas's read for no zone, so the canvas has none.
    const request = canvasBindingsRequest(
      [page({ text: { $bind: "title" } })],
      identity,
      "en"
    );
    expect(request?.demand.formatsDates).toBe(false);
  });

  it("is asked as a page that formats a date and reads nothing else", async () => {
    const ask = vi.fn(async () => zoned("Asia/Karachi"));
    const zone = await siteTimeZoneFor({}, identity, "author-a", ask);
    expect(zone).toBe("Asia/Karachi");
    expect(ask).toHaveBeenCalledWith({
      source: { kind: "collection", slug: "posts", id: "p1" },
      demand: { singles: {}, site: false, formatsDates: true },
      lists: [],
    });
  });

  it("is read once per editor session and person", async () => {
    const session = {};
    const ask = vi.fn(async () => zoned("Asia/Karachi"));
    await siteTimeZoneFor(session, identity, "author-a", ask);
    await siteTimeZoneFor(session, identity, "author-a", ask);
    expect(ask).toHaveBeenCalledTimes(1);
    // Another person in the same editor, or another editor: read again.
    await siteTimeZoneFor(session, identity, "author-b", ask);
    await siteTimeZoneFor({}, identity, "author-b", ask);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("is none for a site with no zone set", async () => {
    expect(
      await siteTimeZoneFor({}, identity, "author-a", async () => zoned())
    ).toBeUndefined();
  });

  it("is read again after a read that failed", async () => {
    const session = {};
    const ask = vi
      .fn<() => Promise<ReturnType<typeof zoned>>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(zoned("Asia/Karachi"));
    await expect(
      siteTimeZoneFor(session, identity, "author-a", ask)
    ).rejects.toThrow("offline");
    expect(await siteTimeZoneFor(session, identity, "author-a", ask)).toBe(
      "Asia/Karachi"
    );
    expect(ask).toHaveBeenCalledTimes(2);
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

describe("the page data limit the canvas reads its bindings under", () => {
  /** The bodies the canvas's binding asks sent, in order. */
  const askedBodies = (): Record<string, unknown>[] =>
    writePluginRoute.mock.calls.map(
      ([write]) => (write as { body: Record<string, unknown> }).body
    );

  /** The canvas's ask for a bound page under `allowance`, in `locale`. */
  async function askUnder(
    locale: string,
    allowance: number | undefined
  ): Promise<Record<string, unknown>> {
    editing.identity = identity;
    writePluginRoute.mockReset();
    writePluginRoute.mockResolvedValue(answer("A title"));
    const drawn = [page({ text: { $bind: "title" } })];
    const { result, unmount } = renderHook(() =>
      useCanvasBindings(drawn, locale, false, undefined, undefined, allowance)
    );
    try {
      await waitFor(() =>
        expect(result.current.entry).toEqual({ id: "p1", title: "A title" })
      );
      const [body] = askedBodies();
      if (body === undefined) throw new Error("nothing asked");
      return body;
    } finally {
      unmount();
      editing.identity = null;
    }
  }

  it("asks under the site's limit, as the published page reads its bindings", async () => {
    expect((await askUnder("la-1", 20)).allowance).toBe(20);
    expect((await askUnder("la-2", 1500)).allowance).toBe(1500);
  });

  it("asks with no limit, sent as null, for a site that sets none", async () => {
    const body = await askUnder("la-3", Number.POSITIVE_INFINITY);
    expect(body).toHaveProperty("allowance", null);
  });

  it("asks under the route's default where the site sets no limit", async () => {
    // Absent rather than 500: the same ask as before, which the route reads
    // as its default.
    expect(await askUnder("la-4", undefined)).not.toHaveProperty("allowance");
  });
});
