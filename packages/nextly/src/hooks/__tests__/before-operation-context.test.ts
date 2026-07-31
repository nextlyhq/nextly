/**
 * A `beforeOperation` handler receives the operation's args.
 *
 * `CollectionHooks` typed these as `HookHandler`, whose context exposes `data`,
 * while registration routes them to `executeBeforeOperation()`, which supplies
 * `args`. A handler written against the declared type therefore read
 * `context.data` and got `undefined`, and returning modified data produced
 * neither the shape the caller consumes nor any error.
 *
 * The two signatures are now stored and registered separately, so they can no
 * longer be passed through one another.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { HookRegistry } from "../hook-registry";
import { registerCollectionHooks } from "../register-collection-hooks";
import type { BeforeOperationArgs, BeforeOperationContext } from "../types";

type Args = BeforeOperationArgs<Record<string, unknown>>;

function collectionWith(
  handler: (c: BeforeOperationContext) => unknown
): Parameters<typeof registerCollectionHooks>[0] {
  return [
    {
      slug: "posts",
      fields: [],
      hooks: { beforeOperation: [handler] },
    },
  ] as unknown as Parameters<typeof registerCollectionHooks>[0];
}

describe("beforeOperation context shape", () => {
  it("hands a handler declared on a collection the operation's args", async () => {
    const registry = new HookRegistry();
    const seen: { args?: Args; data?: unknown }[] = [];

    registerCollectionHooks(
      collectionWith(context => {
        // `data` is what the old declared type promised and is not part of this
        // context; recording both is what distinguishes "args arrived" from
        // "nothing arrived".
        seen.push({
          args: context.args as Args,
          data: (context as { data?: unknown }).data,
        });
      }),
      registry
    );

    await registry.executeBeforeOperation({
      collection: "posts",
      operation: "read",
      args: { where: { archived: false } },
    } as BeforeOperationContext);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.args).toEqual({ where: { archived: false } });
    expect(seen[0]?.data).toBeUndefined();
  });

  it("lets a returned args object replace what the operation consumes", async () => {
    const registry = new HookRegistry();

    registerCollectionHooks(
      collectionWith(context => ({
        ...(context.args as Args),
        where: { archived: false },
      })),
      registry
    );

    const result = await registry.executeBeforeOperation({
      collection: "posts",
      operation: "read",
      args: { where: { published: true } },
    } as BeforeOperationContext);

    expect(result).toEqual({ where: { archived: false } });
  });

  it("chains handlers, each seeing the previous one's args", async () => {
    const registry = new HookRegistry();
    registry.registerBeforeOperation("posts", context => ({
      ...(context.args as Args),
      first: true,
    }));
    registry.registerBeforeOperation("posts", context => ({
      ...(context.args as Args),
      second: true,
    }));

    const result = await registry.executeBeforeOperation({
      collection: "posts",
      operation: "read",
      args: {},
    } as BeforeOperationContext);

    expect(result).toEqual({ first: true, second: true });
  });

  describe("the two stores do not leak into each other", () => {
    it("a beforeOperation hook does not run as a data-phase hook", async () => {
      const registry = new HookRegistry();
      let ran = false;
      registry.registerBeforeOperation("posts", () => {
        ran = true;
      });

      await registry.execute("beforeCreate", {
        collection: "posts",
        operation: "create",
        data: {},
      } as never);

      expect(ran).toBe(false);
    });

    it("clearing a collection clears its beforeOperation hooks too", async () => {
      // Both stores are keyed the same way, so a clear that reached only one
      // would leave a cleared collection still running its operation hooks.
      const registry = new HookRegistry();
      registry.registerBeforeOperation("posts", () => ({ touched: true }));
      expect(registry.hasHooks("beforeOperation", "posts")).toBe(true);

      registry.clearCollection("posts");

      expect(registry.hasHooks("beforeOperation", "posts")).toBe(false);
      const result = await registry.executeBeforeOperation({
        collection: "posts",
        operation: "read",
        args: { where: {} },
      } as BeforeOperationContext);
      expect(result).toEqual({ where: {} });
    });

    it("clear() empties both stores", () => {
      const registry = new HookRegistry();
      registry.registerBeforeOperation("posts", () => undefined);
      registry.register("beforeCreate", "posts", () => undefined);

      registry.clear();

      expect(registry.hasHooks("beforeOperation", "posts")).toBe(false);
      expect(registry.hasHooks("beforeCreate", "posts")).toBe(false);
    });

    it("counts and unregisters beforeOperation handlers", () => {
      const registry = new HookRegistry();
      const handler = () => undefined;
      registry.registerBeforeOperation("posts", handler);
      expect(registry.getHookCount("beforeOperation", "posts")).toBe(1);

      registry.unregisterBeforeOperation("posts", handler);
      expect(registry.getHookCount("beforeOperation", "posts")).toBe(0);
    });
  });

  describe("passing beforeOperation to the wrong method is refused", () => {
    // The types already exclude it, but JavaScript callers and untypechecked
    // code do not see that. Storing it would put the handler where
    // `executeBeforeOperation` never looks, so it would never run at all.
    it("register() throws rather than silently never running the hook", () => {
      const registry = new HookRegistry();
      let thrown: unknown;
      try {
        (
          registry.register as unknown as (
            t: string,
            c: string,
            h: () => void
          ) => void
        )("beforeOperation", "posts", () => undefined);
      } catch (error) {
        thrown = error;
      }

      expect(NextlyError.is(thrown)).toBe(true);
      expect(String((thrown as Error).message)).toContain(
        "registerBeforeOperation"
      );
    });

    it("unregister() throws for the same reason", () => {
      const registry = new HookRegistry();
      let thrown: unknown;
      try {
        (
          registry.unregister as unknown as (
            t: string,
            c: string,
            h: () => void
          ) => void
        )("beforeOperation", "posts", () => undefined);
      } catch (error) {
        thrown = error;
      }

      expect(NextlyError.is(thrown)).toBe(true);
      expect(String((thrown as Error).message)).toContain(
        "unregisterBeforeOperation"
      );
    });

    it("the other phases still register normally", () => {
      // The mirror: the guard must reject one value, not every value.
      const registry = new HookRegistry();
      registry.register("beforeCreate", "posts", () => undefined);
      registry.register("afterRead", "posts", () => undefined);

      expect(registry.getHookCount("beforeCreate", "posts")).toBe(1);
      expect(registry.getHookCount("afterRead", "posts")).toBe(1);
    });
  });
});
