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
  clearNamedQueries,
  defineNamedQuery,
  param,
  registerNamedQueries,
  type BindingIssue,
  type BlockDocument,
  type BlockNode,
  type NamedQueryDefinition,
  type NamedQueryReader,
  type NamedReadFilter,
  type NamedReadQuery,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createQueryBudget,
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
import { scopedReader } from "./named-read";

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
  onBindingIssues?: (issues: readonly BindingIssue[]) => void
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

afterEach(() => clearNamedQueries());

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
      `Upcoming events stopped with an error. A developer can find it in the server log as ${failure?.ref ?? "?"}.`
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
          runInFrame: (name, run) => {
            frames.push(name);
            return run();
          },
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
        data: {
          find: () =>
            Promise.resolve({ items: [{ id: "p1" }, { id: "p2" }], total: 2 }),
        },
      })
    );
    expect(headings(element)).toEqual(["One", "Two", "One", "Two"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("checks an item binding against the query's declared rows", async () => {
    const definition = eventsQuery(async ({ reader }) => ({
      rows: (await reader.find({ collection: "events" })).items,
    }));
    registerNamedQueries([definition]);
    const issues: BindingIssue[] = [];
    await drawn(
      page(list(named(), [itemHeading("t", "internalNote")])),
      context({ namedQueries: host(definition, base({ events: EVENTS })) }),
      found => issues.push(...found)
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ nodeId: "t", code: "binding-field-missing" })
    );
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
