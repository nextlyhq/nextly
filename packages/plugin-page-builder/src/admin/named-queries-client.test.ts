// @vitest-environment jsdom
/**
 * A collection list's custom sources in the editor: what the Source menu is
 * given, and how the canvas runs a named query on the server.
 *
 * The properties that fail quietly: a run asked with the inputs judged here
 * rather than as the list stores them (the server's own today and defaults
 * then never apply), a failure that loses the server's log reference, a run
 * answered from a failure kept, and a query reading what visitors can't
 * drawn with no word of it. The route reads go through the SDK, stood in for.
 *
 * @module admin/named-queries-client.test
 */
import {
  defineNamedQuery,
  namedQueryDeclaration,
  param,
} from "@nextlyhq/blocks-engine";
import {
  createQueryBudget,
  createStandaloneContext,
  DEFAULT_MAX_QUERIES,
} from "@nextlyhq/blocks-react";
import { readNamedList } from "@nextlyhq/blocks-react/blocks";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readPluginRoute = vi.hoisted(() => vi.fn());
const writePluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute,
  writePluginRoute,
}));

import type {
  ListEntriesNamedRequest,
  ListEntriesNamedResponse,
} from "../list-entries-contract";

import {
  canvasNamedHost,
  canvasNamedQueriesIn,
  canvasNamedRuns,
  listCustomSources,
  namedListCount,
  type CanvasCustomSource,
} from "./named-queries-client";

beforeEach(() => {
  readPluginRoute.mockReset();
});

const upcoming = namedQueryDeclaration(
  defineNamedQuery({
    name: "events.upcoming",
    label: "Upcoming events",
    params: {
      city: param.text({ label: "City", required: true }),
      from: param.day({ label: "From", default: "today" }),
    },
    reads: { collections: ["events", "page-views"] },
    rows: { key: "id", fields: [{ name: "id", type: "text" }] },
    total: true,
    run: () => Promise.resolve({ rows: [] }),
  })
);

const SOURCES: CanvasCustomSource[] = [
  {
    declaration: upcoming,
    readsHidden: [
      { collection: "page-views", label: "Page views", fields: ["views"] },
    ],
  },
];

/** An answer from the list entries route's named form. */
function answer(
  named: ListEntriesNamedResponse["meta"]["named"],
  items: Record<string, unknown>[] = [{ id: "e1" }]
): ListEntriesNamedResponse {
  return {
    items,
    meta: {
      total: 12,
      page: 1,
      limit: 6,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
      named,
    },
  };
}

/** Draw one list's read with the canvas host, as the renderer would. */
async function readWith(
  run: (body: ListEntriesNamedRequest) => Promise<ListEntriesNamedResponse>,
  params: Record<string, string> = { city: "lahore" }
) {
  const host = canvasNamedHost(SOURCES, run, "en");
  const ctx = createStandaloneContext({
    namedQueries: host,
    queries: createQueryBudget(),
    diagnostics: true,
  });
  return await readNamedList(
    { name: "events.upcoming", params },
    { limit: 6, offset: 0 },
    { ...ctx, namedQueries: host },
    "list"
  );
}

describe("listCustomSources", () => {
  it("asks the named queries route in the language edited, keeping each declaration it sends", async () => {
    readPluginRoute.mockResolvedValue({
      items: [
        { declaration: upcoming, readsHidden: SOURCES[0]?.readsHidden },
        { declaration: { name: 42 }, readsHidden: [] },
      ],
      meta: {},
    });
    const sources = await listCustomSources("ur");
    expect(readPluginRoute.mock.calls[0]?.[0]).toEqual({
      plugin: "@nextlyhq/plugin-page-builder",
      path: "/named-queries?locale=ur",
    });
    // The one that is not a declaration is left out, not drawn unsettable.
    expect(sources).toEqual(SOURCES);
  });

  it("rejects when the route answers something that is not a list", async () => {
    readPluginRoute.mockResolvedValue({ nope: true });
    await expect(listCustomSources()).rejects.toThrow(
      "Custom sources could not be listed."
    );
  });
});

