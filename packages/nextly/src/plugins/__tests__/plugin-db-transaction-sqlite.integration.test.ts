/**
 * A plugin's transaction on the default (sqlite) boot, through both handles a
 * plugin holds: the typed `ctx.db` over its own tables, and the builder at
 * `ctx.db.raw`. The work commits as one unit and rolls back as one unit, and a
 * core write made inside it joins it as a savepoint.
 *
 * Drizzle's better-sqlite3 transaction refuses an async callback, so both
 * handles run the work through the adapter's BEGIN IMMEDIATE runner. That only
 * holds if the writes run on the connection the runner opened, which a fake
 * cannot show, so this writes through the context the runtime builds, into
 * real tables.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { col, defineTable } from "../../domains/schema/extension/dsl";
import { NextlyError } from "../../errors/nextly-error";
import { nextlyPluginSettings } from "../../schemas/plugin-settings/sqlite";
import type { UserService } from "../../services/users/user-service";
import type { DatabaseInstance } from "../../types/database-operations";
import {
  definePlugin,
  type PluginContext,
  type PluginDefinition,
  type PluginRawDatabase,
  type PluginSettingsApi,
  type PluginTransaction,
  type PluginUserService,
} from "../plugin-context";
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

/** The table the typed surface writes to: the plugin's own. */
const marks = defineTable("marks", { id: col.id(), key: col.shortText() });

/**
 * One of the two handles, reduced to what these tests do with it: open a
 * transaction in which `write` stores a key, and list the keys stored.
 */
interface Surface {
  transaction<T>(
    work: (write: (key: string) => Promise<void>) => Promise<T>
  ): Promise<T>;
  stored(): Promise<string[]>;
}

/** The typed `ctx.db`, writing to the plugin's own table. */
function typed(db: PluginContext["db"]): Surface {
  return {
    transaction: work =>
      db.transaction(tx => work(key => tx.insert(marks, { key }))),
    stored: async () =>
      (await db.select(marks).all()).map(stored => stored.key).sort(),
  };
}

/** `ctx.db.raw`, writing to a core table through the builder. */
function raw(db: PluginRawDatabase): Surface {
  return {
    transaction: work =>
      db.transaction(tx =>
        work(async key => {
          await tx.insert(nextlyPluginSettings).values(row(key));
        })
      ),
    stored: () => keysStored(db),
  };
}

async function keysStored(db: PluginRawDatabase): Promise<string[]> {
  const rows = (await db
    .select({ key: nextlyPluginSettings.key } as never)
    .from(nextlyPluginSettings)
    .where(eq(nextlyPluginSettings.owner, OWNER))) as Array<{ key: string }>;
  return rows.map(r => r.key).sort();
}

const SURFACES = [
  ["the typed ctx.db", (ctx: PluginContext) => typed(ctx.db)],
  ["ctx.db.raw", (ctx: PluginContext) => raw(ctx.db.raw)],
] as const;

/** The manifest of a plugin that declares raw SQL. */
const rawSqlManifest: Partial<PluginDefinition> = {
  capabilities: { db: { rawSql: true } },
};

