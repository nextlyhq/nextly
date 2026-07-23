/**
 * A Single's publish-transition gate must be enforced against the status read
 * UNDER the write's row lock, not a status read taken before the transaction —
 * otherwise a concurrent writer can move the row into (or out of) published in
 * the window between the two, and the write slips a transition past the gate.
 *
 * This reproduces the exact race on a REAL database (SQLite serializes writers
 * via `BEGIN IMMEDIATE`, so it cannot manifest there and the suite self-skips
 * without a Postgres URL):
 *
 *   1. The Single row is `draft`.
 *   2. Writer A (an editor who may update but NOT unpublish) starts an update
 *      that keeps the row `draft`, reading `draft` before it takes its lock.
 *   3. Writer B publishes the row and commits.
 *   4. Writer A finally takes its lock. Classified against the PRE-lock read
 *      (`draft` → `draft`) the write is no transition and would be allowed —
 *      silently unpublishing. Classified against the LOCKED read (`published` →
 *      `draft`) it is an unpublish the editor may not perform, and is refused.
 *
 * The update pre-resolves the caller's publish/unpublish authorization before
 * the transaction and enforces it under the lock, so A is correctly refused and
 * B's publish stands.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

const SLUG = "toctousingle";
const TABLE = `single_${SLUG}`;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

async function connect(): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on first read in this
  // worker, so both must be on process.env — not just passed to createAdapter.
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = POSTGRES_URL;
  const adapter = await createAdapter({
    type: "postgresql",
    url: POSTGRES_URL,
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Block until a backend is parked waiting on a lock for this table. Releasing the
// gate only after Writer A is observably blocked on Writer B's row lock makes the
// race deterministic: A has already taken its pre-lock read and is now waiting on
// the FOR UPDATE, so it cannot instead observe B's committed change up front and
// skip the under-lock path.
async function waitForLockWaiter(adapter: TestAdapter): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rows = await adapter.executeQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query LIKE $1`,
      [`%${TABLE}%`]
    );
    if ((rows[0]?.n ?? 0) > 0) return;
    await sleep(25);
  }
  throw NextlyError.internal({
    logContext: { reason: "toctou-lock-waiter-timeout", table: TABLE },
  });
}

const whereId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

const describeLeg = describe.skipIf(!POSTGRES_URL);

describeLeg("single publish transition TOCTOU (postgres dialect gate)", () => {
  let boot: TestAdapter | undefined;

  beforeAll(async () => {
    if (!POSTGRES_URL) return;
    boot = await connect();
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
      `DELETE FROM dynamic_singles WHERE slug = '${SLUG}'`,
    ]) {
      try {
        await boot.executeQuery(stmt);
      } catch {
        // Best-effort on a fresh database.
      }
    }
  }

  it("refuses a draft-write that races a concurrent publish", async () => {
    const adapter = await connect();
    let handle: TestNextly | undefined;
    try {
      handle = await createTestNextly({
        adapter,
        singles: [
          defineSingle({
            slug: SLUG,
            status: true,
            fields: [text({ name: "siteName" })],
          }),
        ],
      });
      const service =
        handle.getService<SingleEntryService>("singleEntryService");

      // Seed the row as draft via a trusted write.
      await service.update(
        SLUG,
        { siteName: "S", status: "draft" },
        { overrideAccess: true }
      );
      const seeded = await handle.adapter.selectOne<{ id: string }>(TABLE, {});
      const id = seeded?.id as string;

      const gate = deferred();
      const bLocked = deferred();

      // Writer B: hold a transaction that locks the row and publishes it, then
      // wait for the gate before committing — so it commits only after A has read
      // `draft` and is blocked on the same lock.
      const bTx = handle.adapter.transaction(async tx => {
        await tx.lockRow(TABLE, id);
        await tx.update(TABLE, { status: "published" }, whereId(id));
        bLocked.resolve();
        await gate.promise;
      });

      await bLocked.promise;

      // Writer A: an editor (route-attested `update`, no `unpublish`) writes the
      // row `draft`. Its pre-lock read sees the committed `draft` (B is
      // uncommitted), then it blocks taking the row lock behind B.
      const aResultP = service.update(
        SLUG,
        { status: "draft" },
        { user: { id: "editor" }, routeAuthorized: true }
      );

      // Release the gate only once A is observably parked on B's row lock, so A
      // has already read `draft` and is blocked before B commits.
      await waitForLockWaiter(handle.adapter);

      gate.resolve();
      await bTx;

      const aResult = await aResultP;
      // The draft-over-published write is an unpublish the editor may not do.
      expect(aResult.success).toBe(false);
      expect(aResult.statusCode).toBe(403);

      // A was refused under the lock, so B's publish stands.
      const row = await handle.adapter.selectOne<{ status: string }>(TABLE, {
        where: whereId(id),
      });
      expect(row?.status).toBe("published");
    } finally {
      await handle?.destroy();
    }
  });
});
