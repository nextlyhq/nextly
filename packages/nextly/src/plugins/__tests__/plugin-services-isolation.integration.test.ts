/**
 * No member of `ctx.services` hands a plugin the database adapter.
 *
 * A core service is a class instance carrying the adapter, the Drizzle handle
 * and the sub-services its methods run on. `ctx.services.collections` was a
 * proxy that passed those properties through, and `media` and `email` were
 * the instances themselves, so `ctx.services.email.adapter.getDrizzle().run`
 * was raw SQL for a plugin the app never listed. Each member is now a facade
 * of the methods meant for plugins. Asserted on a real boot, over every
 * member the context exposes, so a member added later is covered too.
 *
 * SQLite only: which members a facade carries does not depend on the dialect.
 */
import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import type { PluginContext, PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** The live handles a service instance holds, by the names it holds them. */
const LIVE = ["adapter", "db", "getDrizzle", "tables", "logger", "repo"];

/** Every name reachable on `value`, own or inherited, short of `Object`. */
function reachable(value: unknown): string[] {
  const names = new Set<string>();
  for (
    let level: unknown = value;
    level !== null && level !== undefined && level !== Object.prototype;
    level = Object.getPrototypeOf(level)
  ) {
    for (const key of Reflect.ownKeys(level as object)) {
      if (typeof key === "string") names.add(key);
    }
  }
  return [...names];
}

it("hands out no service carrying the adapter or a Drizzle handle", async () => {
  let services: PluginContext["services"] | undefined;
  const plugin: PluginDefinition = {
    name: "@test/services",
    version: "1.0.0",
    nextly: ">=0.0.1",
    init: ctx => {
      services = ctx.services;
    },
  };

  handle = await createTestNextly({ plugins: [plugin] });

  const members = Object.keys(services ?? {});
  expect(members).toEqual(
    expect.arrayContaining(["collections", "users", "media", "email"])
  );
  for (const member of members) {
    const service = (services as Record<string, unknown>)[member];
    const names = reachable(service);
    for (const live of LIVE) {
      expect({ member, live, present: names.includes(live) }).toEqual({
        member,
        live,
        present: false,
      });
    }
    for (const name of names) {
      const value = (service as Record<string, unknown>)[name];
      expect({ member, name, kind: typeof value }).toEqual({
        member,
        name,
        kind: member === "plugins" ? typeof value : "function",
      });
    }
  }
});

it("hands a collection transaction's work a token without execute", async () => {
  let seen: unknown;
  let created: unknown;
  const posts = defineCollection({
    slug: "posts",
    fields: [text({ name: "title" })],
  });
  const plugin: PluginDefinition = {
    name: "@test/tx",
    version: "1.0.0",
    nextly: ">=0.0.1",
    init: async ctx => {
      const collections = ctx.services.collections;
      created = await collections.withTransaction(async tx => {
        seen = reachable(tx);
        return collections.createEntryInTransaction(
          tx,
          "posts",
          { title: "in a transaction" },
          {}
        );
      });
    },
  };

  handle = await createTestNextly({ plugins: [plugin], collections: [posts] });

  expect(seen).toEqual([]);
  expect(created).toMatchObject({ title: "in a transaction" });
});

it("refuses a transaction the plugin did not get from withTransaction", async () => {
  let refused: unknown;
  const plugin: PluginDefinition = {
    name: "@test/forged",
    version: "1.0.0",
    nextly: ">=0.0.1",
    init: async ctx => {
      refused = await ctx.services.collections
        .createEntryInTransaction({} as never, "posts", { title: "forged" }, {})
        .catch((error: unknown) => error);
    },
  };

  handle = await createTestNextly({ plugins: [plugin] });

  expect(refused).toMatchObject({
    code: "VALIDATION_ERROR",
    logContext: { reason: "plugin-transaction-token-unknown" },
  });
});
