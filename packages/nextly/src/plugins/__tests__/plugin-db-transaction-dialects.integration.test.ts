/**
 * A plugin's transaction on every dialect, through the typed `ctx.db` and
 * through `ctx.db.raw`.
 *
 * The handle the work receives must be bound to the transaction's own
 * connection: on PostgreSQL and MySQL the pooled handle is a different
 * connection, so a write through it commits on its own and a later throw
 * leaves it behind, and a read through it cannot see the transaction's writes.
 * What the work throws must reach the plugin as the same instance, as
 * Drizzle's own transaction hands it back.
 */
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import { NextlyError } from "../../errors/nextly-error";
import type { DatabaseInstance } from "../../types/database-operations";
import type { PluginTransaction } from "../database/plugin-database";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Unique on `key`, so a test can make a statement fail in the database by
 * inserting a key twice: a failure the driver reports, which on PostgreSQL
 * also aborts the transaction it ran in.
 */
const marks = defineTable(
  "marks",
  { id: col.id(), key: col.shortText() },
  { indexes: [{ columns: ["key"], unique: true }] }
);

/** A collection for the `withTransaction` token to write to. */
const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title", maxLength: 20 })],
});

/**
 * Boot the plugin on `dialect`. `withPosts` adds the collection the
 * `withTransaction` token writes to; `rawSql` declares raw SQL and lists the
 * plugin for it, so `ctx.db.raw` is the live Drizzle instance.
 */
