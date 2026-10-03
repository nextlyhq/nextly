import { describe, expect, it, vi } from "vitest";

import { publishHookPoints } from "./hook-points";
import { EventBus } from "../events/event-bus";

import { getCoreVersion } from "./core-version";
import { createPluginContext } from "./plugin-context";

function makeCtx(plugin?: unknown) {
  const db = { __db: true };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const collections = { __collections: true };
  const users = { __users: true };
  const media = { __media: true };
  const email = { __email: true };
  const config = { plugins: [] };

  const getServiceFn = ((name: string) => {
    switch (name) {
      case "collectionService":
        return collections;
      case "userService":
        return users;
      case "mediaService":
        return media;
      case "emailService":
        return email;
      case "db":
        return db;
      case "logger":
        return logger;
      case "config":
        return config;
      default:
        throw new Error(`unknown service: ${name}`);
    }
  }) as unknown as Parameters<typeof createPluginContext>[0];

  // Mirrors the registry interface rather than a subset of it: a double that
  // omits methods the real one requires certifies a context the production
  // registry would reject.
  const hookRegistry = {
    register: vi.fn(),
    unregister: vi.fn(),
    registerBeforeOperation: vi.fn(),
    unregisterBeforeOperation: vi.fn(),
  };
  const ctx = createPluginContext(getServiceFn, hookRegistry, plugin as never);
  return { ctx, db, logger, collections, email };
}

describe("createPluginContext (P1 reshape)", () => {
  it("exposes db and logger at the top level", () => {
    const { ctx, logger } = makeCtx();
    // Not the live instance: a plugin that did not declare `db.rawSql` gets a
    // surface carrying only the fluent methods, so `execute` and `run` are not
    // reachable however the plugin is written.
    expect(ctx.db).toBeDefined();
    expect(Object.keys(ctx.db as object).sort()).toEqual([
      "delete",
      "insert",
      "select",
      "transaction",
      "update",
    ]);
    expect(ctx.logger).toBe(logger);
  });

  it("hands the live instance to a plugin that declared rawSql", () => {
    // The control: a wrapper applied unconditionally would make the declared
    // capability buy nothing.
    const { ctx, db } = makeCtx({
      name: "@test/raw",
      version: "1.0.0",
      nextly: "*",
      capabilities: { db: { rawSql: true } },
    });
    // The live instance's own members, raw SQL included, are reachable.
    expect((ctx.db as unknown as typeof db).__db).toBe(true);
  });

  it("checks a filter payload against the schema its point declared", async () => {
    // The declarations were collected at resolve and discarded, so
    // `contributes.hookPoints[].payload` checked nothing and the documented
    // development-time warning could never arrive. Asserted at the SEAM
    // because that is where a payload exists to be checked.
    publishHookPoints(
      new Map([
        [
          "acme.seam",
          {
            name: "acme.seam",
            kind: "filter" as const,
            owner: "@acme/p",
            payload: { safeParse: () => ({ success: false }) },
          },
        ],
      ])
    );
    const { ctx, logger } = makeCtx();
    await ctx.filters.apply("acme.seam", { wrong: true }, {} as never);
    expect(logger.warn).toHaveBeenCalled();
    publishHookPoints(new Map());
  });

  it("stays silent at a seam whose payload matches", async () => {
    // The control. A checker that warned unconditionally would satisfy the
    // test above while burying the log for every correct plugin.
    publishHookPoints(
      new Map([
        [
          "acme.ok",
          {
            name: "acme.ok",
            kind: "filter" as const,
            owner: "@acme/p",
            payload: { safeParse: () => ({ success: true }) },
          },
        ],
      ])
    );
    const { ctx, logger } = makeCtx();
    await ctx.filters.apply("acme.ok", { fine: true }, {} as never);
    expect(logger.warn).not.toHaveBeenCalled();
    publishHookPoints(new Map());
  });

  it("checks a decision point's CONTEXT, the subject being decided", async () => {
    // The verdict has one shape at every point, so a schema describing the
    // subject always mismatched it: the check warned on every correct call.
    const seen: unknown[] = [];
    publishHookPoints(
      new Map([
        [
          "acme.gate",
          {
            name: "acme.gate",
            kind: "decision" as const,
            owner: "@acme/p",
            payload: {
              safeParse: (value: unknown) => {
                seen.push(value);
                return {
                  success:
                    typeof value === "object" &&
                    value !== null &&
                    "subject" in value,
                };
              },
            },
          },
        ],
      ])
    );
    const { ctx, logger } = makeCtx();
    await ctx.filters.decide("acme.gate", { allow: true }, {
      subject: "user-7",
    } as never);
    expect(seen).toEqual([{ subject: "user-7" }]);
    expect(logger.warn).not.toHaveBeenCalled();
    publishHookPoints(new Map());
  });

  it("exposes the event bus and the core version", () => {
    const { ctx } = makeCtx();
    expect(ctx.events).toBeInstanceOf(EventBus);
    expect(ctx.nextlyVersion).toBe(getCoreVersion());
  });

  describe("a plugin emitting an event", () => {
    const plugin = { name: "@acme/billing", version: "1.0.0" };

    it.each(["user.deleted", "user.created", "document.published", "auth.x"])(
      "cannot emit the core event %s",
      name => {
        // A listener acting on `user.deleted` — unlinking an identity,
        // dropping stored data — would act on a deletion that never happened.
        const { ctx } = makeCtx(plugin);
        const heard = vi.fn();
        ctx.events.on(name, heard);
        expect(() => ctx.events.emit(name, { userId: "live-user" })).toThrow(
          expect.objectContaining({ code: "FORBIDDEN" })
        );
        expect(heard).not.toHaveBeenCalled();
        ctx.events.off(name, heard);
      }
    );

    it("still emits an event of its own", () => {
      // The control: refusing every emit would pass the cases above.
      const { ctx } = makeCtx(plugin);
      const heard = vi.fn();
      ctx.events.on("billing.charged", heard);
      ctx.events.emit("billing.charged", { amount: 10 });
      expect(heard).toHaveBeenCalledOnce();
      ctx.events.off("billing.charged", heard);
    });
  });

  it("no longer exposes the deprecated infra alias", () => {
    const { ctx } = makeCtx();
    // @ts-expect-error infra was removed — db/logger are top-level.
    expect(ctx.infra).toBeUndefined();
  });

  it("keeps the services shape; collections is ServiceOpts-wrapped", () => {
    const { ctx, collections, email } = makeCtx();
    // D35: collections is wrapped for ServiceOpts elevation — a distinct Proxy
    // that delegates to the raw service, no longer the raw instance itself.
    expect(ctx.services.collections).not.toBe(collections);
    // The shape and the non-collection services are unchanged.
    expect(ctx.services.email).toBe(email);
    // Pinned as an exact list rather than a set of `toHaveProperty` checks:
    // this surface is public API, so a member ARRIVING is as much a change as
    // one going, and only an exhaustive comparison catches the first.
    expect(Object.keys(ctx.services).sort()).toEqual([
      "collections",
      "email",
      "jobs",
      "media",
      "plugins",
      "singles",
      "users",
      "versions",
    ]);
  });
});

