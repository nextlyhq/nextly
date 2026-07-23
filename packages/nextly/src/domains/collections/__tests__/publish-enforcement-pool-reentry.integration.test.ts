/**
 * The publish/unpublish authorization the transaction/batch write paths resolve
 * reads the RBAC role/permission tables. When a caller-owned transaction already
 * holds a connection, that read must run on the TRANSACTION's own connection, not
 * the pool: a pooled read would try to check out a second connection that the
 * open transaction will not release until its callback returns, so against a
 * single-connection pool the read blocks forever and the write deadlocks.
 *
 * This pins the fix on a REAL database with a single-connection pool
 * (`pool.max = 1`): `RBACAccessControlService.checkAccess` — the exact call the
 * collection access service makes to judge a publish transition — is invoked
 * from INSIDE a caller's transaction with that transaction's executor, and it
 * COMPLETES. Break the fix (drop the executor and the RBAC reads fall back to the
 * pool) and it hangs on the second checkout, caught here by a timeout. SQLite has
 * no connection pool, so the suite self-skips without a Postgres URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

const SLUG = "poolreentryposts";
const TABLE = `dc_${SLUG}`;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

// A single-connection pool is the whole point: with `max: 1` the caller's
// transaction holds the ONLY connection, so any read that re-enters the pool
// from inside the transaction can never acquire a second one and blocks forever.
async function connectSingleConnection(): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on first read in this
  // worker, so both must be on process.env — not just passed to createAdapter.
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = POSTGRES_URL;
  const adapter = await createAdapter({
    type: "postgresql",
    url: POSTGRES_URL,
    pool: { max: 1 },
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

// Reject if the check does not settle in time: a re-entrant pooled read on a
// `max: 1` pool never resolves, so without a bound timeout the test would hang
// instead of failing. The window is far above the completing path's runtime.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) =>
      setTimeout(
        () =>
          reject(
            NextlyError.internal({
              logContext: {
                reason: "pool-reentry-timeout",
                table: TABLE,
                timeoutMs: ms,
              },
            })
          ),
        ms
      )
    ),
  ]);
}

const describePg = describe.skipIf(!POSTGRES_URL);

describePg(
  "publish enforcement — caller-owned-tx RBAC pool reentry (postgres)",
  () => {
    let boot: TestAdapter | undefined;

    beforeAll(async () => {
      if (!POSTGRES_URL) return;
      boot = await connectSingleConnection();
      await drop();
    });

    afterAll(async () => {
      await drop();
      if (boot) await boot.disconnect();
    });

    async function drop(): Promise<void> {
      if (!boot) return;
      for (const stmt of [
        `DROP TABLE IF EXISTS ${TABLE}`,
        `DELETE FROM dynamic_collections WHERE slug = '${SLUG}'`,
      ]) {
        try {
          await boot.executeQuery(stmt);
        } catch {
          // Best-effort on a fresh database.
        }
      }
    }

    it("resolves a publish RBAC check on the transaction's own connection", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [
            defineCollection({
              slug: SLUG,
              status: true,
              fields: [text({ name: "title" })],
            }),
          ],
        });
        const rbac = handle.getService<RBACAccessControlService>(
          "rbacAccessControlService"
        );

        // Open a caller-owned transaction (it checks out the single pooled
        // connection) and judge a publish transition INSIDE it, passing the
        // transaction's executor. The RBAC reads (super-admin resolution and
        // the permission lookup) run on that connection; a pooled read would
        // block forever waiting for a second connection.
        const allowed = await withTimeout(
          handle.adapter.transaction(tx =>
            rbac.checkAccess({
              userId: "editor",
              operation: "publish",
              resource: SLUG,
              executor: tx.getDrizzle(),
            })
          ),
          15_000
        );

        // It ran to completion (did not deadlock). The editor holds no roles
        // and the collection defines no publish rule, so the publish is denied
        // — the point is that the decision was REACHED on the tx connection.
        expect(allowed).toBe(false);
      } finally {
        await handle?.destroy();
      }
    }, 30_000);
  }
);
