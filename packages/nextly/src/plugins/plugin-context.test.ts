import { describe, expect, it, vi } from "vitest";

import { EventBus } from "../events/event-bus";

import { getCoreVersion } from "./core-version";
import { createPluginContext } from "./plugin-context";

function makeCtx() {
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
  const ctx = createPluginContext(getServiceFn, hookRegistry);
  return { ctx, db, logger, collections, email };
}

describe("createPluginContext (P1 reshape)", () => {
  it("exposes db and logger at the top level", () => {
    const { ctx, db, logger } = makeCtx();
    expect(ctx.db).toBe(db);
    expect(ctx.logger).toBe(logger);
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
