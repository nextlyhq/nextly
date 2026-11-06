/**
 * A transaction opened inside another joins it, on every dialect and through
 * every way core and a plugin open one.
 *
 * Each way is opened inside an outer `adapter.transaction`. Joined, it runs
 * on the outer transaction's connection: it sees what the outer wrote and has
 * not committed, it can write a row the outer holds locked, and what it writes
 * is undone when the outer rolls back. On a connection of its own it would
 * see none of that: it would wait on the outer's lock while the outer waits
 * for it, and its writes would commit whatever the outer then did. The wait is
 * bounded, so such a run fails rather than hangs.
 *
 * Where the way's handle can run a statement of its own, the database session
 * each side ran on is compared too: `pg_backend_pid()` on PostgreSQL,
 * `CONNECTION_ID()` on MySQL. SQLite has one connection, so there it is the
 * lock, the visibility and the rollback that are checked.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { eq, getTableName, sql, type SQL, type Table } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type {
  PluginTransaction,
  TableColumns,
} from "../../../plugins/database/plugin-database";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { DatabaseInstance } from "../../../types/database-operations";
import { BaseService } from "../../base-service";
import { consoleLogger } from "../../types";

const PLUGIN = "@test/transaction-scope";

/** The plugin's table: one seeded row the outer transaction locks. */
const marks = defineTable("marks", {
  id: col.id(),
  label: col.shortText(),
});

/** A collection for the ways that write through core's entry services. */
const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title" })],
});

/** The seeded row's id, a fixed literal the statements below inline. */
const SEED = "seed";

/** A core service, for the transaction its `withTransaction` opens. */
class ServiceTransaction extends BaseService {
  run<T>(work: (tx: DatabaseInstance) => Promise<T>): Promise<T> {
    return this.withTransaction(tx => work(tx as DatabaseInstance));
  }
}

/** Drizzle's own nested transaction, on a handle core's service passes. */
interface DrizzleNesting {
  transaction<T>(work: (tx: DatabaseInstance) => Promise<T>): Promise<T>;
}

/** Everything a test reaches the database through. */
interface Booted {
  handle: TestNextly;
  ctx: PluginContext;
  service: ServiceTransaction;
  /** The plugin table's Drizzle table, as `ctx.db.table` resolves it. */
  columns: TableColumns<typeof marks>;
  /** The plugin table's name in the database. */
  table: string;
}

/** What a joined part does, through whichever handle its way passes it. */
interface Probe {
  /** The session the handle's statements run on; null where it cannot say. */
  session(): Promise<number | null>;
  /** The seeded row's label, as this handle sees it. */
  read(): Promise<string | undefined>;
  /** Write the seeded row, which the outer transaction may hold locked. */
  claim(): Promise<void>;
}

/** A way of opening a transaction, handing its work a probe on its handle. */
type Way = (t: Booted, work: (probe: Probe) => Promise<void>) => Promise<void>;

/** Rejects once `seconds` pass, so a part waiting on the outer's lock fails the test instead of hanging it. */
class WaitedOnTheOuter extends Error {}

function within<T>(seconds: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new WaitedOnTheOuter(
            `The inner transaction waited ${String(seconds)} s on the outer's lock: it ran on another connection.`
          )
        ),
      seconds * 1000
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The statement that names the session it runs on. Fixed text. */
function sessionSql(dialect: TestDialect): string | null {
  if (dialect === "postgresql") return "SELECT pg_backend_pid() AS id";
  if (dialect === "mysql") return "SELECT CONNECTION_ID() AS id";
  return null;
}

/** Runs a statement through a Drizzle handle, in each driver's own shape. */
async function onDrizzle(
  dialect: TestDialect,
  tx: DatabaseInstance,
  statement: SQL
): Promise<Array<{ id: number | string }>> {
  if (dialect === "postgresql") {
    const result = await (
      tx as unknown as {
        execute(q: SQL): Promise<{ rows: Array<{ id: number | string }> }>;
      }
    ).execute(statement);
    return result.rows;
  }
  const [rows] = await (
    tx as unknown as { execute(q: SQL): Promise<[unknown, unknown]> }
  ).execute(statement);
  return Array.isArray(rows) ? (rows as Array<{ id: number | string }>) : [];
}

