// @vitest-environment jsdom

/**
 * A collection list whose source is a named query, as the renderer runs it:
 * the reader handed to `run` (only declared reads, each claimed from the
 * page's allowance), the rows projected to what the query declares and
 * their keys checked, the time bound, and each failure drawn as the empty
 * state with a note only an author sees, never the raw error.
 *
 * Drawn through the real `PageRenderer` and core blocks.
 */
import {
  defineNamedQuery,
  param,
  type BlockDocument,
  type BlockNode,
  type NamedQueryDefinition,
  type NamedQueryReader,
  type NamedReadFilter,
  type NamedReadQuery,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createQueryBudget,
  type BindingIssuesHandler,
  type BlocksFilterOp,
  type BlocksQuery,
  type ListBaseReader,
  type NamedQueryFailure,
  type NamedQueryHost,
  type NamedQueryRunData,
  type PageContext,
} from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";
import { listItemKey } from "./collection-loop";
import {
  namedQueryFailureLine,
  readNamedList,
  scopedReader,
} from "./named-read";

const node = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode =>
  ({
    id,
    type,
    version: 1,
    props,
    ...(slots === undefined ? {} : { slots }),
  }) as BlockNode;

/** A heading bound to the item's `field`, so each row shows its own. */
const itemHeading = (id: string, field = "title"): BlockNode =>
  ({
    id,
    type: "core/heading",
    version: 1,
    props: { text: "?", level: "h3" },
    bindings: { text: { $bind: field, source: "item" } },
  }) as BlockNode;

const emptyText = node("none", "core/heading", {
  text: "Nothing here yet",
  level: "h4",
});

function list(
  props: Record<string, unknown>,
  children: BlockNode[] = [itemHeading("t")],
  id = "list"
): BlockNode {
  return node(id, "core/collection-loop", props, {
    children,
    empty: [emptyText],
  });
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

type Row = Record<string, unknown>;

/** A base reader over fixture rows, recording each read it was asked. */
function base(rows: Record<string, Row[]>): ListBaseReader & {
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    find: query => {
      asked.push(`find:${query.collection}`);
      const items = rows[query.collection] ?? [];
      return Promise.resolve({ items, meta: { total: items.length } });
    },
    count: query => {
      asked.push(`count:${query.collection}`);
      return Promise.resolve((rows[query.collection] ?? []).length);
    },
    findSingle: query => {
      asked.push(`single:${query.slug}`);
      return Promise.resolve({ heading: "From the Single" });
    },
    siteSettings: () => {
      asked.push("site");
      return Promise.resolve({ applicationName: "Site" });
    },
  };
}

const EVENTS: Row[] = [
  { id: "e1", title: "One", internalNote: "SENTINEL-1" },
  { id: "e2", title: "Two", internalNote: "SENTINEL-2" },
];

/** A query over `events`, its rows a field schema keyed by id. */
function eventsQuery(
  run: NamedQueryDefinition["run"],
  extra: Partial<NamedQueryDefinition> = {}
): NamedQueryDefinition {
  return {
    ...defineNamedQuery({
      name: "events.upcoming",
      label: "Upcoming events",
      params: {
        city: param.choice({
          label: "City",
          required: true,
          options: [{ value: "lahore", label: "Lahore" }],
        }),
      },
      reads: { collections: ["events"] },
      rows: {
        key: "id",
        fields: [
          { name: "id", type: "text" },
          { name: "title", type: "text" },
        ],
      },
      run,
    }),
    ...extra,
  } as NamedQueryDefinition;
}

/** A host over `reader` answering one query, recording failures it was told of. */
function host(
  definition: NamedQueryDefinition | undefined,
  reader: ListBaseReader,
  extra: Partial<NamedQueryHost> = {}
): NamedQueryHost & { failures: NamedQueryFailure[] } {
  const failures: NamedQueryFailure[] = [];
  return {
    failures,
    definitionOf: name =>
      definition !== undefined && name === definition.name
        ? definition
        : undefined,
    reader,
    today: () => Promise.resolve("2026-11-06"),
    report: failure => failures.push(failure),
    ...extra,
  };
}

function context(overrides: Partial<PageContext>): PageContext {
  return {
    entry: null,
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...overrides,
  };
}

async function drawn(
  document: BlockDocument,
  ctx: PageContext,
  onBindingIssues?: BindingIssuesHandler
): Promise<HTMLElement> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={createBlockResolver(coreBlocks)}
      context={ctx}
      bindings={{}}
      {...(onBindingIssues === undefined ? {} : { onBindingIssues })}
    />,
    {
      onError(error: unknown) {
        throw error;
      },
    }
  );
  await stream.allReady;
  const element = window.document.createElement("div");
  element.innerHTML = await new Response(stream).text();
  return element;
}

