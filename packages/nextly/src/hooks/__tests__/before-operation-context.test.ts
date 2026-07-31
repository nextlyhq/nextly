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
import { createPluginContext } from "../../plugins/plugin-context";
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

describe("the plugin surface can register beforeOperation", () => {
  // `PluginHookRegistry` is re-exported through `@nextlyhq/plugin-sdk`, so a
  // plugin that used `ctx.hooks.on("beforeOperation", ...)` needs a supported
  // replacement rather than a phase it can no longer reach.
  // The context factory proxies whatever the service getter returns, so it has
  // to hand back an object for every name.
  const stubServices = (() => ({})) as Parameters<
    typeof createPluginContext
  >[0];

  function bridgeFor(registry: HookRegistry) {
    return {
      register: registry.register.bind(registry),
      unregister: registry.unregister.bind(registry),
      registerBeforeOperation: registry.registerBeforeOperation.bind(registry),
      unregisterBeforeOperation:
        registry.unregisterBeforeOperation.bind(registry),
    };
  }

  it("routes onBeforeOperation through to the registry", async () => {
    const registry = new HookRegistry();
    const ctx = createPluginContext(stubServices, bridgeFor(registry));

    ctx.hooks.onBeforeOperation("posts", context => ({
      ...(context.args as Args),
      scoped: true,
    }));

    const result = await registry.executeBeforeOperation({
      collection: "posts",
      operation: "read",
      args: {},
    } as BeforeOperationContext);

    expect(result).toEqual({ scoped: true });
  });

  it("offBeforeOperation removes it again", async () => {
    const registry = new HookRegistry();
    const ctx = createPluginContext(stubServices, bridgeFor(registry));
    const handler = (context: BeforeOperationContext) => ({
      ...(context.args as Args),
      scoped: true,
    });

    ctx.hooks.onBeforeOperation("posts", handler);
    // Asserted before removing, so an `on` that registered nothing cannot make
    // this pass by leaving nothing to remove.
    expect(registry.getHookCount("beforeOperation", "posts")).toBe(1);

    ctx.hooks.offBeforeOperation("posts", handler);
    expect(registry.getHookCount("beforeOperation", "posts")).toBe(0);

    const result = await registry.executeBeforeOperation({
      collection: "posts",
      operation: "read",
      args: {},
    } as BeforeOperationContext);

    expect(result).toEqual({});
  });
});

describe("published examples do not instruct a call that now throws", () => {
  // A doc example is copied verbatim far more often than it is read carefully,
  // and after the split these two would either fail typecheck or throw at
  // runtime.
  it("no source file tells a consumer to pass beforeOperation to register()", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      new URL("../types.ts", import.meta.url),
      new URL("../hook-registry.ts", import.meta.url),
      new URL("../../hooks.ts", import.meta.url),
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(
        /\b(?:registerHook|registry\.register|hooks\.on)\(\s*['"]beforeOperation['"]/
      );
    }
  });
});

describe("execute() refuses the phase it cannot run", () => {
  it("throws rather than reporting no hooks when handed beforeOperation", async () => {
    // `execute` reads only the data-phase store, so reaching it with this phase
    // would return `context.data` having run nothing -- indistinguishable from
    // "no hooks are registered", even though one is.
    const registry = new HookRegistry();
    let ran = false;
    registry.registerBeforeOperation("posts", () => {
      ran = true;
    });

    const thrown = await registry
      .execute(
        "beforeOperation" as never,
        {
          collection: "posts",
          operation: "read",
          data: { id: "1" },
        } as never
      )
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(NextlyError.is(thrown)).toBe(true);
    expect(String((thrown as Error).message)).toContain(
      "executeBeforeOperation"
    );
    // The registered handler is genuinely reachable -- through the right method.
    expect(ran).toBe(false);
    await registry.executeBeforeOperation({
      collection: "posts",
      operation: "read",
      args: {},
    } as BeforeOperationContext);
    expect(ran).toBe(true);
  });

  it("still executes the data phases normally", async () => {
    // The mirror: the guard must reject one phase, not narrow the method.
    const registry = new HookRegistry();
    registry.register("beforeCreate", "posts", ctx => ({
      ...(ctx.data as Args),
      touched: true,
    }));

    const result = await registry.execute("beforeCreate", {
      collection: "posts",
      operation: "create",
      data: {},
    } as never);

    expect(result).toEqual({ touched: true });
  });
});
