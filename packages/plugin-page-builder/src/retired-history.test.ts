/**
 * Deriving a component's retired ids from its published history, and the
 * repair that records the ones the retired table lacks.
 *
 * Driven over an in-memory history and store, so each case asserts what is
 * answered and what is recorded. The properties a plausible version gets
 * wrong: counting a draft's fields as published, subtracting an older
 * definition when the newest cannot be read, stopping at the first page, and
 * reading the whole history again on every call.
 */
import type { RetiredExposures } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  deriveRetired,
  reconcileRetired,
  retiredHistoryMemo,
  type ComponentHistory,
  type RetiredHistoryArgs,
} from "./retired-history";
import type { RetiredStore } from "./retired-store";

type Row = Record<string, unknown>;

const COMPONENTS = "nx_pb_components";

/** A definition exposing these fields and slots. */
const definition = (fields: string[], slots: string[] = []): Row => ({
  formatVersion: 1,
  kind: "component",
  nodes: [],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: "h",
    propPath: "text",
    type: "text",
  })),
  ...(slots.length === 0
    ? {}
    : {
        slots: Object.fromEntries(
          slots.map(id => [id, { label: id, nodeId: "b", slot: "children" }])
        ),
      }),
});

interface Version {
  status: string;
  content: unknown;
}

/**
 * A history over versions given OLDEST first, numbered from 1, listed newest
 * first and paged by a cursor as core pages them. Records each read.
 */
function memoryHistory(versions: Version[]) {
  const lists: { limit: number; cursor?: number }[] = [];
  const gets: number[] = [];
  const history: ComponentHistory = {
    list: async (_ref, options) => {
      lists.push(options);
      return versions
        .map((version, index) => ({
          versionNo: index + 1,
          status: version.status,
        }))
        .reverse()
        .filter(
          row => options.cursor === undefined || row.versionNo < options.cursor
        )
        .slice(0, options.limit);
    },
    get: async (_ref, versionNo) => {
      gets.push(versionNo);
      return {
        snapshot: { id: "hero", content: versions[versionNo - 1]!.content },
      };
    },
  };
  return { history, lists, gets, versions };
}

const published = (fields: string[], slots: string[] = []): Version => ({
  status: "published",
  content: definition(fields, slots),
});
const draft = (fields: string[]): Version => ({
  status: "draft",
  content: definition(fields),
});

function args(
  history: ComponentHistory,
  extra: Partial<RetiredHistoryArgs> = {}
): RetiredHistoryArgs {
  return {
    history,
    componentCollection: COMPONENTS,
    componentField: "content",
    lifecycle: true,
    ...extra,
  };
}

describe("the retired ids history implies", () => {
  it("are every id a published version exposed, minus the newest one's", async () => {
    const { history } = memoryHistory([
      published(["title", "body"], ["aside", "main"]),
      published(["body"], ["main"]),
    ]);

    expect(await deriveRetired(args(history), "hero")).toEqual({
      retired: { properties: ["title"], slots: ["aside"] },
      complete: true,
    });
  });

  it("leave out a field only a draft ever held", async () => {
    const { history } = memoryHistory([
      published(["title"]),
      draft(["title", "teaser"]),
      draft(["title"]),
      published(["title"]),
    ]);

    expect((await deriveRetired(args(history), "hero")).retired).toEqual({
      properties: [],
      slots: [],
    });
  });

  it("subtract the newest PUBLISHED definition, not a newer draft", async () => {
    const { history } = memoryHistory([
      published(["title", "body"]),
      draft(["body"]),
    ]);

    expect((await deriveRetired(args(history), "hero")).retired).toEqual({
      properties: [],
      slots: [],
    });
  });

  it("count every version of a store with no publishing lifecycle", async () => {
    const { history } = memoryHistory([
      draft(["title", "body"]),
      draft(["body"]),
    ]);

    expect(
      (await deriveRetired(args(history, { lifecycle: false }), "hero")).retired
    ).toEqual({ properties: ["title"], slots: [] });
  });

  it("read a definition stored as JSON text", async () => {
    const { history } = memoryHistory([
      { status: "published", content: JSON.stringify(definition(["title"])) },
      { status: "published", content: JSON.stringify(definition([])) },
    ]);

    expect((await deriveRetired(args(history), "hero")).retired).toEqual({
      properties: ["title"],
      slots: [],
    });
  });

  it("are none, and incomplete, when the newest published definition cannot be read", async () => {
    const { history } = memoryHistory([
      published(["title", "body"]),
      { status: "published", content: "not json" },
    ]);

    expect(await deriveRetired(args(history), "hero")).toEqual({
      retired: { properties: [], slots: [] },
      complete: false,
    });
  });

  it("are none for a component with no history", async () => {
    const { history } = memoryHistory([]);

    expect(await deriveRetired(args(history), "hero")).toEqual({
      retired: { properties: [], slots: [] },
      complete: true,
    });
  });
});