describe("the canvas's runs of a named query", () => {
  it("asks the server for the run as the list stores it, inputs unjudged", async () => {
    const run = vi.fn(() =>
      Promise.resolve(answer({ counted: true, reads: 2 }))
    );
    const outcome = await readWith(run);
    // `from` is left for the server, whose today and time zone decide it.
    expect(run).toHaveBeenCalledWith({
      named: {
        name: "events.upcoming",
        params: { city: "lahore" },
        limit: 6,
        offset: 0,
        locale: "en",
        node: "list",
        // A fresh budget's room, so the server caps the run to it.
        allowance: DEFAULT_MAX_QUERIES,
      },
    });
    expect(outcome.items).toEqual([{ id: "e1" }]);
    expect(outcome.total).toBe(12);
  });

  it("draws a failure the server answered under the reference its log names", async () => {
    const failure = {
      code: "threw",
      detail:
        "Upcoming events stopped with an error. Ask your developer, quoting ref NQ-1A2B3C.",
      ref: "NQ-1A2B3C",
    };
    const outcome = await readWith(() =>
      Promise.resolve(answer({ counted: false, reads: 1, failure }, []))
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.diagnostic?.ref).toBe("NQ-1A2B3C");
    expect(outcome.diagnostic?.message).toContain(failure.detail);
  });

  it("hands the renderer a failed run's reads, so the canvas's allowance is charged for them", async () => {
    const failure = {
      code: "threw",
      detail:
        "Upcoming events stopped with an error. Ask your developer, quoting ref NQ-1A2B3C.",
      ref: "NQ-1A2B3C",
    };
    const host = canvasNamedHost(
      SOURCES,
      () => Promise.resolve(answer({ counted: false, reads: 3, failure }, [])),
      undefined
    );
    const asked = host.cache?.({
      declaration: upcoming,
      key: ["k"],
      read: () => Promise.reject(new Error("never read here")),
      asked: { params: { city: "lahore" }, window: { limit: 6, offset: 0 } },
    });
    await expect(asked).rejects.toMatchObject({
      namedQueryFailure: { ...failure, reads: 3 },
    });
  });

  it("tells an author what a visitor's page goes without, naming the fields", async () => {
    const outcome = await readWith(() =>
      Promise.resolve(answer({ counted: true, reads: 1 }))
    );
    expect(outcome.diagnostic).toEqual({
      kind: "query-caution",
      message:
        "Upcoming events reads views from Page views, which visitors can't read, so on the published page visitors see the rows without them.",
    });
  });

  it("starts no run once the draw's allowance is spent, and hands the server what is left", async () => {
    const run = vi.fn(() =>
      Promise.resolve(answer({ counted: true, reads: 1 }))
    );
    const host = canvasNamedHost(SOURCES, run, undefined);
    const ask = (allowance: number) =>
      host.cache?.({
        declaration: upcoming,
        key: ["k"],
        read: () => Promise.reject(new Error("never read here")),
        asked: {
          params: { city: "lahore" },
          window: { limit: 6, offset: 0 },
          allowance,
        },
      });
    await expect(ask(0)).rejects.toMatchObject({
      namedQueryFailure: { code: "budget" },
    });
    expect(run).not.toHaveBeenCalled();
    await ask(4);
    expect(run).toHaveBeenCalledWith({
      named: expect.objectContaining({ allowance: 4 }) as unknown,
    });
  });

  it("never runs a query in the browser: its lookup's run refuses", async () => {
    const host = canvasNamedHost(SOURCES, vi.fn(), undefined);
    const definition = host.definitionOf("events.upcoming");
    await expect(
      definition?.run({
        params: {},
        window: { limit: 1, offset: 0 },
        reader: {
          find: () => Promise.reject(new Error("unused")),
          count: () => Promise.reject(new Error("unused")),
          findSingle: () => Promise.reject(new Error("unused")),
          siteSettings: () => Promise.reject(new Error("unused")),
        },
        today: "2026-11-06",
        signal: new AbortController().signal,
      })
    ).rejects.toThrow("runs on the server");
    expect(host.definitionOf("events.gone")).toBeUndefined();
  });
});