/** A probe on the adapter's transaction context: statements by text. */
function fromContext(
  dialect: TestDialect,
  t: Booted,
  ctx: TransactionContext
): Probe {
  return {
    async session() {
      const statement = sessionSql(dialect);
      if (statement === null) return null;
      const [row] = await ctx.execute<{ id: number | string }>(statement);
      return Number(row.id);
    },
    async read() {
      const [row] = await ctx.execute<{ label: string }>(
        `SELECT label FROM ${t.table} WHERE id = '${SEED}'`
      );
      return row?.label;
    },
    async claim() {
      await ctx.execute(
        `UPDATE ${t.table} SET label = 'inner' WHERE id = '${SEED}'`
      );
    },
  };
}

/** A probe on a Drizzle handle: the fluent builder, and raw SQL for the session. */
function fromDrizzle(
  dialect: TestDialect,
  t: Booted,
  tx: DatabaseInstance
): Probe {
  const columns = t.columns;
  return {
    async session() {
      const statement = sessionSql(dialect);
      if (statement === null) return null;
      const [row] = await onDrizzle(dialect, tx, sql.raw(statement));
      return Number(row.id);
    },
    async read() {
      const rows = (await tx
        .select({ label: columns.label } as never)
        .from(columns)
        .where(eq(columns.id, SEED))) as unknown as Array<{ label: string }>;
      return rows[0]?.label;
    },
    async claim() {
      await tx
        .update(columns)
        .set({ label: "inner" } as never)
        .where(eq(columns.id, SEED));
    },
  };
}

