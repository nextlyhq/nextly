/**
 * A core upgrade stopped part-way is finished by the next run, planned from
 * the core tables as the database then holds them (R-9, D12).
 *
 * The run's connection is dropped for real after the upgrade's first
 * statement: on PostgreSQL its backend is terminated, on MySQL its connection
 * killed, and on SQLite the database handle closed. Then a new connection runs
 * the same upgrade again. Nothing records how far the stopped run got, so this
 * is the same whatever stopped it (a kill, a lost connection, or the busy-table
 * wait giving up).
 *
 * On MySQL the first statement has committed when the run stops, so the
 * second run starts from a database part-way through. On PostgreSQL and
 * SQLite the upgrade runs in one transaction, so the stop leaves nothing. In
 * every case the second run ends with the core tables a fresh install has.
 *
 * The moment "after the first statement" is the schema-lock check the push
 * makes before each statement: the second check comes once the first
 * statement has run, and that is where the connection is dropped.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  createScratchDatabase,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import { getCoreTableNames } from "../../../schemas/core-schema";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";

import { reconcileCore } from "./core-reconcile";
import { resolveDataLossConsent } from "./data-loss-consent";

/** What runs when the push checks the lock before a statement; set per test. */
const beforeStatement = vi.hoisted(() => ({
  hook: undefined as undefined | (() => Promise<void>),
}));

vi.mock("../pipeline/schema-lock", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../pipeline/schema-lock")>();
  return {
    ...actual,
    assertSchemaLockHeld: async () => {
      await beforeStatement.hook?.();
      await actual.assertSchemaLockHeld();
    },
  };
});

const REGISTRY_TABLES = ["dynamic_collections", "dynamic_singles"] as const;
const ADDED_SINCE = ["webhooks", "revalidate"] as const;
const CONSENT = REGISTRY_TABLES.map(table => `${table}.access_rules`).join(",");

/** One connection to the database under test, which a test can drop. */
interface Connection {
  db: unknown;
  exec(statement: string): Promise<void>;
  /** Drop the connection for real, as a killed process or a lost network does. */
  drop(): Promise<void>;
  close(): Promise<void>;
}

