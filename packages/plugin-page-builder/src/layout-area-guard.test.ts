import type { InTransactionContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { ClassUsageDirectApi } from "./class-usage-runtime";
import {
  LAYOUT_COMPONENT_BEING_DELETED,
  LAYOUT_COMPONENT_MISSING,
  registerLayoutAreaGuard,
} from "./layout-area-guard";
import { areaRowsOf } from "./layout-component-usage";

const COMPONENTS = "nx_pb_components";
const LAYOUTS = "nx_pb_layouts";

/** One delete run, as the run table stores it. */
interface Run {
  componentId: string;
  purpose: string;
  phase: string;
}

/**
 * The guard registered on a fake context: the components that exist (what
 * the hold answers), and the runs the write's transaction reads.
 */
function guard(world: { existing: string[]; runs?: Run[] }) {
  let before: ((context: unknown) => unknown) | undefined;
  let inTransaction:
    | ((write: InTransactionContext) => Promise<void>)
    | undefined;
  const held: string[] = [];
  registerLayoutAreaGuard({
    componentsCollection: COMPONENTS,
    layoutsCollection: LAYOUTS,
    ctx: {
      hooks: {
        on(type, collection, handler) {
          if (type === "beforeChange" && collection === LAYOUTS) {
            before = handler;
          }
        },
        onInTransaction(collection, handler) {
          if (collection === LAYOUTS) inTransaction = handler;
        },
      },
      // No graph lock to take: SQLite admits one writer at a time.
      dialect: "sqlite",
      services: {
        collections: {
          holdEntryInTransaction: async (_tx, collection, id) => {
            expect(collection).toBe(COMPONENTS);
            held.push(id);
            return world.existing.includes(id);
          },
        },
      },
    },
  });
  if (before === undefined || inTransaction === undefined) {
    throw new Error("the guard registered no Layout handlers");
  }
  const write = (args: {
    operation?: "create" | "update" | "delete";
    data?: Record<string, unknown>;
    originalData?: Record<string, unknown>;
  }) =>
    inTransaction?.({
      collection: LAYOUTS,
      operation: args.operation ?? "update",
      id: "l1",
      data: args.data,
      originalData: args.originalData,
      context: {},
      transaction: {} as InTransactionContext["transaction"],
      transactionKey: {},
      readStored: async () => ({ kind: "absent" }),
      fieldPaths: async () => [],
      db: {
        table: () => ({ componentId: { name: "component_id" } }),
        select: () => ({
          where: () => ({ all: async () => world.runs ?? [] }),
        }),
      } as unknown as InTransactionContext["db"],
    } as InTransactionContext);
  return { before, write, held };
}

/** A Direct API over the components that exist and a Layout's pending edit. */
function api(world: { existing: string[]; pending?: unknown }) {
  const asked: string[][] = [];
  const nextly: ClassUsageDirectApi = {
    find: async a => {
      expect(a.collection).toBe(COMPONENTS);
      expect(a.status).toBe("all");
      expect(a.overrideAccess).toBe(true);
      const ids = (a.where as { id: { in: string[] } }).id.in;
      asked.push(ids);
      return {
        items: ids
          .filter(id => world.existing.includes(id))
          .map(id => ({ id })),
      };
    },
    findByID: async () => world.pending ?? null,
    create: async () => ({}),
    delete: async () => ({}),
  };
  return { nextly, asked };
}

const header = (component: unknown) => ({ area: "header", component });
const footer = (component: unknown) => ({ area: "footer", component });

async function refusalOf(work: unknown): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** The issues a validation refusal carries. */
function issuesOf(error: unknown): unknown {
  return (error as { publicData?: { errors?: unknown } } | undefined)
    ?.publicData?.errors;
}

describe("reading a Layout's areas", () => {
  it("reads a bare id, a populated row and stored JSON text, skipping junk", () => {
    expect(
      areaRowsOf([
        header("a"),
        footer({ id: "b", title: "Footer" }),
        { area: "header" },
        null,
        "junk",
      ])
    ).toEqual([
      { index: 0, area: "header", componentId: "a" },
      { index: 1, area: "footer", componentId: "b" },
    ]);
    expect(areaRowsOf(JSON.stringify([header("c")]))).toEqual([
      { index: 0, area: "header", componentId: "c" },
    ]);
    expect(areaRowsOf("not json")).toEqual([]);
  });
});

describe("saving a Layout, before the write", () => {
  it("refuses an area the write adds naming a component that doesn't exist, naming the area", async () => {
    const g = guard({ existing: ["kept"] });
    const { nextly } = api({ existing: ["kept"] });
    const data = { areas: [header("kept"), footer("gone")] };

    const refused = await refusalOf(
      g.before({
        operation: "update",
        data,
        originalData: { id: "l1", areas: [] },
        req: { nextly },
      })
    );

    expect(issuesOf(refused)).toEqual([
      {
        path: "areas[1].component",
        code: LAYOUT_COMPONENT_MISSING,
        message:
          "The footer names a component that doesn't exist. Choose another component for the footer.",
      },
    ]);
  });

  it("lets a Layout naming components that exist through, unchanged", async () => {
    // The control: a guard refusing every write would pass the case above.
    const g = guard({ existing: ["a", "b"] });
    const { nextly } = api({ existing: ["a", "b"] });
    const data = { areas: [header("a"), footer("b")] };

    await g.before({ operation: "create", data, req: { nextly } });

    expect(data.areas).toEqual([header("a"), footer("b")]);
  });

  it("drops an area whose missing component the Layout already held, keeping the others", async () => {
    const g = guard({ existing: ["b"] });
    const { nextly } = api({ existing: ["b"] });
    const data = { title: "Renamed", areas: [header("gone"), footer("b")] };

    await g.before({
      operation: "update",
      data,
      originalData: { id: "l1", areas: [header("gone"), footer("b")] },
      req: { nextly },
    });

    expect(data.areas).toEqual([footer("b")]);
  });

  it("drops one the Layout's pending edit held, though its stored row didn't", async () => {
    const g = guard({ existing: [] });
    const { nextly } = api({
      existing: [],
      pending: { id: "l1", _isWorkingDraft: true, areas: [header("gone")] },
    });
    const data = { areas: [header("gone")] };

    await g.before({
      operation: "update",
      data,
      originalData: { id: "l1", areas: [] },
      req: { nextly },
    });

    expect(data.areas).toEqual([]);
  });

  it("takes a by-id read that isn't a pending edit as nothing held", async () => {
    // The read falls back to the stored row where there is no pending edit;
    // taking that as one would let any id the row lacks pass as held.
    const g = guard({ existing: [] });
    const { nextly } = api({
      existing: [],
      pending: { id: "l1", areas: [header("gone")] },
    });

    const refused = await refusalOf(
      g.before({
        operation: "update",
        data: { areas: [header("gone")] },
        originalData: { id: "l1", areas: [] },
        req: { nextly },
      })
    );

    expect(issuesOf(refused)).toEqual([
      expect.objectContaining({ code: LAYOUT_COMPONENT_MISSING }),
    ]);
  });

  it("reads nothing for a write that leaves the areas alone, or runs in a caller's transaction", async () => {
    const g = guard({ existing: [] });
    const { nextly, asked } = api({ existing: [] });

    await g.before({
      operation: "update",
      data: { title: "x" },
      req: { nextly },
    });
    await g.before({
      operation: "create",
      data: { areas: [header("gone")] },
      executor: {},
      req: { nextly },
    });

    expect(asked).toEqual([]);
  });
});

describe("saving a Layout, inside its transaction", () => {
  it("refuses a component it adds that is gone, naming the area", async () => {
    const g = guard({ existing: [] });

    const refused = await refusalOf(
      g.write({
        data: { areas: [header("gone")] },
        originalData: { areas: [] },
      })
    );

    expect(g.held).toEqual(["gone"]);
    expect(issuesOf(refused)).toEqual([
      expect.objectContaining({
        path: "areas[0].component",
        code: LAYOUT_COMPONENT_MISSING,
      }),
    ]);
  });

  it("refuses a component it adds whose delete is running, naming the area", async () => {
    const g = guard({
      existing: ["going"],
      runs: [{ componentId: "going", purpose: "delete", phase: "preflight" }],
    });

    const refused = await refusalOf(
      g.write({ operation: "create", data: { areas: [footer("going")] } })
    );

    expect(issuesOf(refused)).toEqual([
      {
        path: "areas[0].component",
        code: LAYOUT_COMPONENT_BEING_DELETED,
        message:
          "The component chosen for the footer is being deleted, so it can't be used here. Choose another component for the footer.",
      },
    ]);
  });

  it("lets through a component it adds that exists and nothing is deleting", async () => {
    const g = guard({
      existing: ["fine"],
      // Removing a retired field's values is no delete.
      runs: [
        { componentId: "fine", purpose: "strip-retired", phase: "converting" },
      ],
    });

    await expect(
      g.write({ operation: "create", data: { areas: [header("fine")] } })
    ).resolves.toBeUndefined();
    expect(g.held).toEqual(["fine"]);
  });

  it("judges nothing it already held, and nothing for a delete", async () => {
    // A held reference is stored, so the delete's own check of the Layouts
    // sees it; judging it here would refuse every edit of a Layout whose
    // component is mid-delete.
    const g = guard({
      existing: [],
      runs: [{ componentId: "held", purpose: "delete", phase: "converting" }],
    });

    await g.write({
      data: { title: "x", areas: [header("held")] },
      originalData: { areas: [header({ id: "held" })] },
    });
    await g.write({ operation: "delete", data: { areas: [header("x")] } });

    expect(g.held).toEqual([]);
  });
});
