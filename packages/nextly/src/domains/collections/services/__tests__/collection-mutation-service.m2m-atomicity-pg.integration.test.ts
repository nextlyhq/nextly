/**
 * Postgres dialect gate for the m2m write-atomicity fix.
 *
 * `createTestNextly` (used by collection-mutation-service.m2m-atomicity.
 * integration.test.ts) always boots on in-memory SQLite by design — it never
 * reads TEST_POSTGRES_URL, so running that suite through
 * `pnpm test:integration:postgres17` still only exercises SQLite. The fix
 * under test (junction writes moved inside `adapter.transaction(...)`) is
 * dialect-agnostic application logic, but the only way to be sure the real
 * Postgres driver honours the same rollback semantics is to drive the full
 * mutation path against a real server. Follows the repo convention used by
 * collection-relationship-service-pg.integration.test.ts: connect via
 * `TEST_POSTGRES_URL`, skip when unreachable, and self-clean the tables/rows
 * it creates.
 *
 * Unlike the relationship-service dialect gates (which call
 * `CollectionRelationshipService` directly with stub dependencies), this
 * suite boots the FULL service container (`createTestNextly({ adapter })`)
 * against the real Postgres connection so `collectionService.createEntry`
 * exercises the exact same code path as production: hooks, validation,
 * `CollectionMutationService.createEntry`, and the widened transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../../database/factory";
import { clearServices } from "../../../../di/register";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../collection-service";

// Skip ONLY when the Postgres-specific URL is unset; do not fall back to a
// generic URL, or this gate could silently run against a non-Postgres database.
const PG_URL = process.env.TEST_POSTGRES_URL ?? "";

// Fixed, dedicated slugs/tables for this gate — dropped before and after so
// reruns against the shared test database are idempotent (the sequential
// integration run, fileParallelism: false, is what makes this safe).
const TAGS_SLUG = "atomtags";
const POSTS_SLUG = "atomposts";
const TAGS_TABLE = `dc_${TAGS_SLUG}`;
const POSTS_TABLE = `dc_${POSTS_SLUG}`;
const JUNCTION_TABLE = `${POSTS_TABLE}_${TAGS_TABLE}_tags`;

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

async function connectIfAvailable(): Promise<TestAdapter | null> {
  if (!PG_URL) return null;
  process.env.DB_DIALECT = "postgresql";
  // env.ts validates DATABASE_URL against DB_DIALECT the first time ANY
  // env.* property is read in this worker (it caches after that first read),
  // and createAdapter's pool-defaults layering reads env.DB_POOL_MAX
  // unconditionally. Passing `url` directly in the createAdapter config
  // isn't enough to satisfy that validation — DATABASE_URL must also be set
  // on process.env, or the validation throws regardless of run order.
  process.env.DATABASE_URL = PG_URL;
  const adapter = await createAdapter({
    type: "postgresql",
    url: PG_URL,
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

// Dedicated connection used only for raw cleanup queries — kept open across
// the whole file (unlike the `createTestNextly`-managed connection below,
// whose `handle.destroy()` disconnects it).
const cleanupAdapter = await connectIfAvailable();
const describePg = cleanupAdapter ? describe : describe.skip;

/**
 * Best-effort cleanup so reruns against the shared Postgres test database
 * are idempotent. Wrapped in try/catch per statement: on a database where
 * this suite has never run, `dynamic_collections` may not exist yet, which
 * must not fail the whole cleanup (mirrors the `IF EXISTS` DROP pattern
 * other dialect gates use for the same reason).
 */
async function dropFixtures(): Promise<void> {
  if (!cleanupAdapter) return;
  for (const stmt of [
    `DROP TABLE IF EXISTS ${JUNCTION_TABLE} CASCADE`,
    `DROP TABLE IF EXISTS ${POSTS_TABLE} CASCADE`,
    `DROP TABLE IF EXISTS ${TAGS_TABLE} CASCADE`,
    `DELETE FROM dynamic_collections WHERE slug IN ('${POSTS_SLUG}', '${TAGS_SLUG}')`,
  ]) {
    try {
      await cleanupAdapter.executeQuery(stmt);
    } catch {
      // best-effort cleanup — table may not exist yet on a fresh database.
    }
  }
}

beforeAll(async () => {
  await dropFixtures();
});

afterAll(async () => {
  await dropFixtures();
  if (cleanupAdapter) await cleanupAdapter.disconnect();
});

describePg(
  "CollectionMutationService m2m write atomicity (Postgres dialect gate)",
  () => {
    it("createEntry rolls back the entry when the junction insert fails, on real Postgres", async () => {
      // Second, independent connection to the same database, dedicated to
      // the full-service boot — `handle.destroy()` disconnects it, leaving
      // `cleanupAdapter` (used by beforeAll/afterAll) untouched.
      const bootAdapter = await createAdapter({
        type: "postgresql",
        url: PG_URL,
      } as Parameters<typeof createAdapter>[0]);

      let handle: TestNextly | undefined;
      try {
        // First boot creates the system tables (dynamic_collections, etc.).
        handle = await createTestNextly({ adapter: bootAdapter });

        await seedBuilderCollection(bootAdapter, {
          slug: TAGS_SLUG,
          fields: [{ name: "name", type: "text" }],
        });
        await seedBuilderCollection(bootAdapter, {
          slug: POSTS_SLUG,
          fields: [
            { name: "title", type: "text" },
            {
              name: "tags",
              type: "relationship",
              options: { relationType: "manyToMany", target: TAGS_SLUG },
            },
          ],
        });

        // Reset DI without disconnecting, then reboot on the SAME adapter so
        // `collectionService` resolves the just-seeded collections.
        clearServices();
        handle = await createTestNextly({ adapter: bootAdapter });

        const collections = handle.getService(
          "collectionService"
        ) as CollectionService;

        const tagId = "pg-atom-tag-1";
        // NOW() (not an epoch literal) — this row is read by real Postgres,
        // whose timestamp columns need a proper timestamp value, unlike the
        // SQLite suite's epoch-seconds integer literal.
        await bootAdapter.executeQuery(
          `INSERT INTO ${TAGS_TABLE} (id, title, slug, name, created_at, updated_at) VALUES ('${tagId}', 'JavaScript', 'javascript', 'javascript', NOW(), NOW())`
        );

        // Drop the junction table so insertManyToManyRelations throws from
        // inside the entry's transaction.
        await bootAdapter.executeQuery(`DROP TABLE ${JUNCTION_TABLE}`);

        await expect(
          collections.createEntry(
            POSTS_SLUG,
            { title: "Hello", tags: [tagId] },
            { overrideAccess: true }
          )
        ).rejects.toThrow();

        // Pre-fix, the junction write ran AFTER the entry's transaction
        // committed, so the entry would survive here. Post-fix, the junction
        // write is inside the transaction, so the entry never lands.
        const rows = await bootAdapter.executeQuery<{ id: string }>(
          `SELECT id FROM ${POSTS_TABLE}`
        );
        expect(rows).toHaveLength(0);
      } finally {
        await handle?.destroy();
      }
    });
  }
);