/**
 * `ctx.db.transaction` on the restricted handle: without it a plugin had no
 * way to make several writes atomic.
 */
describe("ctx.db.transaction", () => {
  function contextOn(
    dialect: "postgresql" | "sqlite",
    capabilities: Record<string, unknown> = {}
  ) {
    const calls: string[] = [];
    const handle = (label: string) => ({
      select: () => calls.push(`${label}.select`),
      insert: () => calls.push(`${label}.insert`),
      update: () => calls.push(`${label}.update`),
      delete: () => calls.push(`${label}.delete`),
      execute: () => calls.push(`${label}.execute`),
    });
    const db = {
      ...handle("db"),
      transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        calls.push("db.transaction");
        return work(handle("tx"));
      },
    };
    const adapter = {
      transaction: async (work: () => Promise<unknown>) => {
        calls.push("adapter.transaction");
        return work();
      },
    };
    const services: Record<string, unknown> = {
      db,
      dialect,
      adapter,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      config: { plugins: [] },
    };
    const ctx = createPluginContext(
      ((name: string) => services[name] ?? {}) as never,
      {
        register: vi.fn(),
        unregister: vi.fn(),
        registerBeforeOperation: vi.fn(),
        unregisterBeforeOperation: vi.fn(),
      },
      { name: "@test/tx", version: "1.0.0", nextly: "*", capabilities } as never
    );
    return { ctx, calls };
  }

  it("runs the work in the database's transaction, on its handle", async () => {
    const { ctx, calls } = contextOn("postgresql");
    const result = await ctx.db.transaction(async tx => {
      tx.insert({});
      return "done";
    });
    expect(result).toBe("done");
    expect(calls).toEqual(["db.transaction", "tx.insert"]);
  });

  it("hands the work a restricted handle, without execute", async () => {
    const { ctx } = contextOn("postgresql");
    await ctx.db.transaction(async tx => {
      expect(Object.keys(tx).sort()).toEqual([
        "delete",
        "insert",
        "select",
        "update",
      ]);
    });
  });

  it("runs through the adapter's transaction on SQLite with rawSql too", async () => {
    // The live instance's own SQLite transaction refuses an async callback.
    const { ctx, calls } = contextOn("sqlite", { db: { rawSql: true } });
    await ctx.db.transaction(async tx => {
      tx.update({});
    });
    expect(calls).toEqual(["adapter.transaction", "db.update"]);
    // And the raw surface is still there.
    expect(typeof (ctx.db as unknown as { execute: unknown }).execute).toBe(
      "function"
    );
  });

  it("runs through the adapter's transaction on SQLite", async () => {
    // Drizzle's better-sqlite3 transaction refuses an async callback.
    const { ctx, calls } = contextOn("sqlite");
    await ctx.db.transaction(async tx => {
      tx.update({});
    });
    expect(calls).toEqual(["adapter.transaction", "db.update"]);
  });
});

describe("ctx.auth in a plugin's context", () => {
  it("holds completeLogin to that plugin's manifest", async () => {
    // The shared instance answered every plugin alike, so a plugin that
    // declared nothing could sign anyone in.
    const { ctx } = makeCtx({
      name: "@test/analytics",
      version: "1.0.0",
      nextly: "*",
    });
    await expect(
      ctx.auth.completeLogin("u1", {
        request: new Request("http://localhost/x"),
        strategy: "test-analytics:sso",
      })
    ).rejects.toMatchObject({
      logContext: expect.objectContaining({
        reason: "plugin-login-undeclared",
      }),
    });
  });
});