async function boot(
  dialect: TestDialect,
  { withPosts = false, rawSql = false } = {}
): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    ...(withPosts ? { collections: [posts] } : {}),
    pluginConsent: { rawSql: rawSql ? ["@test/tx-dialects"] : [] },
    plugins: [
      definePlugin({
        name: "@test/tx-dialects",
        version: "1.0.0",
        nextly: ">=0.0.0",
        ...(rawSql ? { capabilities: { db: { rawSql: true } } } : {}),
        contributes: { schema: { prefix: "txd", tables: [marks] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

/** The keys in the plugin's table, read through `ctx.db` outside any transaction. */
async function stored(ctx: PluginContext): Promise<string[]> {
  return (await ctx.db.select(marks).all()).map(row => row.key).sort();
}

/**
 * A plugin's own error class, as a route might throw to answer with a status.
 * Not a `NextlyError`, which the adapters already let through.
 */
class PluginRefusal extends Error {
  readonly status = 409;
}

/** The refusal a transaction's handle answers with once it has finished. */
function isFinished(error: unknown): boolean {
  return (
    NextlyError.is(error) &&
    (error.logContext as { reason?: unknown } | undefined)?.reason ===
      "plugin-transaction-finished"
  );
}

/** What `run` threw, or a marker `isFinished` rejects if it did not throw. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return "did not throw";
}

describeEachDialect("the typed ctx.db.transaction", dialect => {
  it("commits every write, and rolls every write back on a throw", async () => {
    const ctx = await boot(dialect);

    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      await tx.insert(marks, { key: "b" });
    });
    await ctx.db
      .transaction(async tx => {
        await tx.insert(marks, { key: "c" });
        throw new Error("later step failed");
      })
      .catch(() => undefined);

    expect(await stored(ctx)).toEqual(["a", "b"]);
  });

  it("hands the work a handle on the transaction's own connection", async () => {
    const ctx = await boot(dialect);
    let inside: string[] = [];
    let outside: string[] = [];

    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      inside = (await tx.select(marks).all()).map(row => row.key);
      // SQLite has one connection, which the transaction holds, so a read
      // through the outer handle would run inside it and wait for nothing.
      if (dialect !== "sqlite") outside = await stored(ctx);
    });

    expect(inside).toEqual(["a"]);
    // Another connection does not see an uncommitted write.
    expect(outside).toEqual([]);
    expect(await stored(ctx)).toEqual(["a"]);
  });

  it("hands the plugin what the work threw, as the same instance", async () => {
    const ctx = await boot(dialect);
    const refusal = new PluginRefusal("already linked");

    const caught = await ctx.db
      .transaction(async tx => {
        await tx.insert(marks, { key: "a" });
        throw refusal;
      })
      .catch((error: unknown) => error);

    expect(caught).toBe(refusal);
    expect(await stored(ctx)).toEqual([]);
  });

  it("refuses a tx kept past a commit and past a rollback, writing nothing", async () => {
    // Kept, the handle is bound to a connection the transaction no longer
    // owns: on PostgreSQL and MySQL a client back in the pool, which would
    // run the write on its own, or inside another request's transaction.
    const ctx = await boot(dialect);
    let committed: PluginTransaction | undefined;
    let rolledBack: PluginTransaction | undefined;
    await ctx.db.transaction(async tx => {
      await tx.insert(marks, { key: "a" });
      committed = tx;
    });
    await ctx.db
      .transaction(async tx => {
        rolledBack = tx;
        throw new Error("roll back");
      })
      .catch(() => undefined);
    if (!committed || !rolledBack) {
      throw new Error("the transactions' work did not run");
    }

    for (const kept of [committed, rolledBack]) {
      await expect(kept.insert(marks, { key: "late" })).rejects.toSatisfy(
        isFinished
      );
      await expect(kept.select(marks).all()).rejects.toSatisfy(isFinished);
    }
    expect(await stored(ctx)).toEqual(["a"]);
  });

  it("rolls back writes the work started and did not await when the work then throws", async () => {
    // Two kinds of un-awaited write. A single insert enters the driver's
    // queue on this connection before the adapter's ROLLBACK does, so the
    // rollback takes it on its own merits; asserted so that stays true.
    // `insertReturning` is two statements, and its read-back reaches the
    // handle a tick after its insert lands, when the callback has already
    // thrown: only the drain lets that step run inside the transaction. Not
    // waiting, the step is refused after its insert; with no scope at all it
    // reads on a connection the transaction has given up.
    const ctx = await boot(dialect);
    let returning: Promise<unknown> | undefined;

    await ctx.db
      .transaction(async tx => {
        void tx.insert(marks, { key: "a" });
        returning = tx.insertReturning(marks, { key: "b" });
        returning.catch(() => undefined);
        throw new Error("later step failed");
      })
      .catch(() => undefined);

    await expect(returning).resolves.toMatchObject({ key: "b" });
    expect(await stored(ctx)).toEqual([]);
  });

  it("rejects, and stores nothing, when an insert the work did not await fails", async () => {
    // The callback resolves, so only the failed statement can say the
    // transaction must not commit. On PostgreSQL that statement aborts the
    // transaction, and a COMMIT then rolls back while reporting success; on
    // SQLite and MySQL it would commit `a` without the failed insert.
    const ctx = await boot(dialect);
    let duplicate: Promise<unknown> | undefined;

    const outcome = await ctx.db
      .transaction(async tx => {
        await tx.insert(marks, { key: "a" });
        duplicate = tx.insert(marks, { key: "a" });
        // Held, not awaited, by the work; handled here so the run does not
        // report it as unhandled.
        duplicate.catch(() => undefined);
      })
      .then(
        () => "resolved",
        (error: unknown) => error
      );

    const violation = await (duplicate ?? Promise.resolve()).then(
      () => "the duplicate insert succeeded",
      (error: unknown) => error
    );
    expect(violation).toBeInstanceOf(Error);
    expect(outcome).toBe(violation);
    expect(await stored(ctx)).toEqual([]);
  });

  // The control for the case above: an insert the work awaited and caught
  // settled while the work ran, so the work decides, and carrying on commits
  // the rest. Not on PostgreSQL, where that is not true of the database: a
  // failed statement aborts the transaction, so the next write fails too and
  // nothing can commit. The PostgreSQL control is the service refusal in the
  // `withTransaction` suite below, which never reaches the database.
  it.skipIf(dialect === "postgresql")(
    "commits past a failed insert the work awaited and caught",
    async () => {
      const ctx = await boot(dialect);

      await ctx.db.transaction(async tx => {
        await tx.insert(marks, { key: "a" });
        await tx.insert(marks, { key: "a" }).catch(() => undefined);
        await tx.insert(marks, { key: "b" });
      });

      expect(await stored(ctx)).toEqual(["a", "b"]);
    }
  );
});

describeEachDialect("ctx.services.collections.withTransaction", dialect => {
  it("refuses a token kept past the transaction, writing nothing", async () => {
    const ctx = await boot(dialect, { withPosts: true });
    const collections = ctx.services.collections;
    let kept:
      | Parameters<Parameters<typeof collections.withTransaction>[0]>[0]
      | undefined;

    await collections.withTransaction(async tx => {
      kept = tx;
      await collections.createEntryInTransaction(
        tx,
        "posts",
        { title: "inside" },
        {}
      );
    });
    if (!kept) throw new Error("the transaction's work did not run");

    const refused = await collections
      .createEntryInTransaction(kept, "posts", { title: "late" }, {})
      .catch((error: unknown) => error);

    expect(refused).toSatisfy(isFinished);
    expect(await collections.count("posts", {}, { as: "system" })).toBe(1);
  });

  it("commits past a validation refusal the work awaited and caught", async () => {
    // The refusal settled while the work ran, so it is the work's to handle;
    // caught, the transaction commits the other write. A validation error
    // never reaches the database, so this holds on PostgreSQL as well.
    const ctx = await boot(dialect, { withPosts: true });
    const collections = ctx.services.collections;
    let refusal: unknown;

    await collections.withTransaction(async tx => {
      refusal = await collections
        .createEntryInTransaction(
          tx,
          "posts",
          { title: "longer than the twenty characters allowed" },
          {}
        )
        .catch((error: unknown) => error);
      await collections.createEntryInTransaction(
        tx,
        "posts",
        { title: "kept" },
        {}
      );
    });

    expect(refusal).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await collections.count("posts", {}, { as: "system" })).toBe(1);
  });
});

describeEachDialect("ctx.db.raw.transaction", dialect => {
  it("hands the work a handle on the transaction's own connection", async () => {
    const ctx = await boot(dialect);
    // The Drizzle table behind the plugin's own, as `ctx.db` resolves it.
    const columns = ctx.db.table(marks);
    let inside = 0;

    await ctx.db.raw
      .transaction(async tx => {
        await tx.insert(columns).values({ id: "01", key: "a" });
        inside = (
          await tx
            .select({ key: columns.key } as never)
            .from(columns)
            .where(eq(columns.key, "a"))
        ).length;
        throw new Error("roll back");
      })
      .catch(() => undefined);

    expect(inside).toBe(1);
    expect(await stored(ctx)).toEqual([]);
  });

  it("hands the plugin what the work threw, as the same instance", async () => {
    const ctx = await boot(dialect);
    const refusal = new PluginRefusal("already linked");

    const caught = await ctx.db.raw
      .transaction(() => Promise.reject(refusal))
      .catch((error: unknown) => error);

    expect(caught).toBe(refusal);
  });

  // Restricted, the handle is the fluent builder over the transaction's
  // connection; with rawSql it is Drizzle's own transaction handle, which
  // reaches `execute` as well. Either way, kept past the callback it is
  // bound to a connection the transaction no longer owns.
  it.each([
    ["the restricted handle", false],
    ["the rawSql handle", true],
  ] as const)(
    "refuses every entry method of %s kept past a commit and past a rollback",
    async (_, rawSql) => {
      const ctx = await boot(dialect, { rawSql });
      const columns = ctx.db.table(marks);
      let committed: DatabaseInstance | undefined;
      let rolledBack: DatabaseInstance | undefined;
      await ctx.db.raw.transaction(async tx => {
        await tx.insert(columns).values({ id: "01", key: "a" });
        committed = tx;
      });
      await ctx.db.raw
        .transaction(async tx => {
          rolledBack = tx;
          throw new Error("roll back");
        })
        .catch(() => undefined);
      if (!committed || !rolledBack) {
        throw new Error("the transactions' work did not run");
      }

      for (const kept of [committed, rolledBack]) {
        expect(thrownBy(() => kept.insert(columns))).toSatisfy(isFinished);
        expect(
          thrownBy(() => kept.select({ key: columns.key } as never))
        ).toSatisfy(isFinished);
        expect(thrownBy(() => kept.update(columns))).toSatisfy(isFinished);
        expect(thrownBy(() => kept.delete(columns))).toSatisfy(isFinished);
        if (rawSql) {
          // The raw-SQL entry point, by the name each driver gives it.
          const rawEntry = dialect === "sqlite" ? "run" : "execute";
          expect(
            thrownBy(
              () => (kept as unknown as Record<string, unknown>)[rawEntry]
            )
          ).toSatisfy(isFinished);
        }
      }
      expect(await stored(ctx)).toEqual(["a"]);
      // The handle the plugin holds outside any transaction still answers.
      expect(typeof ctx.db.raw.insert).toBe("function");
    }
  );
});
