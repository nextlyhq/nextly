/**
 * What the insert panel is allowed to be told about the pattern library.
 *
 * The assertions that matter most are the two the author never sees: that the
 * read runs as the USER rather than with the instance's identity, and that it
 * asks the collection the host actually has rather than the one this package
 * declared. Getting either wrong offers every pattern to everyone, or none to
 * anyone, and the panel looks the same in both cases.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  patternRefusal,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  COMPLETION_CONCURRENCY,
  LIBRARY_PAGE_SIZE,
  MAX_LIBRARY_BYTES,
  MAX_LIBRARY_PATTERNS,
  readComponentLibrary,
  readPatternLibrary,
  type CollectionPage,
  type ComponentLibraryContext,
  type PatternLibraryContext,
} from "./library-route";

/** A stored row as the collection hands one back. */
function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Pattern ${id}`,
    granularity: "section",
    content: { formatVersion: 1, kind: "pattern", nodes: [] },
    ...extra,
  };
}

/**
 * A pattern-route context whose service answers with the pages given, in order.
 *
 * The spy is the point: what this route decides is WHICH read it makes, so the
 * arguments it passed are the observable behaviour rather than an
 * implementation detail.
 */
function contextOver(
  pages: unknown[][],
  self: Record<string, string | undefined> = {}
) {
  const queue = [...pages];
  // `hasMore` comes from the SERVICE, so the stub answers it the way the
  // service does: whether another page exists, which a shortened page cannot be
  // asked about by looking at its length.
  const listEntries = vi.fn((_slug: string, _options: unknown, _ctx: unknown) =>
    Promise.resolve({
      data: queue.shift() ?? [],
      pagination: { hasMore: queue.length > 0 },
    })
  );
  const ctx: PatternLibraryContext = {
    self: { collections: self },
    user: { id: "u1" },
    services: { collections: { listEntries } },
  };
  return { ctx, listEntries };
}

/**
 * A component-route context over the injected reads: a listing that answers
 * the pages given, and a by-id read that answers per id.
 *
 * The two spies are what the route is judged by, for the reason the pattern
 * stub's is: which reads it makes, against which slug, are the behaviour.
 */
function componentContext(
  components: {
    pages?: unknown[][];
    /** The by-id answer per component id; absent means the read found nothing. */
    byId?: Record<string, unknown>;
  } = {},
  self: Record<string, string | undefined> = {}
) {
  const queue = [...(components.pages ?? [])];
  const list = vi.fn(
    (_slug: string, _page: number): Promise<CollectionPage> =>
      Promise.resolve({
        data: queue.shift() ?? [],
        hasMore: queue.length > 0,
      })
  );
  // The by-id read answers on the NEXT macrotask, and counts how many reads
  // are waiting at once: that is the observable of a walk that overlaps its
  // reads, and a stub answering synchronously could never show more than one.
  const inFlight = { now: 0, most: 0 };
  const read = vi.fn(async (_slug: string, id: string) => {
    inFlight.now += 1;
    inFlight.most = Math.max(inFlight.most, inFlight.now);
    await new Promise(resolve => setTimeout(resolve, 0));
    inFlight.now -= 1;
    return components.byId?.[id];
  });
  const ctx: ComponentLibraryContext = {
    self: { collections: self },
    user: { id: "u1" },
    components: { list, read },
  };
  return { ctx, list, read, inFlight };
}

/** How many times the pattern collection was paged. */
function patternReads(listEntries: { mock: { calls: unknown[][] } }): number {
  return listEntries.mock.calls.length;
}

describe("what the library read asks for", () => {
  it("states NO lifecycle, and lets the service bound it", async () => {
    // Drafts must not be offered, and saying so here is how that goes wrong.
    // The read runs as the user, and an untrusted caller that states no
    // lifecycle already gets public states only — asked of the collection's
    // WORKFLOW, which knows which states are public and which release is due.
    //
    // A literal `status: "published"` is ANDed with that, so it re-hides a
    // draft belonging to a release whose time has come but whose drain has not
    // run; and it is a state NAME, so a workflow that calls its public state
    // anything else matches nothing and the library comes back empty.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    const options = listEntries.mock.calls[0]?.[1] as
      | { where?: unknown }
      | undefined;
    expect(options?.where).toBeUndefined();
  });

  it("asks for a DETERMINISTIC order, because it pages", async () => {
    // These are independent offset queries, and the service adds `ORDER BY`
    // only when a sort is asked for. Unordered, SQL is free to return rows in a
    // different order for successive pages — so one pattern arrives twice and
    // another never at all. The key has to be UNIQUE to be a tie-breaker.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[1]).toMatchObject({
      sort: { field: "id", direction: "asc" },
    });
  });

  it("reads AS THE USER, not with the instance's identity", async () => {
    // The route is authenticated, and this is what makes it also AUTHORIZED: a
    // read with the instance's own identity answers every caller with every
    // pattern, whatever the collection's permissions say.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[2]).toEqual({
      as: "user",
      user: { id: "u1" },
    });
  });

  it("asks the collection the HOST has, not the one this package declared", async () => {
    // An integrator may rename the collection. A route holding the literal
    // reads a collection that does not exist and answers an empty library,
    // which looks exactly like a site that has saved no patterns yet.
    const { ctx, listEntries } = contextOver([[row("a")]], {
      patterns: "design-patterns",
    });

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[0]).toBe("design-patterns");
  });

  it("falls back to the declared slug when the host renamed nothing", async () => {
    // The control for the test above: without it, a reader that always returned
    // the fallback would pass that one and this one would be the same green.
    const { ctx, listEntries } = contextOver([[row("a")]]);

    await readPatternLibrary(ctx);

    expect(listEntries.mock.calls[0]?.[0]).toBe("patterns");
  });
});

describe("what one row becomes", () => {
  it("carries the document whole, under the name the PANEL reads", async () => {
    // What a pattern document must BE is the planner's question, asked before
    // the panel offers it. A second reading here would be a narrower one that
    // disagrees the first time the format gains a field.
    const document = {
      formatVersion: 1,
      kind: "pattern",
      nodes: [{ id: "x" }],
    };
    const { ctx } = contextOver([[row("a", { content: document })]]);

    const library = await readPatternLibrary(ctx);

    expect(library.items[0]?.document).toEqual(document);
    expect(library.items[0]).not.toHaveProperty("content");
  });

  it("carries a null keywords through rather than dropping it", async () => {
    // Nextly writes an unset non-required field as SQL NULL and reads it back
    // with the KEY PRESENT, so the ordinary pattern saved without keywords
    // arrives as `null`. The panel's own reader is written to meet that.
    const { ctx } = contextOver([[row("a", { keywords: null })]]);

    const library = await readPatternLibrary(ctx);

    expect(library.items[0]).toHaveProperty("keywords", null);
  });

  it("drops a row it cannot key or label, and keeps the rest", async () => {
    // One pattern stops being offered rather than all of them — the direction
    // the remote-pattern reader already moves in. A row with no id could not be
    // planned against; one with no title could not be found.
    const { ctx } = contextOver([
      [row("a"), { title: "no id" }, row("b", { title: "" }), row("c")],
    ]);

    const library = await readPatternLibrary(ctx);

    expect(library.items.map(p => p.id)).toEqual(["a", "c"]);
  });
});

describe("how much of the library travels", () => {
  it("keeps reading while pages come back full", async () => {
    const full = Array.from({ length: LIBRARY_PAGE_SIZE }, (_, i) =>
      row(`p${String(i)}`)
    );
    const { ctx, listEntries } = contextOver([full, [row("last")]]);

    const library = await readPatternLibrary(ctx);

    expect(patternReads(listEntries)).toBe(2);
    expect(library.items).toHaveLength(LIBRARY_PAGE_SIZE + 1);
    expect(library.meta.truncated).toBe(false);
  });

  it("pages on what the SERVICE says, not on how many rows it could read", async () => {
    // A full page every row of which was dropped still means there may be more.
    // Reading the second page on the kept count would stop at the first page a
    // library of unreadable rows produced, and report the rest as absent.
    const unreadable = Array.from({ length: 3 }, () => ({ title: "no id" }));
    const { ctx, listEntries } = contextOver([unreadable, [row("real")]]);

    const library = await readPatternLibrary(ctx);

    expect(patternReads(listEntries)).toBe(2);
    expect(library.items.map(p => p.id)).toEqual(["real"]);
  });

  it("stops at the ceiling and SAYS it stopped", async () => {
    // Silently truncating hands the author a library they will search in vain.
    const pages = Array.from({ length: 40 }, (_, page) =>
      Array.from({ length: LIBRARY_PAGE_SIZE }, (_, i) =>
        row(`p${String(page)}-${String(i)}`)
      )
    );
    const { ctx } = contextOver(pages);

    const library = await readPatternLibrary(ctx);

    expect(library.items).toHaveLength(MAX_LIBRARY_PATTERNS);
    expect(library.meta.truncated).toBe(true);
    expect(library.meta.count).toBe(MAX_LIBRARY_PATTERNS);
  });

  it("stops asking when every row of every page is dropped", async () => {
    // The pattern ceiling counts patterns KEPT, so a library whose rows this
    // reader cannot use never reaches it. Measured while break-verifying: a
    // stop condition on the kept count asked for page after page until the
    // process died. The bound has to be on the READS as well.
    const unreadable = () =>
      Array.from({ length: LIBRARY_PAGE_SIZE }, () => ({ title: "no id" }));
    const pages = Array.from({ length: 500 }, unreadable);
    const { ctx, listEntries } = contextOver(pages);

    const library = await readPatternLibrary(ctx);

    expect(patternReads(listEntries)).toBeLessThanOrEqual(
      MAX_LIBRARY_PATTERNS / LIBRARY_PAGE_SIZE
    );
    expect(library.items).toHaveLength(0);
    expect(library.meta.truncated).toBe(true);
  });

  it("does not claim truncation for a library that simply ended", async () => {
    // The control: `truncated` has to be able to be false, or the flag above is
    // satisfied by a reader that always sets it.
    const { ctx } = contextOver([[row("a")]]);

    const library = await readPatternLibrary(ctx);

    expect(library.meta).toMatchObject({ count: 1, truncated: false });
  });
});

describe("how much of the library travels, by weight", () => {
  /** One full page of documents big enough that a few of them blow the budget. */
  const heavyPage = () =>
    Array.from({ length: LIBRARY_PAGE_SIZE }, (_, i) =>
      row(`h${String(i)}`, {
        content: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "pattern",
          nodes: [
            {
              id: "n",
              type: "core/box",
              version: 1,
              props: { filler: "x".repeat(200_000) },
            },
          ],
        },
      })
    );

  /**
   * What the budget actually bounds, measured without the module's own helper.
   *
   * The DOCUMENTS only, because that is what {@link MAX_LIBRARY_BYTES} is
   * spent on — the title and category are short columns with bounds of their
   * own. `Buffer.byteLength` rather than a `TextEncoder`, so the oracle is a
   * different implementation of "UTF-8 bytes" than the one under test and can
   * disagree with it.
   */
  /** The same oracle over the whole row, which is what the wire carries. */
  const rowWireBytes = (items: readonly unknown[]) =>
    items.reduce<number>(
      (n, p) => n + Buffer.byteLength(JSON.stringify(p), "utf8"),
      0
    );

  const documentWireBytes = (
    items: readonly { readonly document?: unknown }[]
  ) =>
    items.reduce(
      (n, p) => n + Buffer.byteLength(JSON.stringify(p.document), "utf8"),
      0
    );

  it("never returns MORE than the budget, for one oversized pattern", async () => {
    // The ceiling was applied AFTER the row was appended, so the row that
    // crossed it travelled anyway: a single document larger than the whole
    // budget came back whole, which made MAX_LIBRARY_BYTES a description of the
    // response rather than a bound on it. A host may raise the per-document
    // limit, so a document that size is one a site can really hold.
    //
    // Left OUT rather than ending the read: a pattern that does not fit in an
    // empty budget fits in no budget, so the patterns behind it are still worth
    // reading — the same direction an unreadable row moves in, one pattern
    // dropped instead of all of them. It is reported, like every other ceiling.
    const huge = "x".repeat(MAX_LIBRARY_BYTES + 1_000_000);
    const { ctx } = contextOver([
      [
        row("huge", {
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "pattern",
            nodes: [{ id: "n", type: "core/box", version: 1, props: { huge } }],
          },
        }),
        row("small"),
      ],
    ]);

    const library = await readPatternLibrary(ctx);

    expect(documentWireBytes(library.items)).toBeLessThanOrEqual(
      MAX_LIBRARY_BYTES
    );
    // And the readable pattern BEHIND the oversized one still arrives.
    expect(library.items.map(pattern => pattern.id)).toEqual(["small"]);
    expect(library.meta.truncated).toBe(true);
  });

  it("measures the budget in WIRE bytes, which non-ASCII text multiplies", async () => {
    // `String.length` counts UTF-16 code units. A CJK character is one of those
    // and three bytes encoded, so a ceiling measured that way lets roughly
    // three times its nominal size onto the wire.
    //
    // These rows sit UNDER the budget by UTF-16 length and well over it by
    // UTF-8 bytes, which is what makes this a test of the measurement rather
    // than of the ceiling: a reader counting code units never stops here.
    const cjk = "設計".repeat(150_000);
    const { ctx } = contextOver([
      Array.from({ length: 20 }, (_, i) =>
        row(`c${String(i)}`, {
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "pattern",
            nodes: [{ id: "n", type: "core/box", version: 1, props: { cjk } }],
          },
        })
      ),
    ]);

    const library = await readPatternLibrary(ctx);

    // The control: by the length that does not count bytes, this library never
    // reached the ceiling at all.
    expect(JSON.stringify(library.items).length).toBeLessThan(
      MAX_LIBRARY_BYTES
    );
    expect(documentWireBytes(library.items)).toBeLessThanOrEqual(
      MAX_LIBRARY_BYTES
    );
    expect(library.meta.truncated).toBe(true);
  });

  it("reserves the response FRAMING, not only the rows inside it", async () => {
    // The rows are what the budget counted, and the rows are not what is sent:
    // `Response.json` wraps them in `{"items":[…],"meta":{…}}` and separates
    // them with commas. A library whose rows total exactly the ceiling
    // therefore leaves the server ABOVE it, so a proxy or platform limit set at
    // the same 16 MiB rejects a response this route believed it had bounded.
    //
    // The big row sits INSIDE the ceiling and outside it once the envelope is
    // counted, which is the whole boundary: an accounting that totals only rows
    // admits it and answers above the limit. Reserving the framing refuses it —
    // it cannot fit beside an envelope — and the small row behind it still
    // arrives, which is what the liveness assertion below is checking. Filler
    // rows cannot show this: each is larger than the envelope, so the total
    // lands further below the ceiling than the framing costs.
    const shell = {
      id: "big",
      title: "Pattern big",
      granularity: "section",
      description: "",
      document: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "pattern",
        nodes: [],
      },
    };
    const shellBytes = Buffer.byteLength(JSON.stringify(shell), "utf8");
    const { ctx } = contextOver([
      [
        row("big", {
          description: "d".repeat(MAX_LIBRARY_BYTES - shellBytes - 40),
          content: shell.document,
        }),
        row("small"),
      ],
    ]);

    const library = await readPatternLibrary(ctx);

    // Liveness: without this the test is satisfied by a library that kept
    // NOTHING, which is the one outcome that would make the assertion below
    // true for a reason it is not testing. Not an exact count — which rows fit
    // is the accounting's business, and pinning it would fail the next time a
    // field is added.
    expect(library.items.length).toBeGreaterThan(0);
    // The whole answer, which is what the ceiling is a ceiling on.
    expect(
      Buffer.byteLength(JSON.stringify(library), "utf8")
    ).toBeLessThanOrEqual(MAX_LIBRARY_BYTES);
  });

  it("charges a row for the WHOLE of it, not only its document", async () => {
    // `description` is a `textarea` on the patterns collection with no length
    // of its own, so a library of rows carrying long descriptions and NO
    // document spent nothing at all: the budget measured the one field that
    // happened to have no bound, and every other field rode along unmeasured.
    // Three thousand of those assemble and serialise without a ceiling ever
    // being consulted.
    //
    // Each row carries a SMALL but real document, which is what makes the two
    // readers disagree. With no document at all a reader charging only the
    // document measures `undefined`, reports it unserialisable and drops every
    // row — the library comes back empty and within budget, so the assertion
    // holds for a reason that has nothing to do with what was charged.
    const description = "d".repeat(400_000);
    const { ctx } = contextOver([
      Array.from({ length: 60 }, (_, i) =>
        row(`m${String(i)}`, { description })
      ),
    ]);

    const library = await readPatternLibrary(ctx);

    expect(rowWireBytes(library.items)).toBeLessThanOrEqual(MAX_LIBRARY_BYTES);
    expect(library.meta.truncated).toBe(true);
  });

  it("drops a row it cannot serialise rather than answering 500", async () => {
    // A document reaching a reader is not necessarily serialisable: an
    // `afterRead` hook may put a bigint or a cycle in one. Counting that row as
    // costing NOTHING kept it, and `Response.json` then threw on the assembled
    // library — so one malformed row took every usable pattern with it and the
    // author saw a failed request rather than a shorter list.
    //
    // The same direction every other unreadable row moves in: one pattern
    // dropped instead of all of them.
    const poisoned = row("bad");
    (poisoned.content as { nodes: unknown[] }).nodes.push({
      id: "n",
      type: "core/box",
      version: 1,
      props: { count: BigInt(1) },
    });
    const { ctx } = contextOver([[poisoned, row("good")]]);

    const library = await readPatternLibrary(ctx);

    expect(library.items.map(pattern => pattern.id)).toEqual(["good"]);
    // And the answer is one the route can actually send.
    expect(() => JSON.stringify(library)).not.toThrow();
  });

  it("cuts a SINGLE oversized page rather than calling it complete", async () => {
    // The case a between-pages ceiling cannot reach: one page of a hundred
    // two-mebibyte documents is two hundred mebibytes ALREADY assembled, and
    // when the collection ends there the read reports it complete. The budget
    // has to stop the accumulation rather than describe it afterwards.
    //
    // Asserted on the BYTES of what came back, not on the row count — the row
    // count is well under its ceiling here, which is exactly why counting rows
    // could not see this.
    const { ctx } = contextOver([heavyPage()]);

    const library = await readPatternLibrary(ctx);

    expect(documentWireBytes(library.items)).toBeLessThanOrEqual(
      MAX_LIBRARY_BYTES
    );
    expect(library.meta.truncated).toBe(true);
  });

  it("stops on BYTES, which a row count cannot bound", async () => {
    // One valid blocks document may be two mebibytes by default and a host may
    // raise that, so three thousand of them is gigabytes assembled on the
    // server and then sent to a browser — from a request an author makes by
    // opening the editor. The row ceiling cannot see that.
    const { ctx } = contextOver(Array.from({ length: 30 }, heavyPage));

    const library = await readPatternLibrary(ctx);

    // Well under the row ceiling, so only the byte budget can have stopped it.
    expect(library.items.length).toBeLessThan(MAX_LIBRARY_PATTERNS);
    expect(library.meta.truncated).toBe(true);
  });
});

describe("what the route answers is what the palette can offer", () => {
  it("answers with a pattern the planner would actually place", () => {
    // THE SEAM, and the gap that let a broken tier look finished. Every other
    // test here asserts the route's own shape, and the wiring test asserts the
    // array reaches the panel — so a payload whose field names the panel does
    // not read satisfies both while offering nothing.
    //
    // `patternRefusal` is the gate `patternEntriesFrom` puts every row through
    // before offering it, published by the engine, so this asks the real
    // question rather than a restatement of it. A pattern whose `document` is
    // absent — which is what carrying the stored `content` name produced — is
    // refused here exactly as the palette silently skips it.
    const document = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "pattern" as const,
      nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
    };

    expect(
      patternRefusal(document, { parentsOf: () => undefined })
    ).toBeUndefined();
  });

  it("carries that document through the read, under the name the panel reads", async () => {
    const document = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "pattern",
      nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
    };
    const { ctx } = contextOver([[row("hero", { content: document })]]);

    const library = await readPatternLibrary(ctx);

    // Through the SAME gate, on what the route actually returned. Absent, this
    // refuses; and absent is what the panel skips on.
    expect(
      patternRefusal(library.items[0]?.document, {
        parentsOf: () => undefined,
      })
    ).toBeUndefined();
  });
});

describe("the component tier", () => {
  function componentRow(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      title: `Component ${id}`,
      category: "Sections",
      content: { formatVersion: 1, kind: "component", nodes: [] },
      ...extra,
    };
  }
  const draft = (text: string) => ({
    formatVersion: 1,
    kind: "component",
    nodes: [{ id: "d1", type: "acme/text", version: 1, props: { text } }],
  });

  it("takes the document from the BY-ID read, not the listing", async () => {
    // The listing answers with the live row; the by-id read is the only path
    // to the working draft. A definition built from the listing would render
    // the author a stale component beside the draft they just saved.
    const { ctx, read } = componentContext({
      pages: [[componentRow("header", { content: draft("live") })]],
      byId: {
        header: {
          id: "header",
          title: "Component header",
          category: "Sections",
          content: draft("draft"),
        },
      },
    });

    const library = await readComponentLibrary(ctx);

    expect(read).toHaveBeenCalledWith("components", "header");
    expect(library.items).toEqual([
      {
        id: "header",
        title: "Component header",
        category: "Sections",
        document: draft("draft"),
      },
    ]);
    expect(library.meta).toEqual({ count: 1, truncated: false });
  });

  it("labels the item from the BY-ID row too, so a draft's title and category are the ones shown", async () => {
    // A working draft can rename a component or move it to another category
    // as readily as it can change its content. Labelled from the live listing
    // and drawn from the draft, the tile would be named and grouped by one
    // version and rendered as another.
    const { ctx } = componentContext({
      pages: [
        [componentRow("header", { title: "Old name", category: "Old group" })],
      ],
      byId: {
        header: {
          id: "header",
          title: "New name",
          category: "New group",
          description: "From the draft",
          content: draft("draft"),
        },
      },
    });

    const library = await readComponentLibrary(ctx);

    expect(library.items[0]).toEqual({
      id: "header",
      title: "New name",
      category: "New group",
      description: "From the draft",
      document: draft("draft"),
    });
  });

  it("omits a listed component whose by-id row cannot be labelled, and says the tier was cut", async () => {
    // The listing named it, so a library without it is not whole — and a row
    // the read answered but which carries no title is one nothing can label.
    const { ctx } = componentContext({
      pages: [[componentRow("a"), componentRow("b")]],
      byId: {
        a: { id: "a", content: draft("x") },
        b: { id: "b", title: "B", content: draft("y") },
      },
    });

    const library = await readComponentLibrary(ctx);

    expect(library.items.map(c => c.id)).toEqual(["b"]);
    expect(library.meta.truncated).toBe(true);
  });

  it("overlaps its by-id reads, boundedly, and admits them in listing order", async () => {
    // A library of three thousand completed one read at a time is three
    // thousand round trips in a row. Overlapped without bound, a page that
    // meets the ceiling at its first row pays ninety-nine reads for nothing.
    // The batch is what bounds both — and whatever runs together, the rows
    // are judged in the order they were listed.
    const ids = Array.from(
      { length: 20 },
      (_, i) => `c${String(i).padStart(2, "0")}`
    );
    const { ctx, inFlight } = componentContext({
      pages: [ids.map(id => componentRow(id))],
      byId: Object.fromEntries(
        ids.map(id => [
          id,
          { id, title: `Component ${id}`, content: draft(id) },
        ])
      ),
    });

    const library = await readComponentLibrary(ctx);

    expect(inFlight.most).toBe(COMPLETION_CONCURRENCY);
    expect(COMPLETION_CONCURRENCY).toBeGreaterThan(1);
    expect(library.items.map(c => c.id)).toEqual(ids);
  });

  it("starts no further batch once the ceiling has stopped the read", async () => {
    // The control for the bound above. Each row fits the budget alone and no
    // two fit together, so the second row SPENDS it — and only the first
    // batch's reads are ever made, however many rows the page listed.
    const ids = Array.from(
      { length: 20 },
      (_, i) => `c${String(i).padStart(2, "0")}`
    );
    const halfPlus = "x".repeat(Math.ceil(MAX_LIBRARY_BYTES / 2) + 1);
    const { ctx, read } = componentContext({
      pages: [ids.map(id => componentRow(id))],
      byId: Object.fromEntries(
        ids.map(id => [
          id,
          {
            id,
            title: `Component ${id}`,
            content: { ...draft(id), huge: halfPlus },
          },
        ])
      ),
    });

    const library = await readComponentLibrary(ctx);

    expect(library.items.map(c => c.id)).toEqual(["c00"]);
    expect(library.meta.truncated).toBe(true);
    expect(read.mock.calls.length).toBe(COMPLETION_CONCURRENCY);
  });

  it("answers the CANONICAL list envelope, and nothing beside it", async () => {
    // `{ items, meta }` is what every list in this codebase answers with, and
    // the shape a shared client reads. A second field beside them — a tier
    // carried on the pattern response, say — is a second vocabulary.
    const { ctx } = componentContext({
      pages: [[componentRow("a")]],
      byId: { a: { id: "a", content: draft("x") } },
    });

    const library = await readComponentLibrary(ctx);

    expect(Object.keys(library).sort()).toEqual(["items", "meta"]);
    expect(Object.keys(library.meta).sort()).toEqual(["count", "truncated"]);
  });

  it("pages the listing through the INJECTED read, deterministically, by page", async () => {
    // The plugin-facing listing cannot ask for every lifecycle state, so the
    // route reads through a lister the declaration binds — and it walks it
    // the way it walks the pattern listing: page after page, in order, until
    // the service says there is no more.
    const { ctx, list } = componentContext({
      pages: [[componentRow("a")], [componentRow("b")]],
      byId: {
        a: { id: "a", title: "A", content: draft("a") },
        b: { id: "b", title: "B", content: draft("b") },
      },
    });

    const library = await readComponentLibrary(ctx);

    expect(list.mock.calls.map(call => call[1])).toEqual([1, 2]);
    expect(library.items.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("reads through the host's renamed slug", async () => {
    const { ctx, list, read } = componentContext(
      {
        pages: [[componentRow("a")]],
        byId: { a: { id: "a", title: "A", content: draft("x") } },
      },
      { components: "site_components" }
    );

    await readComponentLibrary(ctx);

    expect(list.mock.calls.every(call => call[0] === "site_components")).toBe(
      true
    );
    expect(read.mock.calls.every(call => call[0] === "site_components")).toBe(
      true
    );
  });

  it("carries a null document for a row saved without content, and skips nothing else", async () => {
    // A legal row the panel will skip. Carried as null rather than omitted so
    // the shape says the read was made and found nothing.
    const { ctx } = componentContext({
      pages: [[componentRow("empty")]],
      byId: { empty: { id: "empty", title: "Empty", content: null } },
    });

    const library = await readComponentLibrary(ctx);

    expect(library.items[0]?.document).toBeNull();
    expect(library.meta.truncated).toBe(false);
  });

  it("marks the tier CUT when a listed component's by-id read answers nothing", async () => {
    // The row vanished between the two reads, or the service declined it. A
    // library missing a definition the author can see in the collection is
    // not a whole library, and saying so is what stops the panel presenting
    // it as one.
    const { ctx } = componentContext({
      pages: [[componentRow("gone"), componentRow("here")]],
      byId: { here: { id: "here", title: "Here", content: draft("x") } },
    });

    const library = await readComponentLibrary(ctx);

    expect(library.items.map(c => c.id)).toEqual(["here"]);
    expect(library.meta.truncated).toBe(true);
  });

  it("honours the byte ceiling on its own response, and says when it cut", async () => {
    // Its own route, its own payload, the same ceiling: a definition that does
    // not fit is left out and reported, exactly as a pattern is.
    const huge = "x".repeat(MAX_LIBRARY_BYTES);
    const { ctx } = componentContext({
      pages: [[componentRow("big"), componentRow("small")]],
      byId: {
        big: { id: "big", title: "Big", content: { ...draft("y"), huge } },
        small: { id: "small", title: "Small", content: draft("z") },
      },
    });

    const library = await readComponentLibrary(ctx);

    expect(library.items.map(c => c.id)).toEqual(["small"]);
    expect(library.meta.truncated).toBe(true);
  });

  it("answers an empty tier, not a cut one, for a site with no components", async () => {
    const { ctx } = componentContext();

    const library = await readComponentLibrary(ctx);

    expect(library.items).toEqual([]);
    expect(library.meta).toEqual({ count: 0, truncated: false });
  });
});
