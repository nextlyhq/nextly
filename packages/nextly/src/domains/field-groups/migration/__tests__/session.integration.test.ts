/**
 * The migration lock, against a real server rather than a double.
 *
 * Every other test of this module talks to a stand-in, and a stand-in is what
 * hid the fact that the lock could not run at all: its table is created on
 * demand and has no Drizzle definition, so the typed CRUD path rejected the
 * name while doubles answered the call happily. This suite exists so that class
 * of defect cannot survive again — it exercises seed, claim, exclusion and
 * release through the real adapter.
 *
 * Run on EVERY dialect, not just PostgreSQL. The defect this suite was written
 * for was a typed-CRUD path rejecting an undeclared table name, and nothing
 * about that is specific to one driver: whether `lockRow` and the statement
 * path work against a given server is a property of that server's adapter. One
 * dialect passing says nothing about the other two, which is exactly the gap
 * that let a double stand in for reality the first time.
 */
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  getMigrationLockDdl,
  MIGRATION_LOCK_TABLE,
  withMigrationSession,
  type MigrationSession,
} from "../session";

interface LockAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * The servers this runs against.
 *
 * SQLite carries no URL because it needs no server; the other two self-skip when
 * their URL is unset, which is how every integration suite here behaves.
 */
const DIALECTS: {
  dialect: SupportedDialect;
  url: string | null;
  make: () => LockAdapter;
}[] = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: () =>
      createPostgresAdapter({
        url: process.env.TEST_POSTGRES_URL as string,
      }) as unknown as LockAdapter,
  },
  {
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: () =>
      createMySqlAdapter({
        url: process.env.TEST_MYSQL_URL as string,
      }) as unknown as LockAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as LockAdapter,
  },
];