describe("reading a long history", () => {
  it("pages to the oldest version, a cursor at a time", async () => {
    const versions = [
      published(["first", "body"]),
      ...Array.from({ length: 119 }, () => draft(["body"])),
      published(["body"]),
    ];
    const { history, lists } = memoryHistory(versions);

    expect(await deriveRetired(args(history), "hero")).toEqual({
      retired: { properties: ["first"], slots: [] },
      complete: true,
    });
    expect(lists.map(list => list.cursor)).toEqual([undefined, 72, 22]);
    expect(lists.every(list => list.limit === 50)).toBe(true);
  });

  it("loads only published snapshots", async () => {
    const { history, gets } = memoryHistory([
      published(["title"]),
      draft(["title", "x"]),
      published([]),
    ]);

    await deriveRetired(args(history), "hero");

    expect(gets).toEqual([3, 1]);
  });

  it("stops at its bound, keeping the newest part and saying it is incomplete", async () => {
    const versions = [
      published(["oldest"]),
      ...Array.from({ length: 500 }, (_, index) =>
        published(index === 0 ? ["older"] : [])
      ),
    ];
    const { history, gets } = memoryHistory(versions);

    expect(await deriveRetired(args(history), "hero")).toEqual({
      retired: { properties: ["older"], slots: [] },
      complete: false,
    });
    expect(gets).toHaveLength(500);
  });
});

describe("the memo", () => {
  it("reads only the versions recorded since the last read", async () => {
    const memory = memoryHistory([
      published(["title", "body"]),
      published(["body"]),
    ]);
    const memo = retiredHistoryMemo();

    await deriveRetired(args(memory.history, { memo }), "hero");
    memory.versions.push(published([]));
    memory.gets.length = 0;

    expect(
      (await deriveRetired(args(memory.history, { memo }), "hero")).retired
    ).toEqual({ properties: ["body", "title"], slots: [] });
    expect(memory.gets).toEqual([3]);
  });

  it("keeps the newest published definition when only drafts followed", async () => {
    const memory = memoryHistory([
      published(["title", "body"]),
      published(["body"]),
    ]);
    const memo = retiredHistoryMemo();

    await deriveRetired(args(memory.history, { memo }), "hero");
    memory.versions.push(draft([]));
    memory.gets.length = 0;

    expect(
      (await deriveRetired(args(memory.history, { memo }), "hero")).retired
    ).toEqual({ properties: ["title"], slots: [] });
    expect(memory.gets).toEqual([]);
  });

  it("is not kept from a read its bound stopped", async () => {
    const versions = Array.from({ length: 501 }, () => published([]));
    const memory = memoryHistory(versions);
    const memo = retiredHistoryMemo();

    await deriveRetired(args(memory.history, { memo }), "hero");
    memory.gets.length = 0;
    await deriveRetired(args(memory.history, { memo }), "hero");

    expect(memory.gets).toHaveLength(500);
  });

  it("is read apart for a store without the lifecycle", async () => {
    const memory = memoryHistory([draft(["title", "body"]), draft(["body"])]);
    const memo = retiredHistoryMemo();

    await deriveRetired(args(memory.history, { memo }), "hero");

    expect(
      (
        await deriveRetired(
          args(memory.history, { memo, lifecycle: false }),
          "hero"
        )
      ).retired
    ).toEqual({ properties: ["title"], slots: [] });
  });
});

