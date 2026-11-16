/**
 * Where a hook context's `afterCommit` is offered, and that it survives a copy.
 *
 * `afterCommit` holds an effect until the write a hook belongs to is durable.
 * That is only true of a hook that runs AFTER the write: a before-hook runs
 * before the write opens its transaction, so there is nothing yet to wait
 * for, and an effect handed over there would run at once, for a write a later
 * hook or the insert itself may still refuse. So it is offered to the
 * after-write phases alone, and a before-hook sees none.
 *
 * `cloneContext` is how a hook hands a context on; a clone without it would
 * leave whatever receives the clone no way to defer, and it would act at once.
 */
import { describe, expect, it } from "vitest";

import { cloneContext } from "../context-builder";
import { HookRegistry } from "../hook-registry";
import type { HookContext, HookContextPhase } from "../types";

type Row = Record<string, unknown>;

/**
 * A context carrying an `afterCommit` that holds what it is handed, as a
 * transaction would until its commit, so a test can see an effect was held
 * rather than run.
 */
function contextHolding(operation: string): {
  context: HookContext<Row>;
  held: (() => unknown)[];
} {
  const held: (() => unknown)[] = [];
  const context = {
    collection: "docs",
    operation,
    data: { id: "1" },
    context: {},
    afterCommit: (effect: () => unknown) => {
      held.push(effect);
      return Promise.resolve();
    },
  } as unknown as HookContext<Row>;
  return { context, held };
}

describe("a hook context's afterCommit", () => {
  it("survives cloneContext, and a clone still holds the effect", async () => {
    const { context, held } = contextHolding("create");
    let ran = false;

    const clone = cloneContext(context);
    await clone.afterCommit?.(() => {
      ran = true;
    });

    expect(held).toHaveLength(1);
    expect(ran).toBe(false);
  });

  const phases: [HookContextPhase, string, boolean][] = [
    ["beforeCreate", "create", false],
    ["beforeUpdate", "update", false],
    ["beforeChange", "create", false],
    ["beforeDelete", "delete", false],
    ["afterCreate", "create", true],
    ["afterUpdate", "update", true],
    ["afterDelete", "delete", true],
  ];

  it.each(phases)(
    "is offered to a %s handler: %s",
    async (phase, operation, offered) => {
      const registry = new HookRegistry();
      const seen: boolean[] = [];
      registry.register(phase, "docs", ctx => {
        seen.push(typeof ctx.afterCommit === "function");
        return undefined;
      });

      await registry.execute(phase, contextHolding(operation).context);

      expect(seen).toEqual([offered]);
    }
  );
});
