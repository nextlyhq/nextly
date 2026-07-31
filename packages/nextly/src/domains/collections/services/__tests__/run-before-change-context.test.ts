// The context `runBeforeChange` hands a code-registered handler.
//
// Giving `beforeChange` its own execution point means building its context in
// one new place, and a context built fresh carries only what it was told to.
// Both fields below were already reaching handlers through the pre-validation
// queue's context, so dropping either is a silent regression rather than a
// missing feature: the handler still runs, it just decides on less.

import { describe, expect, it } from "vitest";

import { HookRegistry } from "../../../../hooks/hook-registry";
import type { HookContext } from "../../../../hooks/types";
import { CollectionHookService } from "../collection-hook-service";

const SLUG = "beforechange_ctx_posts";

function serviceWithRecorder(): {
  service: CollectionHookService;
  seen: HookContext[];
} {
  const registry = new HookRegistry();
  const seen: HookContext[] = [];
  registry.register("beforeChange", SLUG, ctx => {
    seen.push(ctx as HookContext);
    return ctx.data;
  });
  return { service: new CollectionHookService(registry), seen };
}

describe("the context runBeforeChange builds", () => {
  it("carries the transaction executor to a code handler", async () => {
    // A handler doing the documented transaction-bound read through
    // `context.executor` would otherwise fall back to the pool while the
    // caller's transaction still holds its connection.
    const { service, seen } = serviceWithRecorder();
    const executor = { marker: "tx" };

    await service.runBeforeChange({
      collection: SLUG,
      operation: "create",
      data: { title: "t" },
      storedHooks: [],
      queryDatabase: () => Promise.resolve(false),
      executor,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].executor).toBe(executor);
  });

  it("carries the row an update is changing", async () => {
    const { service, seen } = serviceWithRecorder();
    const originalData = { title: "before" };

    await service.runBeforeChange({
      collection: SLUG,
      operation: "update",
      data: { title: "after" },
      storedHooks: [],
      queryDatabase: () => Promise.resolve(false),
      originalData,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].originalData).toEqual(originalData);
  });

  it("replaces the document when a handler returns its own object", async () => {
    // The result is folded onto the caller's object rather than reassigned, so
    // this pins that folding as replacement: a key the handler left out is
    // gone, not merged back from the original.
    const registry = new HookRegistry();
    registry.register("beforeChange", SLUG, () => ({ kept: "yes" }));
    const service = new CollectionHookService(registry);
    const data: Record<string, unknown> = { kept: "no", dropped: "x" };

    await service.runBeforeChange({
      collection: SLUG,
      operation: "create",
      data,
      storedHooks: [],
      queryDatabase: () => Promise.resolve(false),
    });

    expect(data).toEqual({ kept: "yes" });
  });
});
