/**
 * A component created in a push that also adds a foreign key must preview as unchanged.
 *
 * A foreign key is outside the fast path, so the whole push is applied by drizzle-kit, and drizzle-kit
 * creates the component table from the runtime schema. The desired table must name the same column
 * type that route writes, or the next preview proposes a conversion on a table nobody changed.
 */
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { previewDesiredSchema } from "../preview";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import type { DesiredSchema } from "../types";

const PG = makeTestContext("postgresql");
const PG_URL = PG.url ?? "";

function makePipeline(db: unknown): PushSchemaPipeline {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor("postgresql", db),
    renameDetector: noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
}

/** Column operations only: index operations belong to a separate, known gap. */
function columnOperations(
  operations: readonly { type: string }[]
): readonly { type: string }[] {
  return operations.filter(op => !op.type.endsWith("_index"));
}

describe.skipIf(!PG_URL)(
  "component many-to-many via the drizzle-kit route (postgres)",
  () => {
    const authors = `${PG.prefix}_authors`;
    const posts = `${PG.prefix}_posts`;
    const hero = `${PG.prefix}_comp_hero`;
    let pool: Pool;
    let db: ReturnType<typeof drizzlePg>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: PG_URL });
      db = drizzlePg({ client: pool });
      for (const t of [hero, posts, authors]) {
        await db.execute(`DROP TABLE IF EXISTS "${t}" CASCADE`);
      }
    });

    afterAll(async () => {
      for (const t of [hero, posts, authors]) {
        await db.execute(`DROP TABLE IF EXISTS "${t}" CASCADE`);
      }
      await pool.end();
    });

    it("previews the component table as unchanged after a foreign-key push creates it", async () => {
      const before: DesiredSchema = {
        collections: {
          authors: {
            slug: "authors",
            tableName: authors,
            fields: [{ name: "name", type: "text" }] as never,
          },
          posts: {
            slug: "posts",
            tableName: posts,
            fields: [{ name: "title", type: "text" }] as never,
          },
        },
        singles: {},
        components: {},
      };
      const seeded = await makePipeline(db).apply({
        desired: before,
        db,
        dialect: "postgresql",
        source: "ui",
        promptChannel: "browser",
        uiTargetSlug: "posts",
        uiTargetKind: "collection",
      });
      expect(seeded.success).toBe(true);

      // The relation adds a foreign key (outside the fast path) and the component is new.
      const after: DesiredSchema = {
        collections: {
          authors: before.collections.authors,
          posts: {
            slug: "posts",
            tableName: posts,
            fields: [
              { name: "title", type: "text" },
              { name: "author", type: "relationship", relationTo: "authors" },
            ] as never,
          },
        },
        singles: {},
        components: {
          hero: {
            slug: "hero",
            tableName: hero,
            fields: [
              { name: "title", type: "text" },
              {
                name: "tags",
                type: "relationship",
                options: { target: "tags", relationType: "manyToMany" },
              },
            ] as never,
          },
        },
      };
      const applied = await makePipeline(db).apply({
        desired: after,
        db,
        dialect: "postgresql",
        source: "ui",
        promptChannel: "browser",
        uiTargetSlug: "hero",
        uiTargetKind: "component",
      });
      expect(applied.success).toBe(true);

      const preview = await previewDesiredSchema({
        desired: after,
        db,
        dialect: "postgresql",
      });
      const heroOperations = columnOperations(preview.operations).filter(op =>
        JSON.stringify(op).includes(hero)
      );
      expect(heroOperations).toEqual([]);
    });
  }
);
