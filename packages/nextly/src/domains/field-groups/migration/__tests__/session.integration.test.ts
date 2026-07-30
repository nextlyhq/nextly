/**
 * The migration lock, against a real server rather than a double.
 *
 * Every other test of this module talks to a stand-in, and a stand-in is what
 * hid the fact that the lock could not run at all: its table is created on
 * demand and has no Drizzle definition, so the typed CRUD path rejected the
 * name while doubles answered the call happily. This suite exists so that class
 * of defect cannot survive again — it exercises seed, claim, exclusion and
 * release through the real adapter, with the table genuinely absent from the
 * schema registry.
 */
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  MIGRATION_LOCK_TABLE,
  withMigrationSession,
  type MigrationSession,
} from "../session";

interface LockAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "field-group migration lock on a live server",
  () => {
    let adapter: LockAdapter;

    beforeAll(async () => {
      adapter = createPostgresAdapter({
        url: process.env.TEST_POSTGRES_URL as string,
      }) as unknown as LockAdapter;
      await adapter.connect();
      // No table, no row, and no schema registry has ever been told about it:
      // exactly the state a first run meets.
      await adapter.executeQuery(
        `DROP TABLE IF EXISTS ${MIGRATION_LOCK_TABLE}`
      );
    });

    afterAll(async () => {
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
          dialect: "postgresql",
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
  }
);
