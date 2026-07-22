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

        // Let A reach its lock and block behind B before B commits.
        await sleep(500);

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
  });
}
