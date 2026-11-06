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

/** A grouped facade (`versions.pins`), as opposed to a method. */
function isGroup(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

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

/** No live handle is reachable under `path`. */
function expectNoLiveHandle(path: string, names: string[]): void {
  for (const live of LIVE) {
    expect({ path, live, present: names.includes(live) }).toEqual({
      path,
      live,
      present: false,
    });
  }
}

/**
 * A facade carries no live handle and exposes methods. A member that groups
 * methods (`versions.pins`) is judged a facade in its own right, by the same
 * two rules: a group is where a handle would hide if a service were handed
 * through whole, so it is walked rather than trusted for being an object.
 */
function expectFacade(path: string, facade: unknown): void {
  const names = reachable(facade);
  expectNoLiveHandle(path, names);
  for (const name of names) {
    const value = (facade as Record<string, unknown>)[name];
    if (isGroup(value)) {
      expectFacade(`${path}.${name}`, value);
      continue;
    }
    expect({ path, name, kind: typeof value }).toEqual({
      path,
      name,
      kind: "function",
    });
  }
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
    if (member === "plugins") {
      // The installed list, not a facade of methods: what it carries is data,
      // so only the handles rule applies to it.
      expectNoLiveHandle(member, reachable(service));
      continue;
    }
    expectFacade(member, service);
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
