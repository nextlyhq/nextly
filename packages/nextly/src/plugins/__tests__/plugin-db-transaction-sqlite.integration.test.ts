/**
 * `ctx.db.transaction` on the default (sqlite) boot: the work commits as one
 * unit and rolls back as one unit.
 *
 * Drizzle's better-sqlite3 transaction refuses an async callback, so the
 * restricted handle runs the work through the adapter's BEGIN IMMEDIATE
 * runner. That only holds if the builder writes on the connection the runner
 * opened, which a fake cannot show — so this writes through the context the
 * runtime builds, into a real table.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { nextlyPluginSettings } from "../../schemas/plugin-settings/sqlite";
import {
  definePlugin,
  type PluginDatabase,
  type PluginSettingsApi,
} from "../plugin-context";
import type { UserService } from "../../services/users/user-service";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "@test/tx-owner";

function row(key: string) {
  return {
    owner: OWNER,
    key,
    value: '"v"',
    isSecret: false,
    updatedAt: new Date(),
    updatedBy: null,
  };
}

async function bootWithDb(): Promise<PluginDatabase> {
  let db: PluginDatabase | undefined;
  const plugin = definePlugin({
    name: "@test/tx",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      db = ctx.db;
    },
  });
  current = await createTestNextly({ plugins: [plugin] });
  if (!db) throw new Error("the plugin's init did not run");
  return db;
}

async function keysStored(db: PluginDatabase): Promise<string[]> {
  const rows = (await db
    .select({ key: nextlyPluginSettings.key } as never)
    .from(nextlyPluginSettings)
    .where(eq(nextlyPluginSettings.owner, OWNER))) as Array<{ key: string }>;
  return rows.map(r => r.key).sort();
}

describe("ctx.db.transaction on sqlite", () => {
  it("commits every write the work made", async () => {
    const db = await bootWithDb();

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await tx.insert(nextlyPluginSettings).values(row("b"));
    });

    expect(await keysStored(db)).toEqual(["a", "b"]);
  });

  it("rolls back every write when the work throws", async () => {
    const db = await bootWithDb();

    await expect(
      db.transaction(async tx => {
        await tx.insert(nextlyPluginSettings).values(row("a"));
        throw new Error("second step failed");
      })
    ).rejects.toThrow("second step failed");

    expect(await keysStored(db)).toEqual([]);
  });
});

describe("a core write inside ctx.db.transaction on sqlite", () => {
  async function bootWithSettings(): Promise<{
    db: PluginDatabase;
    settings: PluginSettingsApi;
  }> {
    let captured:
      | { db: PluginDatabase; settings: PluginSettingsApi }
      | undefined;
    const plugin = definePlugin({
      name: "@test/tx-settings",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        settings: z.object({ port: z.number().default(443) }),
      },
      init(ctx) {
        captured = { db: ctx.db, settings: ctx.settings as PluginSettingsApi };
      },
    });
    current = await createTestNextly({ plugins: [plugin] });
    if (!captured) throw new Error("the plugin's init did not run");
    return captured;
  }

  it("completes instead of waiting on the transaction it is inside", async () => {
    // The settings store opens its own adapter transaction; queued behind
    // the plugin's, it hung both and every later write on the instance.
    const { db, settings } = await bootWithSettings();

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await settings.set({ port: 8443 });
    });

    expect(await keysStored(db)).toEqual(["a"]);
    expect((await settings.get()).port).toBe(8443);
  });

  it("is rolled back with the transaction it ran inside", async () => {
    const { db, settings } = await bootWithSettings();

    await expect(
      db.transaction(async () => {
        await settings.set({ port: 8443 });
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");

    expect((await settings.get()).port).toBe(443);
  });
});

describe("a core service inside ctx.db.transaction on sqlite", () => {
  // A service's own transaction joins the plugin's as a savepoint rather than
  // opening a second one on the connection the plugin's already holds.
  async function bootWithUsers(): Promise<{
    db: PluginDatabase;
    users: UserService;
  }> {
    let captured: { db: PluginDatabase; users: UserService } | undefined;
    const plugin = definePlugin({
      name: "@test/tx-users",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        captured = { db: ctx.db, users: ctx.services.users };
      },
    });
    current = await createTestNextly({ plugins: [plugin] });
    if (!captured) throw new Error("the plugin's init did not run");
    return captured;
  }

  const EMAIL = "in-tx@example.com";
  const createUser = (users: UserService) =>
    users.create(
      { email: EMAIL, name: "In Tx", password: "Passw0rd!long" },
      {}
    );

  it("commits with the transaction it ran inside", async () => {
    const { db, users } = await bootWithUsers();

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await createUser(users);
    });

    expect(await keysStored(db)).toEqual(["a"]);
    expect((await users.findByEmail(EMAIL, {}))?.email).toBe(EMAIL);
  });

  it("is rolled back with the transaction it ran inside", async () => {
    const { db, users } = await bootWithUsers();

    await expect(
      db.transaction(async () => {
        await createUser(users);
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");

    expect(await users.findByEmail(EMAIL, {})).toBeNull();
  });
});

async function bootWithRawSql(): Promise<PluginDatabase> {
  let db: PluginDatabase | undefined;
  const plugin = definePlugin({
    name: "@test/tx-raw",
    version: "1.0.0",
    nextly: ">=0.0.0",
    capabilities: { db: { rawSql: true } },
    init(ctx) {
      db = ctx.db;
    },
  });
  current = await createTestNextly({ plugins: [plugin] });
  if (!db) throw new Error("the plugin's init did not run");
  return db;
}

describe("ctx.db.transaction with rawSql on sqlite", () => {
  it("nests a transaction of the handle as a savepoint", async () => {
    // The handle with rawSql is the live instance; its own `transaction` on
    // SQLite is better-sqlite3's synchronous one, which refuses async work.
    const db = await bootWithRawSql();

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await (tx as PluginDatabase)
        .transaction(async inner => {
          await inner.insert(nextlyPluginSettings).values(row("b"));
          throw new Error("inner failed");
        })
        .catch(() => undefined);
      await (tx as PluginDatabase).transaction(async inner => {
        await inner.insert(nextlyPluginSettings).values(row("c"));
      });
    });

    expect(await keysStored(db)).toEqual(["a", "c"]);
  });
});

/**
 * A plugin's own error class, as a route might throw to answer with a status.
 * Not a `NextlyError`: the adapter lets those through already.
 */
class PluginRefusal extends Error {
  readonly status = 409;
}

describe.each([
  ["the restricted handle", bootWithDb],
  ["the rawSql handle", bootWithRawSql],
])(
  "an error thrown inside ctx.db.transaction on sqlite, through %s",
  (_, boot) => {
    it("reaches the plugin as the same instance, and rolls back", async () => {
      // Drizzle's transaction hands back what the work threw on PostgreSQL and
      // MySQL. The adapter's SQLite runner classified it into a generic
      // DatabaseError, so the plugin's `instanceof` and `status` were lost.
      const db = await boot();
      const refusal = new PluginRefusal("already linked");

      const caught = await db
        .transaction(async tx => {
          await tx.insert(nextlyPluginSettings).values(row("a"));
          throw refusal;
        })
        .catch((error: unknown) => error);

      expect(caught).toBe(refusal);
      expect(await keysStored(db)).toEqual([]);
    });
  }
);
