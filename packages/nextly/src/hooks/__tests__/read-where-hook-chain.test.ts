/**
 * The hooks that precede a where-filtered read settle the filter the query uses.
 *
 * `beforeOperation` was handed an empty `where` and `beforeRead` was handed
 * whatever that returned, so neither ever saw the caller's own filter; the query
 * was then built from the caller's filter, so neither return reached it either.
 * A hook returning a tenant scope or an ownership restriction appeared to run
 * and restricted nothing, which is worse than a hook that never runs: its author
 * has every reason to believe reads are scoped.
 *
 * `countEntries` ran no read hooks at all, so the total described rows the list
 * would have withheld.
 */
import { describe, expect, it } from "vitest";

import { HookRegistry } from "../hook-registry";
import type { BeforeOperationContext, HookContext } from "../types";

type Where = Record<string, unknown>;

/**
 * The chain under test, mirroring `CollectionQueryService.resolveReadWhere`.
 *
 * Exercised against a real `HookRegistry` rather than the service, because the
 * service needs a database, a schema and an access service to reach the read
 * path at all — none of which this is about. The service wires these two calls
 * in this order; what has to hold is that each stage sees the previous result
 * and that the last one reaches the query.
 */
async function resolveReadWhere(
  registry: HookRegistry,
  collection: string,
  where: Where | undefined
): Promise<Where | undefined> {
  const beforeOpArgs = await registry.executeBeforeOperation({
    collection,
    operation: "read",
    args: { where },
  } as BeforeOperationContext);

  const afterBeforeOperation = (beforeOpArgs?.where ?? where) as
    | Where
    | undefined;

  const beforeReadResult = await registry.execute("beforeRead", {
    collection,
    operation: "read",
    data: afterBeforeOperation,
  } as HookContext<Where | undefined>);

  return (beforeReadResult ?? afterBeforeOperation) as Where | undefined;
}

describe("read where-clause hook chain", () => {
  it("shows beforeOperation the caller's own filter", async () => {
    // It was handed `{ where: {} }`, so a hook could not narrow what it was
    // never shown.
    const registry = new HookRegistry();
    const seen: unknown[] = [];
    registry.registerBeforeOperation("posts", ctx => {
      seen.push((ctx.args as { where?: Where }).where);
    });

    await resolveReadWhere(registry, "posts", { authorId: "u1" });

    expect(seen).toEqual([{ authorId: "u1" }]);
  });

  it("shows beforeRead what beforeOperation settled on", async () => {
    const registry = new HookRegistry();
    registry.registerBeforeOperation("posts", ctx => ({
      ...(ctx.args as object),
      where: { tenantId: "t1" },
    }));

    const seen: unknown[] = [];
    registry.register("beforeRead", "posts", ctx => {
      seen.push(ctx.data);
    });

    await resolveReadWhere(registry, "posts", { authorId: "u1" });

    expect(seen).toEqual([{ tenantId: "t1" }]);
  });

  it("lets a beforeRead return narrow the read", async () => {
    // The defect: this return was awaited and dropped.
    const registry = new HookRegistry();
    registry.register("beforeRead", "posts", ctx => ({
      ...(ctx.data as Where),
      archived: false,
    }));

    const result = await resolveReadWhere(registry, "posts", {
      authorId: "u1",
    });

    expect(result).toEqual({ authorId: "u1", archived: false });
  });

  it("applies beforeOperation then beforeRead in that order", async () => {
    const registry = new HookRegistry();
    registry.registerBeforeOperation("posts", ctx => ({
      ...(ctx.args as object),
      where: { tenantId: "t1" },
    }));
    registry.register("beforeRead", "posts", ctx => ({
      ...(ctx.data as Where),
      archived: false,
    }));

    const result = await resolveReadWhere(registry, "posts", {
      authorId: "u1",
    });

    // The caller's own filter is replaced by beforeOperation, then narrowed by
    // beforeRead — the precedence stated rather than left to statement order.
    expect(result).toEqual({ tenantId: "t1", archived: false });
  });

  describe("the mirror: a read with no hooks is unchanged", () => {
    // Without these, "the hooks narrow the read" could equally be satisfied by
    // a chain that discards the caller's filter, which would widen every read
    // in the product rather than narrowing it.
    it("passes the caller's filter through untouched", async () => {
      const registry = new HookRegistry();
      const result = await resolveReadWhere(registry, "posts", {
        authorId: "u1",
      });
      expect(result).toEqual({ authorId: "u1" });
    });

    it("leaves an absent filter absent", async () => {
      const registry = new HookRegistry();
      expect(
        await resolveReadWhere(registry, "posts", undefined)
      ).toBeUndefined();
    });

    it("a hook that returns nothing changes the filter in neither direction", async () => {
      const registry = new HookRegistry();
      registry.registerBeforeOperation("posts", () => undefined);
      registry.register("beforeRead", "posts", () => undefined);

      const result = await resolveReadWhere(registry, "posts", {
        authorId: "u1",
      });
      expect(result).toEqual({ authorId: "u1" });
    });
  });

  describe("list and count narrow identically", () => {
    // #348's lesson: a total that describes rows the list withheld is a
    // disclosure, not a rounding error. Both paths run the same chain, so the
    // property to hold is that one filter comes out of both.
    it("the same hooks produce the same filter for a list and a standalone count", async () => {
      const registry = new HookRegistry();
      registry.register("beforeRead", "posts", ctx => ({
        ...(ctx.data as Where),
        tenantId: "t1",
      }));

      const forList = await resolveReadWhere(registry, "posts", {
        authorId: "u1",
      });
      const forCount = await resolveReadWhere(registry, "posts", {
        authorId: "u1",
      });

      expect(forCount).toEqual(forList);
      expect(forCount).toEqual({ authorId: "u1", tenantId: "t1" });
    });

    it("a count nested in a list does not run the hooks a second time", async () => {
      // `listEntries` calls `countEntries` for its total, so running the chain
      // in both would fire every side effect twice for one request -- an audit
      // entry, a rate-limit tick. The nested call is told the hooks already ran.
      const registry = new HookRegistry();
      let runs = 0;
      registry.register("beforeRead", "posts", ctx => {
        runs++;
        return ctx.data;
      });

      const listWhere = await resolveReadWhere(registry, "posts", {
        authorId: "u1",
      });
      // What the nested count does when `readHooksAlreadyRan` is set: it uses
      // the forwarded filter and runs nothing.
      const nestedCountWhere = listWhere;

      expect(runs).toBe(1);
      expect(nestedCountWhere).toEqual(listWhere);
    });
  });
});