const headings = (element: HTMLElement) =>
  Array.from(element.querySelectorAll("h3")).map(
    heading => heading.textContent ?? ""
  );
const emptyShown = (element: HTMLElement) =>
  element.querySelector("h4")?.textContent === "Nothing here yet";
const note = (element: HTMLElement) =>
  element.querySelector("[data-nx-list-diagnostic]")?.textContent ?? null;

const named = (params: Record<string, unknown> = { city: "lahore" }) => ({
  namedQuery: { name: "events.upcoming", params },
});

/** Draw one list with a host, as an author looking or a visitor. */
async function draw(
  definition: NamedQueryDefinition | undefined,
  options: {
    readonly props?: Record<string, unknown>;
    readonly rows?: Record<string, Row[]>;
    readonly diagnostics?: boolean;
    readonly budget?: number;
    readonly host?: Partial<NamedQueryHost>;
    readonly children?: BlockNode[];
  } = {}
) {
  const reader = base(options.rows ?? { events: EVENTS });
  const made = host(definition, reader, options.host);
  const element = await drawn(
    page(list(options.props ?? named(), options.children)),
    context({
      namedQueries: made,
      diagnostics: options.diagnostics ?? true,
      ...(options.budget === undefined
        ? {}
        : { queries: createQueryBudget(options.budget) }),
    })
  );
  return { element, reader, host: made };
}

describe("the named query reader's shape", () => {
  it("takes the queries the page's reader takes, written out in the engine", () => {
    // The engine cannot import this package, so its reader's query is
    // written out there; each must take what the other does.
    expectTypeOf<NamedReadFilter["op"]>().toEqualTypeOf<BlocksFilterOp>();
    expectTypeOf<BlocksQuery>().toExtend<NamedReadQuery>();
    expectTypeOf<NamedReadQuery>().toExtend<BlocksQuery>();
    expectTypeOf<Parameters<NamedQueryReader["count"]>[0]>().toExtend<
      Parameters<ListBaseReader["count"]>[0]
    >();
    expectTypeOf<Awaited<ReturnType<ListBaseReader["find"]>>>().toExtend<
      Awaited<ReturnType<NamedQueryReader["find"]>>
    >();
  });
});

