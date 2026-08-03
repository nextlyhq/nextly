/**
 * The after-write phases are side-effect phases: a handler's return does not
 * become the row.
 *
 * `execute()` assigned any returned value to the data it passes on, for every
 * phase. Because the write has already committed by then, a second
 * `afterCreate`/`afterUpdate`/`afterDelete` handler was shown whatever the first
 * returned rather than the row that was persisted -- and returning the result of
 * a side-effect call is easy to do by accident. The registry's own documentation
 * already said these returns are ignored.
 */
import { describe, expect, it } from "vitest";

import type { SideEffectHookFailure } from "../hook-registry";
import { HookRegistry } from "../hook-registry";
import type { HookContext } from "../types";

type Row = Record<string, unknown>;

function contextFor(
  collection: string,
  operation: string,
  data: Row
): HookContext<Row> {
  return { collection, operation, data } as unknown as HookContext<Row>;
}

describe("side-effect phase return values", () => {
  const sideEffectPhases = [
    { hookType: "afterCreate", operation: "create" },
    { hookType: "afterUpdate", operation: "update" },
    { hookType: "afterDelete", operation: "delete" },
  ] as const;

  for (const { hookType, operation } of sideEffectPhases) {
    it(`${hookType}: a second handler sees the persisted row, not the first handler's return`, async () => {
      const registry = new HookRegistry();
      const persisted = { id: "1", title: "Stored" };

      // The accident this guards against: returning the result of a side-effect
      // call. Here it is a plausible-looking audit record.
      registry.register(hookType, "docs", () => ({
        auditId: "audit-9",
      }));

      const seen: Row[] = [];
      registry.register(hookType, "docs", ctx => {
        seen.push(ctx.data as Row);
      });

      const result = await registry.execute(
        hookType,
        contextFor("docs", operation, persisted)
      );

      // What the second handler was shown.
      expect(seen).toEqual([persisted]);
      // And what the caller gets back, since the same value flows out.
      expect(result).toEqual(persisted);
    });
  }

  it("does not let a side-effect return reach the caller even with one handler", async () => {
    // The single-handler case takes a different path through the loop than the
    // two-handler case above, and the Single update runner assigns whatever
    // `execute` returns onto the response document.
    const registry = new HookRegistry();
    const persisted = { id: "1", title: "Stored" };
    registry.register("afterUpdate", "docs", () => ({ injected: true }));

    const result = await registry.execute(
      "afterUpdate",
      contextFor("docs", "update", persisted)
    );

    expect(result).toEqual(persisted);
    expect(result).not.toHaveProperty("injected");
  });

  it("still runs every side-effect handler, and reports a throw instead of raising it", async () => {
    // Ignoring the return must not turn into ignoring the handler: the phase is
    // where cache invalidation and notifications live, and a throw is how one
    // reports that it failed.
    const registry = new HookRegistry();
    const ran: string[] = [];
    registry.register("afterCreate", "docs", () => {
      ran.push("first");
    });
    registry.register("afterCreate", "docs", () => {
      ran.push("second");
    });

    await registry.execute("afterCreate", contextFor("docs", "create", {}));
    expect(ran).toEqual(["first", "second"]);

    // A throw does not stop the phase either. The write has already committed,
    // so raising would report a durable row as a failure, and cancelling the
    // remaining handlers would turn one broken hook into several skipped ones.
    const throwing = new HookRegistry();
    const reached: string[] = [];
    throwing.register("afterCreate", "docs", () => {
      throw new Error("notification failed");
    });
    throwing.register("afterCreate", "docs", () => {
      reached.push("after the failure");
    });

    const failures: SideEffectHookFailure[] = [];
    await expect(
      throwing.execute("afterCreate", contextFor("docs", "create", {}), {
        onSideEffectError: failure => failures.push(failure),
      })
    ).resolves.toBeDefined();

    expect(reached).toEqual(["after the failure"]);
    expect(failures).toHaveLength(1);
    expect(failures[0].phase).toBe("afterCreate");
    expect(failures[0].collection).toBe("docs");
  });

  describe("the mirror: transforming phases are unaffected", () => {
    // Without these, "the return is ignored" could just as well be satisfied by
    // a registry that ignores every return, which would break the write and read
    // paths that depend on one.
    const transformingPhases = [
      { hookType: "beforeCreate", operation: "create" },
      { hookType: "beforeUpdate", operation: "update" },
      { hookType: "afterRead", operation: "read" },
    ] as const;

    for (const { hookType, operation } of transformingPhases) {
      it(`${hookType}: a handler's return is passed to the next handler and to the caller`, async () => {
        const registry = new HookRegistry();
        registry.register(hookType, "docs", ctx => ({
          ...(ctx.data as Row),
          first: true,
        }));

        const seen: Row[] = [];
        registry.register(hookType, "docs", ctx => {
          seen.push(ctx.data as Row);
          return { ...(ctx.data as Row), second: true };
        });

        const result = await registry.execute(
          hookType,
          contextFor("docs", operation, { id: "1" })
        );

        expect(seen).toEqual([{ id: "1", first: true }]);
        expect(result).toEqual({ id: "1", first: true, second: true });
      });
    }

    it("beforeCreate can still set a value to null deliberately", async () => {
      // `null` is distinguished from `undefined` on purpose, so the check that
      // skips side-effect returns must not collapse that distinction.
      const registry = new HookRegistry();
      registry.register("beforeCreate", "docs", () => null);

      const result = await registry.execute(
        "beforeCreate",
        contextFor("docs", "create", { id: "1" })
      );
      expect(result).toBeNull();
    });
  });
});
