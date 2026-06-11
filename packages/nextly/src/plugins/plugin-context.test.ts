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

  const hookRegistry = { register: vi.fn(), unregister: vi.fn() };
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
    // @ts-expect-error infra was removed in P1/T13 — db/logger are top-level.
    expect(ctx.infra).toBeUndefined();
  });

  it("leaves the services shape unchanged", () => {
    const { ctx, collections, email } = makeCtx();
    expect(ctx.services.collections).toBe(collections);
    expect(ctx.services.email).toBe(email);
  });
});