describe.each(DIALECTS)(
  "field-group migration lock on a live $dialect server",
  ({ dialect, url, make }) => {
    let adapter: LockAdapter;
    const runs = url === null ? describe.skip : describe;

    beforeAll(async () => {
      if (url === null) return;
      adapter = make();
      await adapter.connect();
      // No table, no row, and no schema registry has ever been told about it:
      // exactly the state a first run meets.
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${MIGRATION_LOCK_TABLE}`
      );
    });

    afterAll(async () => {
      if (url === null) return;
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${MIGRATION_LOCK_TABLE}`
      );
      await adapter.disconnect();
    });

    function session<T>(
      label: string,
      fn: (s: MigrationSession) => Promise<T>
    ): Promise<T> {
      return withMigrationSession(
        {
          // The adapter's own type; the cast is only to keep this suite's
          // surface narrow.
          adapter: adapter as never,
          dialect,
          label,
        },
        fn
      );
    }

    async function ownerNow(): Promise<string | null> {
      const rows = await adapter.executeQuery<{ owner: string | null }>(
        `SELECT owner FROM ${MIGRATION_LOCK_TABLE} WHERE id = 1`
      );
      return rows[0]?.owner ?? null;
    }

    runs("against this server", () => {
      it("creates its table, seeds the row, claims and releases it", async () => {
        let heldDuring: string | null = null;

        await session("run-1", async () => {
          heldDuring = await ownerNow();
        });

        // Held while the callback ran, and free afterwards. Both halves went
        // through the real driver against a table the ORM does not declare.
        expect(heldDuring).not.toBeNull();
        expect(heldDuring).toContain("run-1");
        expect(await ownerNow()).toBeNull();
      });

      it("refuses a second run while the first holds the lock", async () => {
        const error = await session("outer", async () =>
          session("inner", () => Promise.resolve("should not run")).catch(
            (caught: unknown) => caught
          )
        );

        expect(NextlyError.is(error)).toBe(true);
        if (NextlyError.is(error)) {
          expect(error.logContext?.reason).toMatch(/held elsewhere/);
        }
        // The outer run's release still happened despite the inner refusal.
        expect(await ownerNow()).toBeNull();
      });

      it("releases the claim when the run throws", async () => {
        await expect(
          session("failing", () => Promise.reject(new Error("boom")))
        ).rejects.toThrow();
        expect(await ownerNow()).toBeNull();
      });

      /**
       * Put the row in a chosen state, with the expiry computed by the SERVER.
       *
       * 🔴 Spelled independently of `expiryExpression` on purpose. A fixture built from the same
       * expression the code under test uses would agree with a broken one — the two would be wrong
       * together and the comparison would still look correct. The offset is applied by the database
       * so no client clock enters the fixture either.
       */
      async function seedClaim(
        owner: string | null,
        expiresInSeconds: number | null
      ): Promise<void> {
        for (const statement of getMigrationLockDdl(dialect)) {
          await adapter.executeQuery(statement);
        }
        await adapter.executeQuery(
          `INSERT INTO ${MIGRATION_LOCK_TABLE} (id, owner) SELECT 1, NULL WHERE NOT EXISTS (SELECT 1 FROM ${MIGRATION_LOCK_TABLE} WHERE id = 1)`
        );
        const expiry =
          expiresInSeconds === null
            ? "NULL"
            : dialect === "sqlite"
              ? `unixepoch() + (${expiresInSeconds})`
              : dialect === "mysql"
                ? `DATE_ADD(NOW(), INTERVAL ${expiresInSeconds} SECOND)`
                : `now() + (${expiresInSeconds} * interval '1 second')`;
        await adapter.executeQuery(
          `UPDATE ${MIGRATION_LOCK_TABLE} SET owner = ${owner === null ? "NULL" : `'${owner}'`}, expires_at = ${expiry} WHERE id = 1`
        );
      }

      // 🔴 The two tests below are each other's control, and BOTH are needed on EVERY dialect. The
      // column is a different type on each — `timestamptz`, `datetime`, and an integer of unix
      // seconds — so `expires_at > now()` is a different comparison every time. A predicate that
      // always answered "expired" would let two runs migrate at once and would pass the takeover
      // test alone; one that always answered "live" would wedge every database forever and would
      // pass the refusal test alone. Only the pair separates a working comparison from either.
      it("takes over a claim whose expiry has passed", async () => {
        await seedClaim("dead-run", -1);

        let ownerDuringRun: string | null = null;
        await session("takeover", async () => {
          ownerDuringRun = await ownerNow();
        });

        expect(ownerDuringRun).toContain("takeover");
        expect(await ownerNow()).toBeNull();
      });

      it("refuses a claim whose expiry has not passed", async () => {
        await seedClaim("live-run", 600);

        const error = await session("contender", () =>
          Promise.resolve("should not run")
        ).catch((caught: unknown) => caught);

        expect(NextlyError.is(error)).toBe(true);
        // Untouched: the refusal must not disturb a claim that is still live.
        expect(await ownerNow()).toBe("live-run");
      });

      // The row a release before this column existed left behind. Its writer may still be running,
      // so age alone never makes it claimable — an operator clears it.
      it("refuses a claim whose expiry is null", async () => {
        await seedClaim("legacy-run", null);

        const error = await session("contender", () =>
          Promise.resolve("should not run")
        ).catch((caught: unknown) => caught);

        expect(NextlyError.is(error)).toBe(true);
        expect(await ownerNow()).toBe("legacy-run");
      });

      // The claim has to WRITE an expiry for any of the above to mean anything: a claim that left
      // the column NULL would read as a lock that never lapses, and every takeover test would then
      // be exercising a state the code cannot actually produce.
      it("writes an expiry that the server reads as still ahead", async () => {
        await seedClaim(null, null);

        let liveDuringRun: unknown;
        await session("expiring", async () => {
          const rows = await adapter.executeQuery<{ live: unknown }>(
            `SELECT CASE WHEN expires_at > ${dialect === "sqlite" ? "unixepoch()" : dialect === "mysql" ? "NOW()" : "now()"} THEN 1 ELSE 0 END AS live FROM ${MIGRATION_LOCK_TABLE} WHERE id = 1`
          );
          liveDuringRun = rows[0]?.live;
        });

        expect(Number(liveDuringRun)).toBe(1);
      });
    });
  }
);