/** Boot one plugin declaring `marks`, and return the context it received. */
async function bootPlugin(
  over: Partial<PluginDefinition> = {},
  rawSqlListed = false
): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name: "@test/tx",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { schema: { prefix: "txs", tables: [marks] } },
    ...over,
    init(ctx) {
      captured = ctx;
    },
  });
  current = await createTestNextly({
    plugins: [plugin],
    pluginConsent: { rawSql: rawSqlListed ? ["@test/tx"] : [] },
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

describe.each(SURFACES)("a transaction through %s on sqlite", (_, pick) => {
  it("commits every write the work made", async () => {
    const db = pick(await bootPlugin());

    await db.transaction(async write => {
      await write("a");
      await write("b");
    });

    expect(await db.stored()).toEqual(["a", "b"]);
  });

  it("rolls back every write when the work throws", async () => {
    const db = pick(await bootPlugin());

    await expect(
      db.transaction(async write => {
        await write("a");
        throw new Error("second step failed");
      })
    ).rejects.toThrow("second step failed");

    expect(await db.stored()).toEqual([]);
  });
});

describe("the typed ctx.db's transaction handle, kept past its callback, on sqlite", () => {
  // After the commit, the handle the work was given is bound to the shared
  // connection with no transaction open on it, so a write through it would
  // land on its own, outside the unit it was written for.
  it("refuses a later write and read through it, and writes nothing", async () => {
    const ctx = await bootPlugin();
    let kept: PluginTransaction | undefined;
    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      kept = tx;
    });
    if (!kept) throw new Error("the transaction's work did not run");

    const finished = (error: unknown) =>
      NextlyError.is(error) &&
      (error.logContext as { reason?: unknown } | undefined)?.reason ===
        "plugin-transaction-finished";
    await expect(kept.insert(marks, { key: "late" })).rejects.toSatisfy(
      finished
    );
    await expect(kept.select(marks).all()).rejects.toSatisfy(finished);
    expect(await typed(ctx.db).stored()).toEqual(["a"]);
  });

  it("finishes an insertReturning the callback started and did not await", async () => {
    // On SQLite a single statement runs synchronously when Drizzle's query is
    // first awaited, inside the call that made it, so it cannot outlive the
    // callback. `insertReturning` is two statements: its read-back reaches
    // the handle a tick after the insert, when the callback may already have
    // returned. Waiting for it before the commit is what lets it complete
    // inside the transaction rather than being refused after its insert.
    const ctx = await bootPlugin();
    let unawaited: Promise<{ key: string }> | undefined;
    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      unawaited = tx.insertReturning(marks, { key: "b" });
    });
    await expect(unawaited).resolves.toMatchObject({ key: "b" });
    expect(await typed(ctx.db).stored()).toEqual(["a", "b"]);
  });

  it("rolls back an insertReturning the callback started and did not await when it then throws", async () => {
    // The rollback counterpart of the case above. A single un-awaited insert
    // proves nothing here: better-sqlite3 runs it synchronously inside the
    // call, so it lands in the transaction whether or not anything waits for
    // it. The read-back is the step that comes later; not waiting, it is
    // refused after its insert. Both steps must land inside the transaction,
    // so the rollback takes the row and the call still resolves.
    const ctx = await bootPlugin();
    let unawaited: Promise<unknown> | undefined;
    await ctx.db
      .transaction(async tx => {
        unawaited = tx.insertReturning(marks, { key: "a" });
        unawaited.catch(() => undefined);
        throw new Error("later step failed");
      })
      .catch(() => undefined);

    await expect(unawaited).resolves.toMatchObject({ key: "a" });
    expect(await typed(ctx.db).stored()).toEqual([]);
  });
});

describe.each([
  ["the restricted ctx.db.raw", false],
  ["the rawSql ctx.db.raw", true],
] as const)(
  "a transaction handle kept past its callback, through %s on sqlite",
  (_, rawSql) => {
    // Kept, the handle reaches the shared connection with no transaction
    // open on it, so a statement through it would run outside the unit it
    // was written for. With rawSql the handle is the live instance itself,
    // which stays usable as `ctx.db.raw`; only the one the work received
    // refuses.
    const finished = (error: unknown) =>
      NextlyError.is(error) &&
      (error.logContext as { reason?: unknown } | undefined)?.reason ===
        "plugin-transaction-finished";
    const thrownBy = (run: () => unknown): unknown => {
      try {
        run();
      } catch (error) {
        return error;
      }
      return "did not throw";
    };

    it("refuses every entry method after a commit and after a rollback", async () => {
      const ctx = await bootPlugin(rawSql ? rawSqlManifest : {}, rawSql);
      const db = ctx.db.raw;
      let committed: DatabaseInstance | undefined;
      let rolledBack: DatabaseInstance | undefined;
      await db.transaction(async tx => {
        await tx.insert(nextlyPluginSettings).values(row("a"));
        committed = tx;
      });
      await db
        .transaction(async tx => {
          rolledBack = tx;
          throw new Error("roll back");
        })
        .catch(() => undefined);
      if (!committed || !rolledBack) {
        throw new Error("the transactions' work did not run");
      }

      for (const kept of [committed, rolledBack]) {
        expect(thrownBy(() => kept.insert(nextlyPluginSettings))).toSatisfy(
          finished
        );
        expect(
          thrownBy(() =>
            kept.select({ key: nextlyPluginSettings.key } as never)
          )
        ).toSatisfy(finished);
        expect(thrownBy(() => kept.update(nextlyPluginSettings))).toSatisfy(
          finished
        );
        expect(thrownBy(() => kept.delete(nextlyPluginSettings))).toSatisfy(
          finished
        );
      }
      // The handle the plugin holds outside any transaction still answers.
      expect(await keysStored(db)).toEqual(["a"]);
    });
  }
);

