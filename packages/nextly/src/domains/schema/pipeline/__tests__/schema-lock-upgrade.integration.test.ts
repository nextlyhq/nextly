/**
 * The schema lock beside the two locks an earlier Nextly version takes, during an upgrade.
 *
 * An earlier version knows only its own lock: `nextly_migrate_lock` (on MySQL, a named
 * `GET_LOCK`) for `nextly migrate` and its family, and `nextly_field_group_lock` for `db:sync`,
 * the development push and the Builder saves. While old and new processes share a database:
 *
 * - a run of this version treats either earlier lock as held until it lapses or is released;
 * - while a run of this version holds the lock, each earlier lock reads as held to an earlier
 *   process, which then waits or refuses exactly as that version does.
 *
 * The earlier version's lock rows are written here as that version writes them, and its acquire is
 * the statement that version runs: `INSERT … ON CONFLICT … WHERE expires_at < now()` for the
 * migrate lock, and the field-group session's own claim, which is unchanged code an earlier
 * `db:sync` runs.
 */
import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  getMigrationLockDdl,
  withMigrationSession,
} from "../../../field-groups/migration/session";
import { getEarlierMigrateLockDdl, withSchemaLock } from "../schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "./helpers/schema-lock-world";

const PREFIX = `slu_${randomBytes(4).toString("hex")}`;
const MINE = `${PREFIX}_mine`;
const EARLIER = `${PREFIX}_earlier`;

