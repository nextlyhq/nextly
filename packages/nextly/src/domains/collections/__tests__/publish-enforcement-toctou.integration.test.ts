/**
 * The publish-transition gate must be enforced against the status read UNDER the
 * write's row lock, not a status read before the transaction — otherwise a
 * concurrent writer can move a row into (or out of) published in the window
 * between the two, and the write slips a transition past the gate.
 *
 * This reproduces the exact race on a REAL database (SQLite serializes writers
 * via `BEGIN IMMEDIATE`, so it cannot manifest there and the suite self-skips
 * without a Postgres/MySQL URL):
 *
 *   1. A row is `draft`.
 *   2. Writer A (an editor who may update but NOT unpublish) starts a batch
 *      update that keeps the row `draft`, reading `draft` before it takes its
 *      lock.
 *   3. Writer B publishes the row and commits.
 *   4. Writer A finally takes its lock. Classified against the PRE-lock read
 *      (`draft` → `draft`) the write is no transition and would be allowed —
 *      silently unpublishing. Classified against the LOCKED read (`published` →
 *      `draft`) it is an unpublish the editor may not perform, and is refused.
 *
 * The batch worker resolves the caller's publish/unpublish authorization before
 * the transaction and enforces it under the lock, so A is correctly refused and
 * B's publish stands.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

const SLUG = "toctouposts";
const TABLE = `dc_${SLUG}`;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;
type Dialect = "postgresql" | "mysql";
interface Leg {
  name: string;
  dialect: Dialect;
  url: string;
}

// Postgres is the reference concurrency leg. The enforce-under-lock behaviour is
// dialect-agnostic (the adapter's row lock no-ops on SQLite, which serializes
// writers, and applies identically on MySQL), so one real two-transaction leg
// proves the race closure; a MySQL leg is omitted to keep the suite off shared
// system-table drift in the test container.
const LEGS: Leg[] = [
  { name: "postgres", dialect: "postgresql", url: POSTGRES_URL },
];

async function connect(leg: Leg): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on first read in this
  // worker, so both must be on process.env — not just passed to createAdapter.
  process.env.DB_DIALECT = leg.dialect;
  process.env.DATABASE_URL = leg.url;
  const adapter = await createAdapter({
    type: leg.dialect,
    url: leg.url,
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
// skip the under-lock path. Postgres-only, matching the single concurrency leg.
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
  throw new Error(`timed out waiting for a lock waiter on ${TABLE}`);
}

const whereId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

for (const leg of LEGS) {
  const describeLeg = describe.skipIf(!leg.url);

  describeLeg(`publish transition TOCTOU (${leg.name} dialect gate)`, () => {
    let boot: TestAdapter | undefined;

    beforeAll(async () => {
      if (!leg.url) return;
      boot = await connect(leg);
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

    it("refuses a batch draft-write that races a concurrent publish", async () => {
      const adapter = await connect(leg);
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [
            defineCollection({
              slug: SLUG,
              status: true,
              // Editors may update and read but never unpublish; only a trusted
              // (overrideAccess) write may move a row out of published.
              access: {
                create: () => true,
                update: () => true,
                read: () => true,
                unpublish: () => false,
              },
              fields: [text({ name: "title" })],
            }),
          ],
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entryService = h.getEntryService() as CollectionEntryService;

        const created = await h.createEntry(
          { collectionName: SLUG, overrideAccess: true },
          { title: "t", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        const gate = deferred();
        const bLocked = deferred();

        // Writer B: hold a transaction that locks the row and publishes it, then
        // wait for the gate before committing — so it commits only after A has
        // read `draft` and is blocked on the same lock.
        const bTx = handle.adapter.transaction(async tx => {
          await tx.lockRow(TABLE, id);
          await tx.update(TABLE, { status: "published" }, whereId(id));
          bLocked.resolve();
          await gate.promise;
        });

        await bLocked.promise;

        // Writer A: a batch update that keeps the row draft. It reads the
        // committed `draft` (B is uncommitted), then blocks taking the row lock.
        const aResultP = entryService.updateEntries(
          { collectionName: SLUG, user: { id: "editor" } },
          [{ id, data: { status: "draft" } }]
        );

        // Wait until A is observably parked on B's row lock (not a fixed sleep),
        // so A has already read `draft` and is blocked before B commits.
        await waitForLockWaiter(handle.adapter);

        gate.resolve();
        await bTx;

        const aResult = await aResultP;
        // The draft-over-published write is an unpublish the editor may not do.
        expect(aResult.successful).toBe(0);
        expect(aResult.failed).toBe(1);

        // A was refused under the lock, so B's publish stands.
        const [row] = await handle.adapter.select<{ status: string }>(TABLE, {
          where: whereId(id),
        });
        expect(row?.status).toBe("published");
      } finally {
        await handle?.destroy();
      }
    });

    it("returns not-found when the row is deleted under the lock", async () => {
      const adapter = await connect(leg);
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [
            defineCollection({
              slug: SLUG,
              status: true,
              // The editor may update but never publish, so absent the fix a
              // phantom `null -> published` classification would be refused with a
              // publish denial rather than not-found.
              access: {
                create: () => true,
                update: () => true,
                read: () => true,
                publish: () => false,
              },
              fields: [text({ name: "title" })],
            }),
          ],
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entryService = h.getEntryService() as CollectionEntryService;

        const created = await h.createEntry(
          { collectionName: SLUG, overrideAccess: true },
          { title: "t", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        const gate = deferred();
        const bLocked = deferred();

        // Writer B: lock and DELETE the row, then hold the transaction open until
        // the gate — so it commits the delete only after A has read the row and is
        // blocked on the same lock.
        const bTx = handle.adapter.transaction(async tx => {
          await tx.lockRow(TABLE, id);
          await tx.delete(TABLE, whereId(id));
          bLocked.resolve();
          await gate.promise;
        });

        await bLocked.promise;

        // Writer A: a batch update to `published`. Its plain existence read sees
        // the still-committed row, then it blocks taking the row lock behind B.
        const aResultP = entryService.updateEntries(
          { collectionName: SLUG, user: { id: "editor" } },
          [{ id, data: { status: "published" } }]
        );

        // Release the gate only once A is observably blocked on B's row lock, so
        // A's pre-lock read has already seen the row and it is parked on the FOR
        // UPDATE — it cannot instead observe the committed delete and skip the
        // under-lock guard.
        await waitForLockWaiter(handle.adapter);

        gate.resolve();
        await bTx;

        const aResult = await aResultP;
        // The row vanished under the lock, so the write is not-found — not a
        // publish denial for a `null -> published` transition on an absent row.
        expect(aResult.successful).toBe(0);
        expect(aResult.failed).toBe(1);
        expect(aResult.errors[0]?.error ?? "").toMatch(/not found/i);
      } finally {
        await handle?.destroy();
      }
    });
  });
}
