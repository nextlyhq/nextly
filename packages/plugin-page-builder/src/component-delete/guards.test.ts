/**
 * The component guards on a store whose ids are numbers: the delete action's
 * own delete is let through, and an unpublish is judged, rather than either
 * being read as naming no component.
 */
import { describe, expect, it } from "vitest";

import { registerComponentGuards, storeLifecycle } from "./guards";
import { COMPONENT_DELETE_CONTEXT_KEY } from "./job";

/** The guards as registered, by hook phase. */
function guards(runPhase: string, unused = true, lifecycle = true) {
  const handlers = new Map<string, (context: unknown) => unknown>();
  const asked: string[] = [];
  registerComponentGuards({
    ctx: {
      hooks: {
        on: (type, _collection, handler) => handlers.set(type, handler),
      },
    },
    components: "components",
    runs: () => ({
      runFor: async (componentId: string) => {
        asked.push(componentId);
        return {
          id: "run-1",
          componentId,
          purpose: "delete" as const,
          startedBy: "user:1",
          phase: runPhase as "deleting",
          cursor: null,
        };
      },
    }),
    confirmUnused: async () =>
      unused ? { kind: "unused" as const } : { kind: "unsure" as const },
    lifecycle: async () => lifecycle,
  });
  return { handlers, asked };
}

describe("the component guards with numeric ids", () => {
  it("lets the delete action's own delete through for a numeric id", async () => {
    const { handlers, asked } = guards("deleting");

    await expect(
      handlers.get("beforeDelete")?.({
        data: { id: 7 },
        context: { [COMPONENT_DELETE_CONTEXT_KEY]: "run-1" },
      })
    ).resolves.toBeUndefined();
    expect(asked).toEqual(["7"]);
  });

  it("judges an unpublish of a numeric id rather than letting it through unread", async () => {
    const { handlers } = guards("deleting", false);

    await expect(
      handlers.get("beforeChange")?.({
        operation: "update",
        originalData: { id: 7, status: "published" },
        data: { status: "draft" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/**
 * A store that keeps its status per language: core names the status stored in
 * the language the write names as `storedStatus`, and the guard judges the
 * unpublish from that rather than from the main row's.
 */
describe("the unpublish guard on a store that keeps its status per language", () => {
  const save = (storedStatus: unknown, mainStatus: string) => ({
    operation: "update",
    originalData: { id: 7, status: mainStatus },
    storedStatus,
    data: { status: "draft" },
  });

  it("judges a published translation saved as a draft while the main row is a draft", async () => {
    const { handlers } = guards("idle", false);

    await expect(
      handlers.get("beforeChange")?.(save("published", "draft"))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets a draft translation's draft save through while the main row is published", async () => {
    const { handlers } = guards("idle", false);

    await expect(
      handlers.get("beforeChange")?.(save("draft", "published"))
    ).resolves.toBeUndefined();
  });

  it("runs the check when the language's status cannot be read", async () => {
    const { handlers } = guards("idle", false);

    await expect(
      handlers.get("beforeChange")?.(save(1, "draft"))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/**
 * A store without the Draft/Published lifecycle: `status` is an ordinary
 * field of the host's there, so changing it unpublishes nothing.
 */
describe("the unpublish guard on a store without a lifecycle", () => {
  const save = {
    operation: "update",
    originalData: { id: 7, status: "published" },
    data: { status: "archived" },
  };

  it("lets a used component's field named status change", async () => {
    const { handlers } = guards("idle", false, false);

    await expect(handlers.get("beforeChange")?.(save)).resolves.toBeUndefined();
  });

  it("refuses the same save where the store has a lifecycle", async () => {
    const { handlers } = guards("idle", false, true);

    await expect(handlers.get("beforeChange")?.(save)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

/**
 * The store's lifecycle is never read inside a caller's transaction: that
 * read would take a second connection from the pool while the transaction
 * holds one. There the store counts as having a lifecycle, so the check runs;
 * only a fresh read for a save made on its own lets a save through.
 */
describe("the component store's lifecycle, as the guard reads it", () => {
  /** A registry read that counts its calls, answering `answer`. */
  function registry(answer: boolean | Error) {
    let reads = 0;
    const read = async () => {
      reads += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { read, reads: () => reads };
  }

  it("reads nothing inside a transaction, and counts the store as having a lifecycle", async () => {
    const r = registry(false);
    const has = storeLifecycle(r.read);

    await expect(has(true)).resolves.toBe(true);
    expect(r.reads()).toBe(0);
  });

  it("still counts a lifecycle inside a transaction after a save on its own read none", async () => {
    const r = registry(false);
    const has = storeLifecycle(r.read);

    await expect(has(false)).resolves.toBe(false);
    // No answer carries into a transaction: a stale "none" would skip the check.
    await expect(has(true)).resolves.toBe(true);
    expect(r.reads()).toBe(1);
  });

  it("reads afresh for each save made on its own", async () => {
    const r = registry(true);
    const has = storeLifecycle(r.read);

    await expect(has(false)).resolves.toBe(true);
    await expect(has(false)).resolves.toBe(true);
    expect(r.reads()).toBe(2);
  });

  it("counts a read that fails as a lifecycle", async () => {
    const has = storeLifecycle(registry(new Error("down")).read);

    await expect(has(false)).resolves.toBe(true);
  });

  it("runs the check for a save carrying the caller's executor, on a store a fresh read finds no lifecycle in", async () => {
    const r = registry(false);
    const handlers = new Map<string, (context: unknown) => unknown>();
    registerComponentGuards({
      ctx: {
        hooks: {
          on: (type, _collection, handler) => handlers.set(type, handler),
        },
      },
      components: "components",
      runs: () => ({ runFor: async () => null }),
      confirmUnused: async () => ({ kind: "unused" as const }),
      lifecycle: storeLifecycle(r.read),
    });

    // Inside a caller's transaction an unpublish is refused as a batch one:
    // the check ran, and nothing was read on the pool.
    await expect(
      handlers.get("beforeChange")?.({
        operation: "update",
        originalData: { id: 7, status: "published" },
        data: { status: "draft" },
        executor: {},
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(r.reads()).toBe(0);
  });
});