describe.each(SURFACES)(
  "a core write inside a transaction through %s on sqlite",
  (_, pick) => {
    async function bootWithSettings(): Promise<{
      db: Surface;
      settings: PluginSettingsApi;
    }> {
      const ctx = await bootPlugin({
        contributes: {
          schema: { prefix: "txs", tables: [marks] },
          settings: z.object({ port: z.number().default(443) }),
        },
      });
      return { db: pick(ctx), settings: ctx.settings as PluginSettingsApi };
    }

    it("completes instead of waiting on the transaction it is inside", async () => {
      // The settings store opens its own adapter transaction; queued behind
      // the plugin's, it hung both and every later write on the instance.
      const { db, settings } = await bootWithSettings();

      await db.transaction(async write => {
        await write("a");
        await settings.set({ port: 8443 });
      });

      expect(await db.stored()).toEqual(["a"]);
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
  }
);

describe.each(SURFACES)(
  "a core service inside a transaction through %s on sqlite",
  (_, pick) => {
    // A service's own transaction joins the plugin's as a savepoint rather
    // than opening a second one on the connection the plugin's already holds.
    async function bootWithUsers(): Promise<{
      db: Surface;
      users: PluginUserService;
    }> {
      const ctx = await bootPlugin();
      // An existing account, created by core: a plugin may not create an
      // install's first one.
      await (current!.getService("userService") as UserService).create(
        {
          email: "founder@example.com",
          name: "Founder",
          password: "Passw0rd!long",
        },
        {}
      );
      return { db: pick(ctx), users: ctx.services.users };
    }

    const EMAIL = "in-tx@example.com";
    const createUser = (users: PluginUserService) =>
      users.create(
        { email: EMAIL, name: "In Tx", password: "Passw0rd!long" },
        {}
      );

    it("commits with the transaction it ran inside", async () => {
      const { db, users } = await bootWithUsers();

      await db.transaction(async write => {
        await write("a");
        await createUser(users);
      });

      expect(await db.stored()).toEqual(["a"]);
      expect((await users.findByEmail(EMAIL, {}))?.email).toBe(EMAIL);
    });

    it("is rolled back with the transaction it ran inside", async () => {
      const { db, users } = await bootWithUsers();

      await expect(
        db.transaction(async write => {
          await write("a");
          await createUser(users);
          throw new Error("later step failed");
        })
      ).rejects.toThrow("later step failed");

      expect(await users.findByEmail(EMAIL, {})).toBeNull();
      expect(await db.stored()).toEqual([]);
    });
  }
);

describe("ctx.db.raw with rawSql on sqlite", () => {
  it("nests a transaction of the handle as a savepoint", async () => {
    // The handle with rawSql is the live instance; its own `transaction` on
    // SQLite is better-sqlite3's synchronous one, which refuses async work.
    const db = (await bootPlugin(rawSqlManifest, true)).db.raw;

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await (tx as PluginRawDatabase)
        .transaction(async inner => {
          await inner.insert(nextlyPluginSettings).values(row("b"));
          throw new Error("inner failed");
        })
        .catch(() => undefined);
      await (tx as PluginRawDatabase).transaction(async inner => {
        await inner.insert(nextlyPluginSettings).values(row("c"));
      });
    });

    expect(await keysStored(db)).toEqual(["a", "c"]);
  });
});