describe("canvasNamedRuns", () => {
  const body: ListEntriesNamedRequest = {
    named: { name: "events.upcoming", limit: 6, offset: 0 },
  };

  it("makes each run once while its answer is kept, and again once it is not", async () => {
    let at = 0;
    const run = vi.fn(() =>
      Promise.resolve(answer({ counted: true, reads: 1 }))
    );
    const runs = canvasNamedRuns(run, () => at);
    await runs(body);
    await runs(body);
    expect(run).toHaveBeenCalledTimes(1);
    at = 16_000;
    await runs(body);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shares a run in flight however long it takes, and keeps its answer from when it settles", async () => {
    let at = 0;
    let finish: (answer: ListEntriesNamedResponse) => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<ListEntriesNamedResponse>(resolve => {
          finish = resolve;
        })
    );
    const runs = canvasNamedRuns(run, () => at);
    const first = runs(body);
    // Longer than an answer is kept, still running: the same run is joined.
    at = 20_000;
    const second = runs(body);
    expect(run).toHaveBeenCalledTimes(1);
    finish(answer({ counted: true, reads: 1 }));
    await Promise.all([first, second]);
    // Kept from when it settled, not from when it started.
    at = 30_000;
    await runs(body);
    expect(run).toHaveBeenCalledTimes(1);
    at = 36_000;
    await runs(body);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops only the run that failed, never one started after it", async () => {
    const at = 0;
    let fail: (error: Error) => void = () => undefined;
    const run = vi
      .fn<
        (asked: ListEntriesNamedRequest) => Promise<ListEntriesNamedResponse>
      >()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          })
      )
      .mockResolvedValue(answer({ counted: true, reads: 1 }));
    const runs = canvasNamedRuns(run, () => at);
    const old = runs(body);
    fail(new Error("refused"));
    await expect(old).rejects.toThrow("refused");
    await runs(body);
    await runs(body);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps no answer saying the run failed, so the next draw runs it again", async () => {
    const failure = { code: "threw", detail: "Stopped.", ref: "NQ-ABCDEF" };
    const run = vi
      .fn<
        (asked: ListEntriesNamedRequest) => Promise<ListEntriesNamedResponse>
      >()
      .mockResolvedValueOnce(answer({ counted: false, reads: 1, failure }, []))
      .mockResolvedValue(answer({ counted: true, reads: 1 }));
    const runs = canvasNamedRuns(run, () => 0);
    await runs(body);
    await runs(body);
    await runs(body);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shares one run between two lists of one query, each telling the server its list", async () => {
    const run = vi.fn(() =>
      Promise.resolve(answer({ counted: true, reads: 1 }))
    );
    const runs = canvasNamedRuns(run, () => 0);
    await runs({ named: { ...body.named, node: "a" } });
    await runs({ named: { ...body.named, node: "b" } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ named: { ...body.named, node: "a" } });
  });

  it("keeps no refusal, so the next draw asks again", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue(answer({ counted: true, reads: 1 }));
    const runs = canvasNamedRuns(run, () => 0);
    await expect(runs(body)).rejects.toThrow("refused");
    await expect(runs(body)).resolves.toMatchObject({ items: [{ id: "e1" }] });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("namedListCount", () => {
  it("counts a counted query's run, and says nothing of one that does not count", async () => {
    const counted = canvasNamedHost(
      SOURCES,
      () => Promise.resolve(answer({ counted: true, reads: 1 })),
      undefined
    );
    const props = {
      namedQuery: { name: "events.upcoming", params: { city: "lahore" } },
      limit: 6,
    };
    expect(await namedListCount(props, counted, undefined)).toEqual({
      matching: 12,
      shown: 1,
    });
    const uncounted = canvasNamedHost(
      SOURCES,
      () => Promise.resolve(answer({ counted: false, reads: 1 })),
      undefined
    );
    expect(await namedListCount(props, uncounted, undefined)).toBeUndefined();
    expect(
      await namedListCount({ collection: "posts" }, counted, undefined)
    ).toBeUndefined();
  });
});

describe("the canvas's named queries as a visitor runs them", () => {
  it("runs each as a visitor of the document named, apart from the person's own runs", async () => {
    readPluginRoute.mockResolvedValue({
      items: [{ declaration: upcoming, readsHidden: SOURCES[0]?.readsHidden }],
      meta: {},
    });
    writePluginRoute.mockReset();
    writePluginRoute.mockResolvedValue(answer({ counted: true, reads: 1 }));
    const visitor = { collection: "pages", id: "p1" };
    const own = canvasNamedQueriesIn("en", "author-v");
    const asVisitor = canvasNamedQueriesIn("en", "author-v", visitor);
    expect(asVisitor).not.toBe(own);
    expect(canvasNamedQueriesIn("en", "author-v", { ...visitor })).toBe(
      asVisitor
    );
    for (const queries of [asVisitor, own]) {
      const host = await queries.host();
      await readNamedList(
        { name: "events.upcoming", params: { city: "lahore" } },
        { limit: 6, offset: 0 },
        {
          ...createStandaloneContext({ queries: createQueryBudget() }),
          namedQueries: host,
        },
        "list"
      );
    }
    const bodies = writePluginRoute.mock.calls.map(
      ([request]) => (request as { body: Record<string, unknown> }).body
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      visitor,
      named: { name: "events.upcoming" },
    });
    expect(bodies[1]).not.toHaveProperty("visitor");
  });
});