describe.each(LOCK_DIALECTS)(
  "the schema lock during an upgrade, on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;

    beforeEach(async () => {
      world = await lockWorld(dialect);
      adapter = await world.connect();
      await world.reset(adapter, [MINE, EARLIER]);
    });

    afterEach(async () => {
      await world.reset(adapter, [MINE, EARLIER]);
      await adapter.disconnect();
      await world.dispose();
    });

    /** This version's run, refused at once on a held lock. */
    function myRun() {
      return withSchemaLock(
        { adapter, command: "nextly migrate", whenHeld: "refuse" },
        async () => {
          await adapter.executeQuery(`CREATE TABLE ${MINE} (id integer)`);
          return "ran";
        }
      );
    }

    async function exists(table: string): Promise<boolean> {
      return (await adapter.listTables()).includes(table);
    }

    /** The earlier field-group lock's row, held as an earlier process holds it. */
    async function holdEarlierFieldGroupLock(
      expires: "live" | "none" | "lapsed"
    ) {
      for (const statement of getMigrationLockDdl(dialect)) {
        await adapter.executeQuery(statement);
      }
      const expiry =
        expires === "none"
          ? sql`NULL`
          : dialect === "sqlite"
            ? sql`unixepoch() + ${expires === "live" ? 600 : -600}`
            : dialect === "mysql"
              ? sql`DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${expires === "live" ? 600 : -600} SECOND)`
              : sql`clock_timestamp() + make_interval(secs => ${expires === "live" ? 600 : -600})`;
      await adapter.transaction(async ctx => {
        await ctx.runStatement(
          sql`INSERT INTO ${sql.identifier("nextly_field_group_lock")} (id, owner, expires_at)
            VALUES (1, ${"db:sync#earlier-version"}, ${expiry})`
        );
      });
    }

    it.each(["live", "none"] as const)(
      "treats an earlier field-group lock (expiry: %s) as held, and changes nothing",
      async expiry => {
        await holdEarlierFieldGroupLock(expiry);

        await expect(myRun()).rejects.toMatchObject({
          code: "NEXTLY_MIGRATE_LOCK_BUSY",
          logContext: { holder: { kind: "earlier-field-group-lock" } },
        });
        expect(await exists(MINE)).toBe(false);
      },
      60_000
    );

    it("proceeds once an earlier field-group lock has lapsed", async () => {
      await holdEarlierFieldGroupLock("lapsed");

      await expect(myRun()).resolves.toEqual({ ran: true, value: "ran" });
    }, 60_000);

    it("makes the field-group lock read as held to an earlier db:sync while a run holds the lock", async () => {
      let earlierRan = false;
      const outcome = await withSchemaLock(
        { adapter, command: "nextly migrate", whenHeld: "refuse" },
        async () => {
          await adapter.executeQuery(`CREATE TABLE ${MINE} (id integer)`);
          // An earlier `db:sync` takes the field-group lock with this session, and refuses.
          await expect(
            withMigrationSession(
              { adapter, dialect, label: "db:sync" },
              async () => {
                earlierRan = true;
                await adapter.executeQuery(
                  `CREATE TABLE ${EARLIER} (id integer)`
                );
              }
            )
          ).rejects.toMatchObject({
            logContext: { reason: "migration lock is held elsewhere" },
          });
          return "ran";
        }
      );

      expect(outcome).toEqual({ ran: true, value: "ran" });
      expect(earlierRan).toBe(false);
      expect(await exists(MINE)).toBe(true);
      expect(await exists(EARLIER)).toBe(false);
    }, 60_000);

    if (dialect === "postgresql") {
      /** The earlier version's acquire, verbatim: it succeeds only on an absent or lapsed row. */
      async function earlierMigrateAcquires(): Promise<boolean> {
        for (const statement of getEarlierMigrateLockDdl("postgresql")) {
          await adapter.executeQuery(statement);
        }
        const rows = await adapter.queryStatement(sql`
        INSERT INTO nextly_migrate_lock (id, owner, acquired_at, expires_at)
        VALUES (1, ${"earlier-host:1:uuid"}, now(), now() + make_interval(secs => ${900}))
        ON CONFLICT (id) DO UPDATE
          SET owner = EXCLUDED.owner,
              acquired_at = EXCLUDED.acquired_at,
              expires_at = EXCLUDED.expires_at
          WHERE nextly_migrate_lock.expires_at < now()
        RETURNING id`);
        return rows.length === 1;
      }

      it("treats an earlier nextly migrate's lock row as held, and changes nothing", async () => {
        expect(await earlierMigrateAcquires()).toBe(true);

        await expect(myRun()).rejects.toMatchObject({
          code: "NEXTLY_MIGRATE_LOCK_BUSY",
          logContext: { holder: { kind: "earlier-migrate-lock" } },
        });
        expect(await exists(MINE)).toBe(false);
        // And gave back the schema lock it had taken first, so it holds nothing.
        await adapter.executeQuery("DELETE FROM nextly_migrate_lock");
        await expect(myRun()).resolves.toEqual({ ran: true, value: "ran" });
      }, 60_000);

      it("makes the migrate lock read as held to an earlier nextly migrate while a run holds the lock", async () => {
        let earlierGotIt: boolean | undefined;
        await withSchemaLock(
          { adapter, command: "nextly db:sync", whenHeld: "refuse" },
          async () => {
            earlierGotIt = await earlierMigrateAcquires();
          }
        );
        expect(earlierGotIt).toBe(false);
        // Released with the lock, so an earlier run that starts afterwards proceeds.
        expect(await earlierMigrateAcquires()).toBe(true);
      }, 60_000);
    }

    if (dialect === "mysql") {
      /** A connection of an earlier version's own, as its `nextly migrate` takes the named lock. */
      async function earlierConnection() {
        const { createConnection } = await import("mysql2/promise");
        const connection = await createConnection({
          uri: process.env.TEST_MYSQL_URL as string,
        });
        const name = (await connection.query(
          "SELECT CONCAT('nextly:migrate:', SHA1(COALESCE(DATABASE(), ''))) AS name"
        )) as unknown as [Array<{ name: string }>];
        const lockName = name[0][0].name;
        return {
          take: async () => {
            const [rows] = (await connection.query(
              "SELECT GET_LOCK(?, 0) AS got",
              [lockName]
            )) as unknown as [Array<{ got: number }>];
            return rows[0].got === 1;
          },
          release: () => connection.query("SELECT RELEASE_LOCK(?)", [lockName]),
          end: () => connection.end(),
        };
      }

      it("treats an earlier nextly migrate's named lock as held, and changes nothing", async () => {
        const earlier = await earlierConnection();
        try {
          expect(await earlier.take()).toBe(true);
          await expect(myRun()).rejects.toMatchObject({
            code: "NEXTLY_MIGRATE_LOCK_BUSY",
            logContext: { holder: { kind: "earlier-mysql-lock" } },
          });
          expect(await exists(MINE)).toBe(false);
          await earlier.release();
          await expect(myRun()).resolves.toEqual({ ran: true, value: "ran" });
        } finally {
          await earlier.end();
        }
      }, 60_000);

      it("makes the named lock read as held to an earlier nextly migrate while a run holds the lock", async () => {
        const earlier = await earlierConnection();
        try {
          let earlierGotIt: boolean | undefined;
          await withSchemaLock(
            { adapter, command: "nextly db:sync", whenHeld: "refuse" },
            async () => {
              earlierGotIt = await earlier.take();
            }
          );
          expect(earlierGotIt).toBe(false);
          expect(await earlier.take()).toBe(true);
        } finally {
          await earlier.end();
        }
      }, 60_000);
    }
  }
);