describe("the boot and a plugin that declares rawSql", () => {
  it("refuses an unlisted one, naming it and the line to add", async () => {
    const caught = await bootPlugin(rawSqlManifest, false).catch(
      (error: unknown) => error
    );

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).logMessage).toContain(
      'db: { rawSqlPlugins: ["@test/tx"] }'
    );
  });

  it("hands a listed one the live instance at ctx.db.raw", async () => {
    const ctx = await bootPlugin(rawSqlManifest, true);

    // `run` exists only on the live better-sqlite3 Drizzle instance.
    expect(typeof (ctx.db.raw as { run?: unknown }).run).toBe("function");
  });

  it("hands one that does not declare it the restricted builder", async () => {
    const ctx = await bootPlugin();

    expect((ctx.db.raw as { run?: unknown }).run).toBeUndefined();
  });

  it("does not let a setup transformer list a plugin it adds", async () => {
    // A `setup` transformer is plugin code. One that adds a rawSql plugin and
    // lists it in the config it returns has not had the app's consent, so the
    // re-resolution of the transformed list reads the app's grants, not those.
    const added = definePlugin({
      name: "@test/smuggled",
      version: "1.0.0",
      nextly: ">=0.0.0",
      ...rawSqlManifest,
    });
    const caught = await bootPlugin({
      setup: config => ({
        ...config,
        plugins: [...(config.plugins ?? []), added],
        pluginConsent: { rawSql: ["@test/smuggled"] },
      }),
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).logContext).toMatchObject({
      reason: "capability-not-listed",
      plugins: ["@test/smuggled"],
    });
  });

  it("gives one that does not declare it no live handle at ctx.config", async () => {
    // `ctx.config` was a copy of the whole service configuration, so a plugin
    // without rawSql could run any SQL through `ctx.config.adapter`.
    const ctx = await bootPlugin();
    const config = ctx.config as Record<string, unknown>;

    for (const live of [
      "adapter",
      "db",
      "pluginConsent",
      "storagePlugins",
      "imageProcessor",
      "logger",
      "hookRegistry",
      "passwordHasher",
      "rateLimit",
    ]) {
      expect(config, live).not.toHaveProperty(live);
    }
    // The plain values plugins read are still there.
    expect(ctx.config.plugins?.map(plugin => plugin.name)).toEqual([
      "@test/tx",
    ]);
    expect(Object.isFrozen(ctx.config)).toBe(true);
    expect(Object.isFrozen(ctx.config.plugins)).toBe(true);
  });

  it("does not let a setup transformer push itself onto the consent", async () => {
    // A transformer that pushes its own name onto whatever consent it can
    // reach, then declares rawSql on its own entry, must not boot with the
    // live instance.
    const caught = await bootPlugin({
      setup: config => {
        const reached = (config as { pluginConsent?: { rawSql: string[] } })
          .pluginConsent;
        reached?.rawSql.push("@test/tx");
        return {
          ...config,
          plugins: (config.plugins ?? []).map(entry =>
            entry.name === "@test/tx" ? { ...entry, ...rawSqlManifest } : entry
          ),
        };
      },
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).logContext).toMatchObject({
      reason: "capability-not-listed",
      plugins: ["@test/tx"],
    });
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
  ["the typed ctx.db", (ctx: PluginContext) => typed(ctx.db), false],
  ["the restricted ctx.db.raw", (ctx: PluginContext) => raw(ctx.db.raw), false],
  ["the rawSql ctx.db.raw", (ctx: PluginContext) => raw(ctx.db.raw), true],
] as const)(
  "an error thrown inside a transaction on sqlite, through %s",
  (_, pick, rawSql) => {
    it("reaches the plugin as the same instance, and rolls back", async () => {
      // Drizzle's transaction hands back what the work threw on PostgreSQL and
      // MySQL. The adapter's SQLite runner classified it into a generic
      // DatabaseError, so the plugin's `instanceof` and `status` were lost.
      const db = pick(await bootPlugin(rawSql ? rawSqlManifest : {}, rawSql));
      const refusal = new PluginRefusal("already linked");

      const caught = await db
        .transaction(async write => {
          await write("a");
          throw refusal;
        })
        .catch((error: unknown) => error);

      expect(caught).toBe(refusal);
      expect(await db.stored()).toEqual([]);
    });
  }
);