/** A probe on the typed surface `ctx.db.transaction` passes, which runs no raw SQL. */
function fromPlugin(t: Booted, tx: PluginTransaction): Probe {
  return {
    session: () => Promise.resolve(null),
    async read() {
      const row = await tx.select(marks).where(eq(t.columns.id, SEED)).first();
      return row?.label;
    },
    async claim() {
      await tx.update(marks, { label: "inner" }).where(eq(t.columns.id, SEED));
    },
  };
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<Booted> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    collections: [posts],
    // Raw SQL, so `ctx.db.raw` is the live Drizzle instance and its
    // transaction's handle can name its session.
    pluginConsent: { rawSql: [PLUGIN] },
    plugins: [
      definePlugin({
        name: PLUGIN,
        version: "1.0.0",
        nextly: ">=0.0.0",
        capabilities: { db: { rawSql: true } },
        contributes: { schema: { prefix: "tscope", tables: [marks] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  const columns = captured.db.table(marks);
  await captured.db.raw.insert(columns).values({ id: SEED, label: SEED });
  return {
    handle: current,
    ctx: captured,
    service: new ServiceTransaction(current.adapter, consoleLogger),
    columns,
    table: getTableName(columns as unknown as Table),
  };
}

/** The seeded row's label, read outside any transaction once it has ended. */
async function labelNow(t: Booted): Promise<string | undefined> {
  const [row] = await t.handle.adapter.executeQuery<{ label: string }>(
    `SELECT label FROM ${t.table} WHERE id = '${SEED}'`
  );
  return row?.label;
}

/** How many posts exist, read outside any transaction. */
async function postCount(t: Booted): Promise<number> {
  return (await t.handle.nextly.find({ collection: "posts", limit: 10 })).items
    .length;
}

describeEachDialect("a transaction opened inside another joins it", dialect => {
  /**
   * The ways whose work gets a handle it can run statements on, and whether
   * that handle can name its session. Drizzle's own `tx.transaction` is left
   * out on SQLite: better-sqlite3's transaction refuses an async callback,
   * and core never opens one that way there.
   */
  const HANDLE_WAYS: Array<[string, Way, boolean]> = [
    [
      "adapter.transaction",
      (t, work) =>
        t.handle.adapter.transaction(ctx => work(fromContext(dialect, t, ctx))),
      true,
    ],
    [
      "a core service's withTransaction",
      (t, work) => t.service.run(tx => work(fromDrizzle(dialect, t, tx))),
      true,
    ],
    [
      "ctx.db.transaction",
      (t, work) => t.ctx.db.transaction(tx => work(fromPlugin(t, tx))),
      false,
    ],
    [
      "ctx.db.raw.transaction",
      (t, work) =>
        t.ctx.db.raw.transaction(tx => work(fromDrizzle(dialect, t, tx))),
      true,
    ],
    ...(dialect === "sqlite"
      ? []
      : ([
          [
            "Drizzle's own tx.transaction inside a core service's",
            (t, work) =>
              t.service.run(tx =>
                (tx as unknown as DrizzleNesting).transaction(inner =>
                  work(fromDrizzle(dialect, t, inner))
                )
              ),
            true,
          ],
        ] satisfies Array<[string, Way, boolean]>)),
  ];

  it.each(HANDLE_WAYS)(
    "%s runs on the outer transaction's connection",
    async (_, way, namesSession) => {
      const t = await boot(dialect);
      const seen: {
        outer: number | null;
        inner: number | null;
        read?: string;
      } = { outer: null, inner: null };
      let inner: Promise<void> | undefined;

      const outcome = await t.handle.adapter
        .transaction(async ctx => {
          const outer = fromContext(dialect, t, ctx);
          seen.outer = await outer.session();
          // Written and so locked by the outer, and not yet committed.
          await ctx.execute(
            `UPDATE ${t.table} SET label = 'held' WHERE id = '${SEED}'`
          );
          inner = way(t, async probe => {
            seen.inner = await probe.session();
            seen.read = await probe.read();
            await probe.claim();
          });
          await within(3, inner);
        })
        .then(
          () => "committed",
          (error: unknown) => error
        );
      // A part that ran on another connection is still waiting for the lock
      // the outer held until it rolled back; let it finish before teardown.
      await inner?.catch(() => undefined);

      expect(outcome).toBe("committed");
      // It saw the outer's uncommitted write, so it ran inside it.
      expect(seen.read).toBe("held");
      if (namesSession && dialect !== "sqlite") {
        expect(seen.outer).not.toBeNull();
        expect(seen.inner).toBe(seen.outer);
      }
      expect(await labelNow(t)).toBe("inner");
    }
  );

  /** A write made through one way, and how to tell it was kept. */
  const EVERY_WAY: Array<
    [string, (t: Booted) => Promise<unknown>, (t: Booted) => Promise<boolean>]
  > = [
    ...HANDLE_WAYS.map(
      ([name, way]) =>
        [
          name,
          (t: Booted) => way(t, probe => probe.claim()),
          async (t: Booted) => (await labelNow(t)) === "inner",
        ] as [
          string,
          (t: Booted) => Promise<unknown>,
          (t: Booted) => Promise<boolean>,
        ]
    ),
    [
      "ctx.services.collections.withTransaction",
      t => {
        const collections = t.ctx.services.collections;
        return collections.withTransaction(tx =>
          collections.createEntryInTransaction(
            tx,
            "posts",
            { title: "inner" },
            {}
          )
        );
      },
      async t => (await postCount(t)) > 0,
    ],
    [
      "a Direct API create inside ctx.db.transaction",
      t =>
        t.ctx.db.transaction(() =>
          t.handle.nextly.create({
            collection: "posts",
            data: { title: "inner" },
          })
        ),
      async t => (await postCount(t)) > 0,
    ],
  ];

  it.each(EVERY_WAY)(
    "%s rolls back with the outer transaction",
    async (_, write, kept) => {
      const t = await boot(dialect);

      const rolledBack = await t.handle.adapter
        .transaction(async () => {
          await write(t);
          throw new Error("a later step of the outer transaction failed");
        })
        .then(
          () => false,
          () => true
        );

      expect(rolledBack).toBe(true);
      expect(await kept(t)).toBe(false);

      // The control: inside an outer transaction that commits, the same write
      // is kept, so its absence above is the rollback's doing.
      await t.handle.adapter.transaction(async () => {
        await write(t);
      });
      expect(await kept(t)).toBe(true);
    }
  );
});