/** A database of the test's own on `dialect`, reachable by new connections. */
async function withDatabase(
  dialect: SupportedDialect,
  body: (connect: () => Promise<Connection>) => Promise<void>
): Promise<void> {
  if (dialect === "sqlite") {
    const dir = mkdtempSync(join(tmpdir(), "nextly-core-stop-"));
    const { default: Database } = await import("better-sqlite3");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    try {
      await body(async () => {
        const sqlite = new Database(join(dir, "core.db"));
        const close = async () => {
          if (sqlite.open) sqlite.close();
        };
        return {
          db: drizzle({ client: sqlite }),
          exec: async statement => {
            sqlite.exec(statement);
          },
          drop: close,
          close,
        };
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return;
  }
  const scratch = await createScratchDatabase(dialect, "nextly_core_stop");
  try {
    if (dialect === "postgresql") {
      const { Pool, Client } = await import("pg");
      const { drizzle } = await import("drizzle-orm/node-postgres");
      await body(async () => {
        const pool = new Pool({ connectionString: scratch.url });
        // A terminated backend is reported on its client and the pool as well
        // as to the query it ends; the query's failure is what the test reads.
        pool.on("error", () => {});
        pool.on("connect", client => client.on("error", () => {}));
        return {
          db: drizzle({ client: pool }),
          exec: async statement => {
            await pool.query(statement);
          },
          drop: async () => {
            const admin = new Client({ connectionString: scratch.url });
            await admin.connect();
            try {
              await admin.query(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
              );
            } finally {
              await admin.end();
            }
          },
          close: () => pool.end().catch(() => {}),
        };
      });
      return;
    }
    const { createPool } = await import("mysql2");
    const { drizzle } = await import("drizzle-orm/mysql2");
    await body(async () => {
      const pool = createPool({ uri: scratch.url, connectionLimit: 2 });
      let closed = false;
      // A killed connection is reported on itself as well as to the query it
      // ends; the query's failure is what the test reads.
      pool.on("connection", connection => connection.on("error", () => {}));
      return {
        db: drizzle({ client: pool }),
        exec: async statement => {
          await pool.promise().query(statement);
        },
        drop: async () => {
          const admin = createPool({ uri: scratch.url, connectionLimit: 1 });
          try {
            const [rows] = (await admin
              .promise()
              .query(
                "SELECT ID FROM information_schema.PROCESSLIST WHERE DB = DATABASE() AND ID <> CONNECTION_ID()"
              )) as unknown as [Array<{ ID: number }>];
            for (const row of rows) {
              await admin
                .promise()
                .query(`KILL ${Number(row.ID)}`)
                .catch(() => {});
            }
          } finally {
            await new Promise<void>(res => admin.end(() => res()));
          }
          // A killed process opens no new connection; a pool would, and carry
          // the run on. Closed, its next statement fails as a dead process's
          // would never run.
          closed = true;
          pool.end(() => {});
        },
        close: () =>
          closed
            ? Promise.resolve()
            : new Promise<void>(res => {
                pool.end(() => res());
              }),
      };
    });
  } finally {
    await scratch.drop();
  }
}

/** Every core table's columns, sorted, as `db` holds them. */
async function coreColumnsOf(
  db: unknown,
  dialect: SupportedDialect
): Promise<Record<string, string[]>> {
  const live = await introspectLiveSnapshot(db, dialect, getCoreTableNames());
  return Object.fromEntries(
    live.tables
      .map(
        table => [table.name, table.columns.map(c => c.name).sort()] as const
      )
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

/** A fresh install's core tables on `dialect`. */
async function freshInstallColumns(
  dialect: SupportedDialect
): Promise<Record<string, string[]>> {
  let columns: Record<string, string[]> = {};
  await withFreshDatabase(dialect, "nextly_core_stop_ref", async fresh => {
    await buildCurrentCoreSchema(fresh);
    columns = await coreColumnsOf(fresh.db, dialect);
  });
  return columns;
}

/** The registry columns added since alpha.42 that `db` already has. */
async function addedSinceIn(
  db: unknown,
  dialect: SupportedDialect
): Promise<string[]> {
  const columns = await coreColumnsOf(db, dialect);
  return REGISTRY_TABLES.flatMap(table =>
    ADDED_SINCE.filter(column => columns[table]?.includes(column)).map(
      column => `${table}.${column}`
    )
  );
}

afterEach(() => {
  beforeStatement.hook = undefined;
});

describe.each(availableDialects())(
  "a core upgrade stopped after its first statement (%s)",
  dialect => {
    it("is finished by the next run, from the core tables as they stand", async () => {
      await withDatabase(dialect, async connect => {
        // An alpha.42 database: access_rules on both registries, without the
        // registry columns added since. The upgrade adds four columns, then
        // drops two.
        const setup = await connect();
        await buildCurrentCoreSchema({
          dialect,
          db: setup.db,
          exec: (statement: string) => setup.exec(statement),
        } as unknown as FreshDatabase);
        for (const table of REGISTRY_TABLES) {
          await setup.exec(`ALTER TABLE ${table} ADD COLUMN access_rules text`);
          for (const column of ADDED_SINCE) {
            await setup.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
          }
        }
        await setup.close();

        // The first run: its connection dropped once the first statement ran.
        const first = await connect();
        let checks = 0;
        beforeStatement.hook = async () => {
          checks += 1;
          if (checks === 2) await first.drop();
        };
        await expect(
          reconcileCore({
            db: first.db,
            dialect,
            consent: resolveDataLossConsent({ flag: CONSENT }),
          })
        ).rejects.toThrow();
        beforeStatement.hook = undefined;
        await first.close();
        expect(checks).toBeGreaterThanOrEqual(2);

        // Where it stopped: on MySQL the first statement committed; on
        // PostgreSQL and SQLite the transaction left nothing.
        const between = await connect();
        const added = await addedSinceIn(between.db, dialect);
        expect(added).toHaveLength(dialect === "mysql" ? 1 : 0);
        await between.close();

        // The next run, on a new connection, finishes it.
        const second = await connect();
        try {
          await reconcileCore({
            db: second.db,
            dialect,
            consent: resolveDataLossConsent({ flag: CONSENT }),
          });
          expect(await coreColumnsOf(second.db, dialect)).toEqual(
            await freshInstallColumns(dialect)
          );
        } finally {
          await second.close();
        }
      });
    });
  }
);