describe("a list whose source is a named query", () => {
  it("draws each row, projected to the declared fields, with its inputs filled", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
      total: 2,
    }));
    // A heading bound to a field the query does not declare, which the row
    // the reader gave holds: it shows its own value, never the field's.
    const { element } = await draw(eventsQuery(run), {
      children: [itemHeading("t"), itemHeading("n", "internalNote")],
    });
    expect(headings(element)).toEqual(["One", "?", "Two", "?"]);
    expect(element.innerHTML).not.toContain("SENTINEL");
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      params: { city: "lahore" },
      window: { limit: 10, offset: 0 },
      today: "2026-11-06",
    });
  });

  it("keeps a collection's entries to that collection's public fields", async () => {
    const definition = {
      ...eventsQuery(async ({ reader }) => ({
        rows: (await reader.find({ collection: "events" })).items,
      })),
      rows: { collection: "events" },
    } as NamedQueryDefinition;
    const { element } = await draw(definition, {
      children: [itemHeading("t"), itemHeading("n", "internalNote")],
      host: {
        fieldsOf: collection =>
          Promise.resolve(
            collection === "events"
              ? [{ name: "title", type: "text" }]
              : undefined
          ),
      },
    });
    expect(headings(element)).toEqual(["One", "?", "Two", "?"]);
    expect(element.innerHTML).not.toContain("SENTINEL");
  });

  it("refuses a read the query does not declare, before it is made", async () => {
    const {
      element,
      reader,
      host: made,
    } = await draw(
      eventsQuery(async ({ reader: scoped }) => {
        await scoped.find({ collection: "secrets" });
        return { rows: [] };
      })
    );
    expect(reader.asked).toEqual([]);
    expect(emptyShown(element)).toBe(true);
    expect(note(element)).toContain(
      "Upcoming events read secrets, which it doesn't declare, so it was stopped."
    );
    expect(made.failures.map(failure => failure.code)).toEqual([
      "undeclared-read",
    ]);
  });

  it("refuses an undeclared Single and the site settings too", async () => {
    const declaration = eventsQuery(() => Promise.resolve({ rows: [] }));
    const reader = base({});
    const scoped = scopedReader(declaration, reader, () => true);
    await expect(scoped.findSingle({ slug: "settings" })).rejects.toThrow(
      /does not declare/
    );
    await expect(scoped.siteSettings()).rejects.toThrow(/does not declare/);
    await expect(scoped.count({ collection: "posts" })).rejects.toThrow(
      /does not declare/
    );
    expect(reader.asked).toEqual([]);
    expect(Object.isFrozen(scoped)).toBe(true);
    const declared = scopedReader(
      { ...declaration, reads: { singles: ["settings"], site: true } },
      reader,
      () => true
    );
    await declared.findSingle({ slug: "settings" });
    await declared.siteSettings();
    expect(reader.asked).toEqual(["single:settings", "site"]);
  });

  it("claims each read from the page's allowance, and stops when it is spent", async () => {
    const threeReads = eventsQuery(async ({ reader }) => {
      await reader.count({ collection: "events" });
      await reader.count({ collection: "events" });
      return { rows: (await reader.find({ collection: "events" })).items };
    });
    const enough = await draw(threeReads, { budget: 3 });
    expect(headings(enough.element)).toEqual(["One", "Two"]);
    const short = await draw(threeReads, { budget: 2 });
    expect(headings(short.element)).toEqual([]);
    expect(note(short.element)).toContain(
      "This page has used up the reads it may make, so Upcoming events wasn't run."
    );
  });

  it("costs the same reads when its result comes from the host's cache", async () => {
    const kept = new Map<string, NamedQueryRunData>();
    const cache: NamedQueryHost["cache"] = async ({ key, read }) => {
      const found = kept.get(key.join("|"));
      if (found !== undefined) return found;
      const data = await read();
      kept.set(key.join("|"), data);
      return data;
    };
    const run = vi.fn<NamedQueryDefinition["run"]>(async ({ reader }) => {
      await reader.count({ collection: "events" });
      await reader.count({ collection: "events" });
      return { rows: (await reader.find({ collection: "events" })).items };
    });
    const cold = await draw(eventsQuery(run), { budget: 3, host: { cache } });
    expect(headings(cold.element)).toEqual(["One", "Two"]);
    const warm = await draw(eventsQuery(run), { budget: 3, host: { cache } });
    expect(headings(warm.element)).toEqual(["One", "Two"]);
    expect(run).toHaveBeenCalledTimes(1);
    // Warm, the three reads are claimed again: two are not enough.
    const short = await draw(eventsQuery(run), { budget: 2, host: { cache } });
    expect(headings(short.element)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["two rows with one key", [{ id: "a" }, { id: "a" }]],
    ["a row with no key", [{ id: "a" }, { title: "keyless" }]],
    ["a row keyed by something other than text or a number", [{ id: true }]],
  ])("refuses %s", async (_case, rows) => {
    const { element } = await draw(
      eventsQuery(() => Promise.resolve({ rows }))
    );
    expect(headings(element)).toEqual([]);
    expect(note(element)).toContain(
      "Upcoming events gave two rows the same key, or a row with none"
    );
  });

  it("stops a run that takes too long, and aborts its signal", async () => {
    let signal: AbortSignal | undefined;
    const { element } = await draw(
      eventsQuery(
        args => {
          signal = args.signal;
          return new Promise(() => undefined);
        },
        { timeoutMs: 30 }
      )
    );
    expect(note(element)).toContain(
      "Upcoming events took longer than 0.03 seconds, so it was stopped."
    );
    expect(signal?.aborted).toBe(true);
  });

  it("shows a log reference, never the raw error, and logs the error", async () => {
    const { element, host: made } = await draw(
      eventsQuery(() =>
        Promise.reject(new Error("ECONNREFUSED 10.0.3.4:5432 token=abc"))
      )
    );
    expect(element.innerHTML).not.toContain("ECONNREFUSED");
    const [failure] = made.failures;
    expect(failure?.code).toBe("threw");
    expect(failure?.ref).toMatch(/^NQ-[0-9A-F]{6}$/);
    expect(failure?.error).toBeInstanceOf(Error);
    expect(note(element)).toContain(
      `Upcoming events stopped with an error. Ask your developer, quoting ref ${failure?.ref ?? "?"}.`
    );
  });

  it("shows the public message of an error a developer meant authors to read", async () => {
    const { element } = await draw(
      eventsQuery(() =>
        Promise.reject(
          Object.assign(new Error("internal detail"), {
            code: "NOT_FOUND",
            statusCode: 404,
            publicMessage: "The venue list is not set up yet.",
          })
        )
      )
    );
    expect(note(element)).toContain("The venue list is not set up yet.");
    expect(element.innerHTML).not.toContain("internal detail");
  });

  it("names a trusted read the host's frame refused", async () => {
    const frames: string[] = [];
    const { element, host: made } = await draw(
      eventsQuery(() =>
        Promise.reject(
          Object.assign(new Error("forbidden"), {
            logContext: { reason: "named-query-trusted-read" },
          })
        )
      ),
      {
        host: {
          frame: name => ({
            run: operation => {
              frames.push(name);
              return operation();
            },
            read: operation => operation(),
          }),
        },
      }
    );
    expect(frames).toEqual(["events.upcoming"]);
    expect(made.failures[0]?.code).toBe("trusted-read");
    expect(note(element)).toContain(
      "Upcoming events tried to read with more access than a visitor has"
    );
  });

  it("draws the empty state for a query no longer registered, and for a missing input", async () => {
    const gone = await draw(undefined);
    expect(emptyShown(gone.element)).toBe(true);
    expect(note(gone.element)).toContain(
      'Its source, "events.upcoming", isn\'t set up on this site any more.'
    );
    const run = vi.fn<NamedQueryDefinition["run"]>(() =>
      Promise.resolve({ rows: [] })
    );
    const missing = await draw(eventsQuery(run), { props: named({}) });
    expect(note(missing.element)).toContain(
      "Upcoming events needs a city, which this list doesn't set."
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("shows a visitor the empty state and no note", async () => {
    const { element } = await draw(
      eventsQuery(() => Promise.reject(new Error("boom"))),
      { diagnostics: false }
    );
    expect(emptyShown(element)).toBe(true);
    expect(note(element)).toBeNull();
  });

  it("never reads a collection stored beside a custom source", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(() =>
      Promise.resolve({ rows: [] })
    );
    const { element, reader } = await draw(eventsQuery(run), {
      props: { ...named(), collection: "events" },
    });
    expect(run).not.toHaveBeenCalled();
    expect(reader.asked).toEqual([]);
    expect(note(element)).toContain("can't also name a collection");
  });

  it("draws its template once where no host runs named queries", async () => {
    const element = await drawn(
      page(
        list(named(), [
          node("t", "core/heading", { text: "Template", level: "h3" }),
        ])
      ),
      context({ diagnostics: true })
    );
    expect(headings(element)).toEqual(["Template"]);
  });

  it("decides a block's condition on a row of the query's own schema", async () => {
    const definition = eventsQuery(() =>
      Promise.resolve({
        rows: [
          { id: "e1", title: "One" },
          { id: "e2", title: "Two" },
        ],
      })
    );
    // Shown only for the row titled One: decided against the fields the
    // query declares, so neither row fails closed for want of a collection.
    const gatedHeading = {
      ...itemHeading("t"),
      visibility: {
        conditions: [[{ field: "title", op: "equals", value: "One" }]],
      },
    } as BlockNode;
    const { element } = await draw(definition, { children: [gatedHeading] });
    expect(headings(element)).toEqual(["One"]);
  });

  it("draws its template with no outer item where no host runs named queries", async () => {
    // An ordinary list of posts around it, whose template also shows each
    // post's title beside the custom source's list.
    const outer = node(
      "outer",
      "core/collection-loop",
      { collection: "posts" },
      {
        children: [
          itemHeading("outer-title"),
          list(named(), [itemHeading("inner-title")], "inner"),
        ],
        empty: [],
      }
    );
    const element = await drawn(
      page(outer),
      context({
        data: {
          find: () =>
            Promise.resolve({
              items: [{ id: "p1", title: "Outer post" }],
              total: 1,
            }),
        },
      })
    );
    // The outer template shows the post, so the item reaches that far; the
    // custom source's template, drawn with no rows, does not show it again.
    expect(headings(element).filter(text => text === "Outer post")).toEqual([
      "Outer post",
    ]);
  });

  it("claims a run's reads once per render, however many lists draw it", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const element = await drawn(
      page(
        list(named(), [itemHeading("a")], "first"),
        list(named(), [itemHeading("b")], "second")
      ),
      context({
        namedQueries: host(eventsQuery(run), base({ events: EVENTS })),
        // One read: the run makes it; the second list joins that run and
        // claims nothing more, so it still draws its rows.
        queries: createQueryBudget(1),
      })
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(headings(element)).toEqual(["One", "Two", "One", "Two"]);
  });

  it("runs once per render when drawn inside every entry of an outer list", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const definition = eventsQuery(run);
    const reader = base({ events: EVENTS });
    const made = host(definition, reader);
    const outer = node(
      "outer",
      "core/collection-loop",
      { collection: "posts" },
      { children: [list(named(), [itemHeading("t")], "inner")], empty: [] }
    );
    const element = await drawn(
      page(outer),
      context({
        namedQueries: made,
        queries: createQueryBudget(),
        data: {
          find: () =>
            Promise.resolve({ items: [{ id: "p1" }, { id: "p2" }], total: 2 }),
        },
      })
    );
    expect(headings(element)).toEqual(["One", "Two", "One", "Two"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again in the next render, though the host is kept", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const kept = host(eventsQuery(run), base({ events: EVENTS }));
    for (const queries of [
      createQueryBudget(),
      createQueryBudget(),
      undefined,
    ]) {
      await drawn(
        page(list(named())),
        context({
          namedQueries: kept,
          ...(queries === undefined ? {} : { queries }),
        })
      );
    }
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("keys a kept result by the query's implementation as well as its declaration", async () => {
    const keys: string[] = [];
    const kept = new Map<string, NamedQueryRunData>();
    const cache: NamedQueryHost["cache"] = async ({ key, read }) => {
      keys.push(key.join("|"));
      const found = kept.get(key.join("|"));
      if (found !== undefined) return found;
      const data = await read();
      kept.set(key.join("|"), data);
      return data;
    };
    const before = await draw(
      eventsQuery(() => Promise.resolve({ rows: [{ id: "a", title: "Old" }] })),
      { host: { cache } }
    );
    expect(headings(before.element)).toEqual(["Old"]);
    // The same declaration, deployed with another run function.
    const after = await draw(
      eventsQuery(() => Promise.resolve({ rows: [{ id: "a", title: "New" }] })),
      { host: { cache } }
    );
    expect(headings(after.element)).toEqual(["New"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("reads what run returns while its frame is open, getters included", async () => {
    let inFrame = false;
    const evaluated: boolean[] = [];
    const frame: NamedQueryHost["frame"] = () => ({
      run: async operation => {
        inFrame = true;
        try {
          return await operation();
        } finally {
          inFrame = false;
        }
      },
      read: operation => operation(),
    });
    const row = {
      id: "e1",
      get title() {
        evaluated.push(inFrame);
        return "From a getter";
      },
    };
    const result = {
      get rows() {
        evaluated.push(inFrame);
        return [row];
      },
    };
    const { element } = await draw(
      eventsQuery(() => Promise.resolve(result as never)),
      { host: { frame } }
    );
    expect(headings(element)).toEqual(["From a getter"]);
    // Every getter ran inside the frame, and none ran after it closed.
    expect(evaluated.length).toBeGreaterThan(0);
    expect(evaluated.every(Boolean)).toBe(true);
  });

  it("reads only through the frame's door, with the query as plain data", async () => {
    let inFrame = false;
    const seen: string[] = [];
    const reader = base({ events: EVENTS });
    const frame: NamedQueryHost["frame"] = () => ({
      run: async operation => {
        inFrame = true;
        try {
          return await operation();
        } finally {
          inFrame = false;
        }
      },
      read: async operation => {
        const was = inFrame;
        inFrame = false;
        try {
          seen.push("door");
          return await operation();
        } finally {
          inFrame = was;
        }
      },
    });
    const watched: ListBaseReader = {
      ...reader,
      find: query => {
        seen.push(inFrame ? "base in frame" : "base outside");
        return reader.find(query);
      },
    };
    const { element } = await draw(
      eventsQuery(async ({ reader: scoped }) => {
        // A getter on the query runs when it is copied, inside the frame,
        // never past the door.
        const query = {
          get collection() {
            seen.push(inFrame ? "getter in frame" : "getter outside");
            return "events";
          },
        };
        return { rows: (await scoped.find(query)).items };
      }),
      { host: { frame, reader: watched } }
    );
    expect(headings(element)).toEqual(["One", "Two"]);
    expect(seen).toEqual(["getter in frame", "door", "base outside"]);
  });

  it("checks an item binding against the query's declared rows", async () => {
    const definition = eventsQuery(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const issues = async (query: NamedQueryDefinition) => {
      const found: Parameters<BindingIssuesHandler>[0][number][] = [];
      await drawn(
        page(list(named(), [itemHeading("t", "internalNote")])),
        context({ namedQueries: host(query, base({ events: EVENTS })) }),
        reported => found.push(...reported)
      );
      return found.filter(issue => issue.code === "binding-field-missing");
    };
    // The host's query declares no `internalNote`: the binding is reported.
    expect(await issues(definition)).toEqual([
      expect.objectContaining({ nodeId: "t" }),
    ]);
    // The host's query that declares it: the same binding is not.
    expect(
      await issues(
        eventsQuery(definition.run, {
          rows: {
            key: "id",
            fields: [
              { name: "id", type: "text" },
              { name: "internalNote", type: "text" },
            ],
          },
        })
      )
    ).toEqual([]);
  });

  it("makes no read once its run is over, though run keeps going", async () => {
    let lateRead: Promise<unknown> | undefined;
    const { element, reader } = await draw(
      eventsQuery(
        ({ reader: scoped }) => {
          // Ignores its signal, and reads after its time is up.
          setTimeout(() => {
            lateRead = scoped
              .find({ collection: "events" })
              .catch((error: unknown) => error);
          }, 60);
          return new Promise(() => undefined);
        },
        { timeoutMs: 20 }
      )
    );
    expect(note(element)).toContain("so it was stopped");
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(lateRead).toBeDefined();
    expect(await lateRead).toBeInstanceOf(Error);
    expect(reader.asked).toEqual([]);
  });

  it("draws the empty state when the render's day cannot be read", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(() =>
      Promise.resolve({ rows: [] })
    );
    const { element, host: made } = await draw(eventsQuery(run), {
      host: { today: () => Promise.reject(new Error("no clock")) },
    });
    expect(emptyShown(element)).toBe(true);
    expect(note(element)).toContain("Upcoming events stopped with an error");
    expect(made.failures.map(failure => failure.code)).toEqual(["threw"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("draws nothing of a collection visitors may read none of, though a kept result holds rows", async () => {
    const run = vi.fn<NamedQueryDefinition["run"]>(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const definition = {
      ...eventsQuery(run),
      rows: { collection: "events" },
    } as NamedQueryDefinition;
    // Kept from before the collection was closed to visitors.
    const kept: NamedQueryHost["cache"] = () =>
      Promise.resolve({ rows: [{ id: "e1" }, { id: "e2" }], reads: 0 });
    const { element, host: made } = await draw(definition, {
      host: { fieldsOf: () => Promise.resolve(undefined), cache: kept },
    });
    expect(headings(element)).toEqual([]);
    expect(element.innerHTML).not.toContain("e1");
    expect(note(element)).toContain(
      "Upcoming events lists entries of events, which visitors can't read"
    );
    expect(made.failures.map(failure => failure.code)).toEqual(["rows-hidden"]);
    expect(run).not.toHaveBeenCalled();
    // A collection visitors may read, with every own field hidden, still
    // draws its rows by their ids.
    const readable = await draw(definition, {
      host: { fieldsOf: () => Promise.resolve([]), cache: kept },
    });
    expect(emptyShown(readable.element)).toBe(false);
  });

  it("keys each row by the field its query declares", async () => {
    const definition = eventsQuery(
      () => Promise.resolve({ rows: [{ slug: "b", title: "B" }] }),
      {
        rows: {
          key: "slug",
          fields: [
            { name: "slug", type: "text" },
            { name: "title", type: "text" },
          ],
        },
      }
    );
    const outcome = await readNamedList(
      { name: "events.upcoming", params: { city: "lahore" } },
      { limit: 10, offset: 0 },
      context({
        namedQueries: host(definition, base({})),
      }) as PageContext & { namedQueries: NamedQueryHost },
      "list"
    );
    expect(outcome.rowKey).toBe("slug");
    expect(listItemKey({ slug: "b" }, 0, outcome.rowKey)).toBe("b");
    // Keyed by an id it does not have, the row would fall back to its place.
    expect(listItemKey({ slug: "b" }, 0)).toBe(0);
  });

  it("keeps a result for one day only, whatever the query declares", async () => {
    const keys: string[] = [];
    const cache: NamedQueryHost["cache"] = async ({ key, read }) => {
      keys.push(key.join("|"));
      return await read();
    };
    const query = eventsQuery(() => Promise.resolve({ rows: [] }));
    for (const day of ["2026-11-06", "2026-11-07"]) {
      await draw(query, {
        host: { cache, today: () => Promise.resolve(day) },
      });
    }
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("draws the empty state though the log it reports to fails", async () => {
    const { element } = await draw(
      eventsQuery(() => Promise.reject(new Error("boom"))),
      {
        host: {
          report: () => {
            throw new Error("the log is down");
          },
        },
      }
    );
    expect(emptyShown(element)).toBe(true);
    expect(note(element)).toContain("Upcoming events stopped with an error");
  });

  it("logs a failure by its code and reference, never the error's words", () => {
    const line = namedQueryFailureLine(
      {
        code: "threw",
        query: "events.upcoming",
        nodeId: "list",
        ref: "NQ-ABC123",
        error: Object.assign(new Error("ECONNREFUSED token=abc"), {
          code: "ECONNREFUSED",
        }),
      },
      '"pages" page "home"'
    );
    expect(line).toContain("NQ-ABC123");
    expect(line).toContain("threw (ECONNREFUSED)");
    expect(line).not.toContain("token=abc");
    expect(
      namedQueryFailureLine(
        {
          code: "threw",
          query: "q",
          nodeId: "l",
          ref: "NQ-000000",
          error: new TypeError("secret=1"),
        },
        "p"
      )
    ).not.toContain("secret");
  });

  it("lets a related list read its entries inside an ordinary list inside it", async () => {
    // A named list, an ordinary posts list in each row, and a list of each
    // post's tags in that: the tags' outer item is a post, no query's row.
    const tags = list(
      { collection: "tags", relation: { of: "item", field: "tags" } },
      [itemHeading("tag")],
      "tags"
    );
    const posts = list({ collection: "posts" }, [tags], "posts");
    const definition = eventsQuery(() =>
      Promise.resolve({ rows: [{ id: "e1", title: "Event" }] })
    );
    const element = await drawn(
      page(list(named(), [posts])),
      context({
        namedQueries: host(definition, base({})),
        diagnostics: true,
        data: {
          find: query =>
            Promise.resolve(
              query.collection === "posts"
                ? { items: [{ id: "p1", tags: ["t1"] }], total: 1 }
                : { items: [{ id: "t1", title: "Tag one" }], total: 1 }
            ),
        },
      })
    );
    expect(headings(element)).toContain("Tag one");
    expect(element.innerHTML).not.toContain("shows a custom source's rows");
  });

  it("tells an author a related list inside it has no entries to read", async () => {
    const related = list(
      { collection: "events", relation: { of: "item", field: "tags" } },
      [itemHeading("r")],
      "related"
    );
    const definition = eventsQuery(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const element = await drawn(
      page(list(named(), [related])),
      context({
        namedQueries: host(definition, base({ events: EVENTS })),
        diagnostics: true,
        data: { find: () => Promise.resolve({ items: [], total: 0 }) },
      })
    );
    expect(element.innerHTML).toContain("shows a custom source's rows");
  });
});

describe("a named query's run made somewhere else, as an editor's canvas makes it", () => {
  /** A failure as the server judged and logged it, carried on an error. */
  const carriedFailure = {
    code: "threw",
    detail:
      "Upcoming events stopped with an error. Ask your developer, quoting ref NQ-4B2C9D.",
    ref: "NQ-4B2C9D",
  } as const;

  it("draws a carried failure in its own words, under the reference the server logged", async () => {
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    const { element, host: made } = await draw(definition, {
      host: {
        cache: () =>
          Promise.reject(
            Object.assign(new Error("carried"), {
              namedQueryFailure: carriedFailure,
            })
          ),
      },
    });
    expect(emptyShown(element)).toBe(true);
    expect(note(element)).toContain(carriedFailure.detail);
    // The reference is the server's, not one made here: a fresh one would
    // send the author's developer looking for a line the log never wrote.
    expect(made.failures[0]?.ref).toBe("NQ-4B2C9D");
    expect(element.querySelector("[data-nx-list-ref]")?.textContent).toBe(
      "NQ-4B2C9D"
    );
  });

  it("keeps a run for one render's generation only, so a renewed allowance runs it again", async () => {
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    let calls = 0;
    let current = createQueryBudget();
    // One budget object for the editor's life, renewed per draw.
    const budget = {
      take: () => current.take(),
      generation: () => current,
    };
    const made = host(definition, base({ events: EVENTS }), {
      cache: () => {
        calls += 1;
        return Promise.resolve({
          rows: [{ id: "e1", title: "One" }],
          reads: 0,
        });
      },
    });
    const ctx = context({
      namedQueries: made,
      queries: budget,
      diagnostics: true,
    });
    await drawn(page(list(named())), ctx);
    await drawn(page(list(named())), ctx);
    // The same generation: the second draw joined the first's run.
    expect(calls).toBe(1);
    current = createQueryBudget();
    await drawn(page(list(named())), ctx);
    expect(calls).toBe(2);
  });

  it("hands its cache the list the run is for", async () => {
    const asked: unknown[] = [];
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    await draw(definition, {
      host: {
        cache: request => {
          asked.push(request.asked?.node);
          return Promise.resolve({ rows: [], reads: 0 });
        },
      },
    });
    expect(asked).toEqual(["list"]);
  });

  it("claims the reads a carried failure made from the page's allowance, as a success's are", async () => {
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    const budget = createQueryBudget(3);
    const made = host(definition, base({ events: EVENTS }), {
      cache: () =>
        Promise.reject(
          Object.assign(new Error("carried"), {
            namedQueryFailure: { ...carriedFailure, reads: 2 },
          })
        ),
    });
    await drawn(
      page(list(named())),
      context({ namedQueries: made, queries: budget, diagnostics: true })
    );
    // Three were allowed and the failed run spent two: one is left.
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
  });

  it("does not take an error's words for a carried failure unless it is one a run can have", async () => {
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    const { element } = await draw(definition, {
      host: {
        cache: () =>
          Promise.reject(
            Object.assign(new Error("ECONNREFUSED token=abc"), {
              namedQueryFailure: { ...carriedFailure, ref: "token=abc" },
            })
          ),
      },
    });
    expect(element.innerHTML).not.toContain("token=abc");
    expect(note(element)).toMatch(/quoting ref NQ-[0-9A-F]{6}\./);
  });

  it("hands its cache the run as the list stores it, inputs unjudged", async () => {
    const asked: unknown[] = [];
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    await draw(definition, {
      props: { ...named({ city: "lahore" }), limit: 4, offset: 2 },
      host: {
        cache: request => {
          asked.push(request.asked);
          return Promise.resolve({ rows: [], reads: 0 });
        },
      },
    });
    expect(asked).toEqual([
      expect.objectContaining({
        params: { city: "lahore" },
        window: { limit: 4, offset: 2 },
      }),
    ]);
  });

  it("runs a failed query again on the next draw, rather than keeping its failure", async () => {
    const budget = createQueryBudget();
    let calls = 0;
    const definition = eventsQuery(() => Promise.resolve({ rows: [] }));
    const made = host(definition, base({ events: EVENTS }), {
      cache: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("first"))
          : Promise.resolve({ rows: [{ id: "e1", title: "One" }], reads: 0 });
      },
    });
    // One allowance for both draws, as an editor keeps one for its life.
    const ctx = context({
      namedQueries: made,
      queries: budget,
      diagnostics: true,
    });
    const first = await drawn(page(list(named())), ctx);
    expect(emptyShown(first)).toBe(true);
    const second = await drawn(page(list(named())), ctx);
    expect(headings(second)).toEqual(["One"]);
    expect(calls).toBe(2);
  });

  it("says what a visitor's page goes without, for a run that succeeded, only to an author", async () => {
    const definition = eventsQuery(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const caution = () =>
      "Upcoming events reads Notes, which visitors can't read.";
    const looking = await draw(definition, { host: { caution } });
    expect(headings(looking.element)).toEqual(["One", "Two"]);
    expect(
      looking.element
        .querySelector("[data-nx-list-diagnostic]")
        ?.getAttribute("data-nx-list-diagnostic")
    ).toBe("query-caution");
    expect(note(looking.element)).toContain("reads Notes");
    const visiting = await draw(definition, {
      host: { caution },
      diagnostics: false,
    });
    expect(note(visiting.element)).toBeNull();
  });
});

describe("a failed run's reference, offered to copy", () => {
  const failing = eventsQuery(() => Promise.reject(new Error("boom")));

  it("offers Copy ref on the editor's canvas, naming the reference it copies", async () => {
    const reader = base({ events: EVENTS });
    const element = await drawn(
      page(list(named())),
      context({
        namedQueries: host(failing, reader),
        diagnostics: true,
        listNoteActions: true,
      })
    );
    const ref = element.querySelector("[data-nx-list-ref]")?.textContent;
    expect(ref).toMatch(/^NQ-[0-9A-F]{6}$/);
    const button = element.querySelector('[data-nx-list-action="copy-ref"]');
    expect(button?.getAttribute("data-nx-list-copy-ref")).toBe(ref);
    expect(button?.getAttribute("aria-label")).toBe(`Copy ref ${ref ?? ""}`);
  });

  it("offers no copy where nothing acts on it, as in a preview, and none for a failure naming no reference", async () => {
    const preview = await draw(failing);
    expect(preview.element.querySelector("[data-nx-list-ref]")).not.toBeNull();
    expect(
      preview.element.querySelector('[data-nx-list-action="copy-ref"]')
    ).toBeNull();
    const missing = await drawn(
      page(list(named({}))),
      context({
        namedQueries: host(failing, base({ events: EVENTS })),
        diagnostics: true,
        listNoteActions: true,
      })
    );
    expect(note(missing)).toContain("needs a city");
    expect(
      missing.querySelector('[data-nx-list-action="copy-ref"]')
    ).toBeNull();
  });
});

describe("a list whose new source waits for an input", () => {
  it("wears the editor's tag while it draws what it stores, only where an author is looking", async () => {
    const definition = eventsQuery(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    const tags = new Map([["list", "Still showing Upcoming events"]]);
    const looking = await drawn(
      page(list(named())),
      context({
        namedQueries: host(definition, base({ events: EVENTS })),
        diagnostics: true,
        listsStillShowing: tags,
      })
    );
    expect(
      looking
        .querySelector("[data-nx-list-still]")
        ?.getAttribute("data-nx-list-still")
    ).toBe("Still showing Upcoming events");
    expect(headings(looking)).toEqual(["One", "Two"]);
    const visiting = await drawn(
      page(list(named())),
      context({
        namedQueries: host(definition, base({ events: EVENTS })),
        listsStillShowing: tags,
      })
    );
    expect(visiting.querySelector("[data-nx-list-still]")).toBeNull();
  });
});
