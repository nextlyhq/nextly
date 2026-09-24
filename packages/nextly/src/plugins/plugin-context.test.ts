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
      case "relationalDb":
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
    // `ctx.db` is the typed, owner-checked surface; the raw handle it used
    // to BE is preserved at `.raw` as a RESTRICTED wrapper — a plugin that
    // did not declare `db.rawSql` gets only the fluent methods there, so
    // `execute` and `run` are not reachable however the plugin is written.
    expect(ctx.db.raw).toBeDefined();
    expect(typeof ctx.db.table).toBe("function");
    expect(
      (Object.keys(ctx.db) as string[]).filter(k => k !== "raw").sort()
    ).toEqual([
      "delete",
      "insert",
      "insertReturning",
      "query",
      "select",
      "table",
      "transaction",
      "update",
    ]);
    // The restriction applies to the escape hatch too: the raw handle a
    // plugin without rawSql receives carries only the fluent four.
    expect(Object.keys(ctx.db.raw as object).sort()).toEqual([
      "delete",
      "insert",
      "select",
      "update",
    ]);
    expect(ctx.logger).toBe(logger);
  });

  it("hands the live instance to a plugin that declared rawSql", () => {
    // The control: a wrapper applied unconditionally would make the declared
    // capability buy nothing. With rawSql declared, the raw escape hatch IS
    // the live instance the resolver handed over.
    const { ctx, db } = makeCtx({
      name: "@test/raw",
      version: "1.0.0",
      nextly: "*",
      capabilities: { db: { rawSql: true } },
    });
    expect(ctx.db.raw).toBe(db);
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

  it("exposes the event bus and the core version", () => {
    const { ctx } = makeCtx();
    expect(ctx.events).toBeInstanceOf(EventBus);
    expect(ctx.nextlyVersion).toBe(getCoreVersion());
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