/** A store over an in-memory map, recording each retirement it is asked for. */
function memoryStore(initial: Record<string, RetiredExposures> = {}) {
  const held = new Map(Object.entries(initial));
  const recorded: { componentId: string; retired: RetiredExposures }[] = [];
  const store: RetiredStore = {
    of: async ids =>
      new Map(
        ids.flatMap(id => {
          const entry = held.get(id);
          return entry === undefined ? [] : [[id, entry] as const];
        })
      ),
    retire: async (componentId, retired) => {
      recorded.push({ componentId, retired });
      const entry = held.get(componentId) ?? { properties: [], slots: [] };
      held.set(componentId, {
        properties: [...entry.properties, ...retired.properties],
        slots: [...entry.slots, ...retired.slots],
      });
    },
  };
  return { store, recorded };
}

function logger() {
  const errors: { message: string; meta?: Row }[] = [];
  const warnings: { message: string; meta?: Row }[] = [];
  return {
    errors,
    warnings,
    logger: {
      warn: (message: string, meta?: Row) => warnings.push({ message, meta }),
      error: (message: string, meta?: Row) => errors.push({ message, meta }),
    },
  };
}

describe("the repair", () => {
  it("records the ids history retired that the table lacks, and answers both", async () => {
    const { history } = memoryHistory([
      published(["title", "body", "cta"]),
      published(["body"]),
    ]);
    const { store, recorded } = memoryStore({
      hero: { properties: ["cta", "old"], slots: [] },
    });

    const answer = await reconcileRetired(
      { ...args(history), store, ...logger() },
      "hero"
    );

    expect(recorded).toEqual([
      { componentId: "hero", retired: { properties: ["title"], slots: [] } },
    ]);
    expect(answer).toEqual({ properties: ["cta", "old", "title"], slots: [] });
  });

  it("records nothing the second time", async () => {
    const { history } = memoryHistory([
      published(["title", "body"]),
      published(["body"]),
    ]);
    const { store, recorded } = memoryStore();
    const run = () =>
      reconcileRetired({ ...args(history), store, ...logger() }, "hero");

    const first = await run();
    const second = await run();

    expect(recorded).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("still answers the derived ids when the record fails, and logs naming the component", async () => {
    const { history } = memoryHistory([published(["title"]), published([])]);
    const { store } = memoryStore();
    const failing: RetiredStore = {
      ...store,
      retire: async () => {
        throw new Error("database down");
      },
    };
    const log = logger();

    const answer = await reconcileRetired(
      { ...args(history), store: failing, logger: log.logger },
      "hero"
    );

    expect(answer).toEqual({ properties: ["title"], slots: [] });
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]!.message).toContain('"hero"');
  });

  it("fails when history cannot be read, so nothing mints on a partial answer", async () => {
    const { store } = memoryStore();
    const history: ComponentHistory = {
      list: async () => {
        throw new Error("database down");
      },
      get: async () => ({ snapshot: null }),
    };

    await expect(
      reconcileRetired({ ...args(history), store, ...logger() }, "hero")
    ).rejects.toThrow("database down");
  });

  it("warns when the history was not read to its start", async () => {
    const { history } = memoryHistory(
      Array.from({ length: 501 }, () => published([]))
    );
    const { store } = memoryStore();
    const log = logger();

    await reconcileRetired(
      { ...args(history), store, logger: log.logger },
      "hero"
    );

    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]!.message).toContain('"hero"');
  });
});
