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
 * holds one. The answer last read stands there, and none counts as a
 * lifecycle.
 */
describe("the component store's lifecycle, as the guard reads it", () => {
  /** A registry read that counts its calls, answering `answers` in turn. */
  function registry(...answers: (boolean | Error)[]) {
    let reads = 0;
    const read = async () => {
      const answer = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      if (answer instanceof Error) throw answer;
      return answer ?? true;
    };
    return { read, reads: () => reads };
  }

  it("reads nothing inside a transaction, counting a store never read as having one", async () => {
    const r = registry(false);
    const lifecycle = storeLifecycle(r.read);

    await expect(lifecycle.has(true)).resolves.toBe(true);
    expect(r.reads()).toBe(0);
  });

  it("answers inside a transaction with what was read when the site was ready", async () => {
    const r = registry(false);
    const lifecycle = storeLifecycle(r.read);
    await lifecycle.prime();

    await expect(lifecycle.has(true)).resolves.toBe(false);
    expect(r.reads()).toBe(1);
  });

  it("reads afresh for a save made on its own, and keeps that answer", async () => {
    const r = registry(false, true);
    const lifecycle = storeLifecycle(r.read);
    await lifecycle.prime();

    await expect(lifecycle.has(false)).resolves.toBe(true);
    await expect(lifecycle.has(true)).resolves.toBe(true);
    expect(r.reads()).toBe(2);
  });

  it("counts a read that fails as a lifecycle", async () => {
    const r = registry(new Error("down"));
    const lifecycle = storeLifecycle(r.read);

    await expect(lifecycle.has(false)).resolves.toBe(true);
  });

  it("asks the lifecycle as inside a transaction when the save carries the caller's executor", async () => {
    const asked: boolean[] = [];
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
      lifecycle: async inATransaction => {
        asked.push(inATransaction);
        return false;
      },
    });

    await handlers.get("beforeChange")?.({
      operation: "update",
      originalData: { id: 7, status: "published" },
      data: { status: "draft" },
      executor: {},
    });

    expect(asked).toEqual([true]);
  });
});
