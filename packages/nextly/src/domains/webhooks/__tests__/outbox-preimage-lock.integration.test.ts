/**
 * Row-lock dialect gate for the outbox pre-image read.
 *
 * `createTestNextly` boots SQLite unless it is handed an adapter, and the lock
 * statement is Postgres/MySQL-only — so without this gate the `FOR UPDATE`
 * SQL would never execute in the test suite at all, and a syntax or quoting
 * error in it would reach production unnoticed.
 *
 * Beyond exercising the statement, this pins what the lock is for: two
 * concurrent updates to the same entry must not cross-attribute each other's
 * fields in `changedFields`. Unlocked, the second transaction reads the prior
 * row before the first commits, then writes on top of it — so its event reports
 * the other writer's field as part of this change.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { WebhookEvent } from "../types";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";
const MYSQL_URL = process.env.TEST_MYSQL_URL ?? "";

// A dedicated slug so reruns against the shared test database are idempotent.
const SLUG = "locktestposts";
const TABLE = `dc_${SLUG}`;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;
type Dialect = "postgresql" | "mysql";

interface Leg {
  name: string;
  dialect: Dialect;
  url: string;
}

const LEGS: Leg[] = [
  { name: "postgres", dialect: "postgresql", url: POSTGRES_URL },
  { name: "mysql", dialect: "mysql", url: MYSQL_URL },
];

async function connect(leg: Leg): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on the first read of any
  // env property in this worker and caches the result, so both must be set on
  // process.env — passing `url` to createAdapter alone does not satisfy it.
  process.env.DB_DIALECT = leg.dialect;
  process.env.DATABASE_URL = leg.url;
  const adapter = await createAdapter({
    type: leg.dialect,
    url: leg.url,
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

function envelopeOf(row: { payload: unknown }): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

for (const leg of LEGS) {
  // eslint-disable-next-line vitest/no-conditional-tests -- dialect gate: the
  // suite is skipped wholesale when the dialect's URL is unset, matching the
  // other dialect gates in this package.
  const describeLeg = leg.url ? describe : describe.skip;

  describeLeg(`outbox pre-image row lock (${leg.name} dialect gate)`, () => {
    let cleanup: TestAdapter | undefined;

    beforeAll(async () => {
      if (!leg.url) return;
      cleanup = await connect(leg);
      await drop();
    });

    afterAll(async () => {
      await drop();
      if (cleanup) await cleanup.disconnect();
    });

    async function drop(): Promise<void> {
      if (!cleanup) return;
      for (const stmt of [
        `DROP TABLE IF EXISTS ${TABLE}`,
        `DELETE FROM dynamic_collections WHERE slug = '${SLUG}'`,
        `DELETE FROM nextly_events WHERE resource_collection = '${SLUG}'`,
      ]) {
        try {
          await cleanup.executeQuery(stmt);
        } catch {
          // Best-effort: on a fresh database these tables may not exist yet.
        }
      }
    }

    it("serializes concurrent updates so neither event claims the other's field", async () => {
      const bootAdapter = await connect(leg);
      let handle: TestNextly | undefined;
      try {
        // Boot bare first so the system tables exist, then seed the collection
        // through the builder path — the same order the other dialect gates
        // use, since the code-first apply expects a schema this fresh database
        // does not have yet.
        handle = await createTestNextly({ adapter: bootAdapter });
        await seedBuilderCollection(bootAdapter, {
          slug: SLUG,
          fields: [
            { name: "alpha", type: "text" },
            { name: "beta", type: "text" },
          ],
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");

        const created = await h.createEntry(
          { collectionName: SLUG, overrideAccess: true },
          { alpha: "a0", beta: "b0" }
        );
        const id = (created.data as { id: string }).id;

        // Two writers touching disjoint fields of the same row at once. The
        // lock forces one to wait for the other's commit, so each reads a
        // settled prior state rather than one that changes under it.
        await Promise.all([
          h.updateEntry(
            { collectionName: SLUG, entryId: id, overrideAccess: true },
            { alpha: "a1" }
          ),
          h.updateEntry(
            { collectionName: SLUG, entryId: id, overrideAccess: true },
            { beta: "b1" }
          ),
        ]);

        const rows = await handle.adapter.select<{
          type: string;
          resource_collection?: string;
          resourceCollection?: string;
          payload: unknown;
        }>("nextly_events");
        const updates = rows.filter(r => r.type === "entry.updated");
        expect(updates).toHaveLength(2);

        const changed = updates.map(r => envelopeOf(r).changedFields ?? []);
        const alphaEvent = changed.find(c => c.includes("alpha"));
        const betaEvent = changed.find(c => c.includes("beta"));
        expect(alphaEvent).toBeDefined();
        expect(betaEvent).toBeDefined();
        // The point of the lock: each event reports only its own field.
        expect(alphaEvent).not.toContain("beta");
        expect(betaEvent).not.toContain("alpha");
      } finally {
        await handle?.destroy();
      }
    });
  });
}
