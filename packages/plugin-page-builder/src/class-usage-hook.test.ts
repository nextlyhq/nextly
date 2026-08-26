/**
 * Whether maintenance runs on every write that needs it, and whether it can
 * fail a save.
 *
 * Two failures matter here and they are opposite. A write that maintenance
 * skips leaves rows disagreeing with the document, so classes the page renders
 * read as unused and become deletable. A failure that ESCAPES tells an author
 * their save failed for a document already committed to disk.
 *
 * @module class-usage-hook.test
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  registerClassUsageMaintenance,
  type ClassUsagePluginContext,
} from "./class-usage-hook";

const INDEX = "nx_pb_class_usage";

/** A document whose single node applies the given classes. */
const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

/** A plugin context that records registrations, plus the handler it captured. */
function harness(
  options: {
    collection?: unknown;
    getCollection?: () => Promise<unknown>;
    draftSplit?: () => Promise<{ eligible: boolean }>;
    locales?: readonly string[];
  } = {}
) {
  const registered: string[] = [];
  const handlers: ((c: Record<string, unknown>) => unknown)[] = [];
  const errors: unknown[] = [];

  const ctx: ClassUsagePluginContext = {
    hooks: {
      on: (type, collection, handler) => {
        registered.push(`${type}:${collection}`);
        handlers.push(handler);
      },
    },
    services: {
      collections: {
        getCollection:
          options.getCollection ??
          (async () =>
            options.collection ?? {
              fields: [{ type: "blocks", name: "content" }],
            }),
      },
    },
    logger: { error: (message, meta) => errors.push({ message, meta }) },
  };

  const api = {
    find: vi.fn(async () => ({ docs: [], hasNextPage: false })),
    findByID: vi.fn(async () => documentUsing("hero")),
    create: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };

  registerClassUsageMaintenance({
    ctx,
    indexCollection: INDEX,
    draftSplit: options.draftSplit ?? (async () => ({ eligible: false })),
    locales: () => options.locales ?? [],
    limits: () => DEFAULT_LIMITS,
  });

  const fire = (over: Record<string, unknown> = {}) =>
    handlers[0]?.({
      collection: "pages",
      data: { id: "p1" },
      req: { nextly: api },
      ...over,
    });

  return { registered, fire, api, errors };
}

describe("what maintenance is registered on", () => {
  it("registers ONE wildcard handler per after-phase, not one per collection", async () => {
    // The set of collections is not known when the plugin is wired: the Schema
    // Builder creates them at runtime and a blocks field can be added later. A
    // list captured at registration would stop covering exactly the
    // collections that were added after it.
    const { registered } = harness();

    expect(registered).toEqual(["afterCreate:*", "afterUpdate:*"]);
  });
});

describe("which writes it acts on", () => {
  it("maintains a collection that declares a blocks field", async () => {
    const { fire, api } = harness();

    await fire();

    expect(api.create).toHaveBeenCalled();
  });

  it("does nothing for a collection with no blocks field, and asks nothing", async () => {
    // The common path: the hook fires for EVERY collection. The draft-split
    // question reaches the component registry, so an untracked collection must
    // not reach it — the filter is why this is affordable at all.
    const draftSplit = vi.fn(async () => ({ eligible: false }));
    const { fire, api } = harness({
      collection: { fields: [{ type: "text", name: "title" }] },
      draftSplit,
    });

    await fire();

    expect(draftSplit).not.toHaveBeenCalled();
    expect(api.findByID).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("SKIPS its own index collection, which it writes", async () => {
    // Every row this inserts is a create on that collection, which fires this
    // hook again. Without the guard the first maintained save recurses.
    const { fire, api } = harness();

    await fire({ collection: INDEX });

    expect(api.findByID).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does nothing when the hook was handed no Direct API", async () => {
    const { fire, api, errors } = harness();

    await fire({ req: {} });

    expect(api.create).not.toHaveBeenCalled();
    // Absent, not broken: some paths supply none, and there is no maintenance
    // to do without one. So it must not be reported as a failure either.
    expect(errors).toEqual([]);
  });

  it("does nothing when the saved record carries no usable id", async () => {
    // The id IS the entityKey of every row. Without one there is no
    // addressable subject, so filing anything would create rows no rebuild
    // could reconcile or sweep.
    const { fire, api } = harness();

    await fire({ data: {} });

    expect(api.create).not.toHaveBeenCalled();
  });
});

describe("the draft split it asks for", () => {
  it("enumerates BOTH variants when the collection keeps a working draft", async () => {
    const { fire, api } = harness({
      draftSplit: async () => ({ eligible: true }),
    });

    await fire();

    expect(api.findByID.mock.calls.map(c => c[0].draft)).toEqual([false, true]);
  });

  it("enumerates only the published variant when it does not", async () => {
    // The control on the case above. Filing rows against a draft that cannot
    // exist produces records nothing downstream can tell from real ones.
    const { fire, api } = harness({
      draftSplit: async () => ({ eligible: false }),
    });

    await fire();

    expect(api.findByID.mock.calls.map(c => c[0].draft)).toEqual([false]);
  });
});

describe("failure, on a write that has already committed", () => {
  it("does not throw when the config read fails", async () => {
    const { fire, errors } = harness({
      getCollection: async () => {
        throw new Error("registry unavailable");
      },
    });

    await expect(fire()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("does not throw when the draft-split question fails", async () => {
    const { fire, errors } = harness({
      draftSplit: async () => {
        throw new Error("component registry unavailable");
      },
    });

    await expect(fire()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("reports a per-subject failure without throwing", async () => {
    // A subject's rows are left disagreeing with the document until a rebuild.
    // That is recoverable; telling the author their committed save failed is
    // not, so it reaches the logger and nothing else.
    const { fire, api, errors } = harness();
    api.find.mockRejectedValueOnce(new Error("index unavailable"));

    await expect(fire()).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(String((errors[0] as { message: string }).message)).toContain(
      "disagrees with the document"
    );
  });
});
