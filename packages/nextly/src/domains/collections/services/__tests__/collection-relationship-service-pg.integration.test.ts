/**
 * Postgres dialect gate for the many-to-many junction fix bundle.
 *
 * `createTestNextly` (used by collection-relationship-service.m2m.integration.test.ts)
 * always boots on in-memory SQLite by design — it never reads TEST_POSTGRES_URL,
 * so running that suite through `pnpm test:integration:postgres17` still only
 * exercises SQLite. Dialect-specific DDL and driver bugs (invalid junction DDL,
 * placeholder/param binding) hide there, so this suite drives the same fixes
 * directly against a real Postgres server. Follows the repo convention used by
 * builder-extend-pg.integration.test.ts: connect via `TEST_POSTGRES_URL`, skip
 * when unreachable, and self-clean the tables it creates.
 *
 * Exercises the same three fixes as the SQLite suite:
 *   1. generateJunctionTable() emits valid, single-statement DDL.
 *   2. getTargetCollection() falls back to field.options.target.
 *   3. insertManyToManyRelations binds created_at correctly for this dialect
 *      (a Date, not the SQLite epoch-seconds path).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { createAdapter } from "../../../../database/factory";
import type { DynamicCollectionService } from "../../../dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import type { Logger } from "../../../../services/shared";
import { CollectionRelationshipService } from "../collection-relationship-service";

// Minimal stub: insertManyToManyRelations only calls generateId() on the
// collectionService dependency (the fetch path is what needs a real
// fileManager/collectionService, covered separately by the SQLite
// full-service-boot suite).
const collectionServiceStub = {
  generateId: () => randomUUID(),
} as unknown as DynamicCollectionService;

// Skip ONLY when the Postgres-specific URL is unset; do not fall back to a
// generic URL, or this gate could silently run against a non-Postgres database.
const PG_URL = process.env.TEST_POSTGRES_URL ?? "";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// Fixed, dedicated table names for this gate — dropped before and after so
// reruns against the shared test database are idempotent (the sequential
// integration run, fileParallelism: false, is what makes this safe, same as
// other suites that touch fixed-name tables).
const POSTS_TABLE = "dc_m2m_gate_posts";
const TAGS_TABLE = "dc_m2m_gate_tags";
const JUNCTION_TABLE = "dc_m2m_gate_posts_dc_m2m_gate_tags_tags";

const m2mField = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "m2m_gate_tags" },
} as unknown as FieldDefinition;

async function connectIfAvailable(): Promise<Awaited<
  ReturnType<typeof createAdapter>
> | null> {
  if (!PG_URL) return null;
  process.env.DB_DIALECT = "postgresql";
  // env.ts validates DATABASE_URL against DB_DIALECT the first time ANY
  // env.* property is read in this worker (it caches after that first read),
  // and createAdapter's pool-defaults layering reads env.DB_POOL_MAX
  // unconditionally. Passing `url` directly in the createAdapter config
  // isn't enough to satisfy that validation — DATABASE_URL must also be set
  // on process.env, or the validation throws regardless of run order.
  process.env.DATABASE_URL = PG_URL;
  // When the URL IS configured, a connection failure must surface (fail the
  // suite), not be swallowed into a skip that would hide a broken database.
  const adapter = await createAdapter({
    type: "postgresql",
    url: PG_URL,
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

const adapter = await connectIfAvailable();
const describePg = adapter ? describe : describe.skip;

async function dropFixtureTables(): Promise<void> {
  if (!adapter) return;
  // Junction first: it holds the FKs to the base tables.
  await adapter.executeQuery(`DROP TABLE IF EXISTS ${JUNCTION_TABLE} CASCADE`);
  await adapter.executeQuery(`DROP TABLE IF EXISTS ${POSTS_TABLE} CASCADE`);
  await adapter.executeQuery(`DROP TABLE IF EXISTS ${TAGS_TABLE} CASCADE`);
}

beforeAll(async () => {
  await dropFixtureTables();
});

afterAll(async () => {
  if (!adapter) return;
  await dropFixtureTables();
  await adapter.disconnect();
});

describePg(
  "CollectionRelationshipService many-to-many junction writes (Postgres dialect gate)",
  () => {
    it("creates valid junction DDL, inserts a link, and deletes it, on real Postgres", async () => {
      const a = adapter!;
      const schemaService = new DynamicCollectionSchemaService(
        undefined,
        "postgresql"
      );

      // Base tables: reuse the product DDL generator (no user fields) so the
      // id/title/slug/timestamp columns match exactly what the junction FK
      // expects.
      const tagsDdl = schemaService.generateMigrationSQL(TAGS_TABLE, []);
      const postsDdl = schemaService.generateMigrationSQL(POSTS_TABLE, []);
      for (const stmt of [tagsDdl, postsDdl]) {
        for (const statement of stmt
          .split("--> statement-breakpoint")
          .map(s => s.trim())
          .filter(Boolean)) {
          await a.executeQuery(statement);
        }
      }

      // Junction table — this is bug #1's fix under direct test: on the
      // pre-fix code this DDL contained an orphaned CONSTRAINT fragment and
      // failed to execute at all.
      const junctionDdl = schemaService.generateJunctionTable(
        POSTS_TABLE,
        m2mField
      );
      for (const statement of junctionDdl
        .split("--> statement-breakpoint")
        .map(s => s.trim())
        .filter(Boolean)) {
        await a.executeQuery(statement);
      }

      const tagId = "pg-tag-1";
      const postId = "pg-post-1";
      await a.executeQuery(
        `INSERT INTO ${TAGS_TABLE} (id, title, slug) VALUES ('${tagId}', 'JavaScript', 'javascript')`
      );
      await a.executeQuery(
        `INSERT INTO ${POSTS_TABLE} (id, title, slug) VALUES ('${postId}', 'Hello', 'hello')`
      );

      // fileManager/collectionService are unused by insert/delete (only the
      // fetch path resolves the target schema through them), so stubs are
      // fine here — see collection-relationship-service.m2m.integration.test.ts
      // for the fetch-path assertion under the full service boot.
      const rel = new CollectionRelationshipService(
        a,
        silentLogger,
        {} as never,
        collectionServiceStub
      );

      // Bug #2 under direct test: this field only carries options.target,
      // never relationTo, so without the fallback this resolves no target
      // and silently no-ops instead of inserting.
      await rel.insertManyToManyRelations("m2m_gate_posts", postId, m2mField, [
        tagId,
      ]);

      const rows = await a.executeQuery<{
        id: string;
        m2m_gate_posts_id: string;
        m2m_gate_tags_id: string;
      }>(
        `SELECT id, m2m_gate_posts_id, m2m_gate_tags_id FROM ${JUNCTION_TABLE} WHERE m2m_gate_posts_id = '${postId}'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].m2m_gate_posts_id).toBe(postId);
      expect(rows[0].m2m_gate_tags_id).toBe(tagId);

      await rel.deleteManyToManyRelations("m2m_gate_posts", postId, m2mField);

      const afterDelete = await a.executeQuery<{ id: string }>(
        `SELECT id FROM ${JUNCTION_TABLE} WHERE m2m_gate_posts_id = '${postId}'`
      );
      expect(afterDelete).toHaveLength(0);
    });
  }
);
