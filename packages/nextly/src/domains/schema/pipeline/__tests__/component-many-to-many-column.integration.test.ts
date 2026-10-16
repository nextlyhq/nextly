/**
 * A component holding a many-to-many relation must preview as unchanged once it has been pushed.
 *
 * The push writes the component's physical table from the field-group schema service, which gives a
 * relation field a column. The diff's desired table is built from the column descriptor, which gives
 * a many-to-many no column because its links live in a junction table. When the two disagree, the
 * next preview plans to drop the column the push just created, and every later apply repeats it.
 *
 * Asserted across the two halves: push, then compare the desired shape with the live introspection.
 */
import Database from "better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { introspectLiveSnapshot } from "../diff/introspect-live";
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
const MYSQL = makeTestContext("mysql");
const PG_URL = PG.url ?? "";
const MYSQL_URL = MYSQL.url ?? "";

/** A component whose fields hold a plain text field and a many-to-many. */
function componentDesired(tableName: string, required = false): DesiredSchema {
  return {
    collections: {},
    singles: {},
    components: {
      hero: {
        slug: "hero",
        tableName,
        fields: [
          { name: "title", type: "text" },
          // The Builder states a many-to-many's target on `options`, not on `relationTo`.
          {
            name: "tags",
            type: "relationship",
            required,
            options: { relationType: "manyToMany", target: "tags" },
          },
        ] as never,
      },
    },
  };
}

/**
 * Everything the diff reports about columns. Index operations are excluded: a freshly created table
 * genuinely lacks its secondary indexes, which is a separate known gap, not what this suite pins.
 */
function columnOperations(
  operations: readonly { type: string }[]
): readonly { type: string }[] {
  return operations.filter(op => !op.type.endsWith("_index"));
}

function makePipeline(
  dialect: "postgresql" | "mysql" | "sqlite",
  db: unknown
): PushSchemaPipeline {
  return new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: noopRenameDetector,
    classifier: noopClassifier,
    promptDispatcher: noopPromptDispatcher,
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: noopPreCleanupExecutor,
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
}

describe("component with a many-to-many converges (sqlite)", () => {
  const tableName = "comp_sqlite_m2m_hero";

  it("previews as unchanged after the push creates its table", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzleSqlite({ client: sqlite });
    const desired = componentDesired(tableName);

    const applied = await makePipeline("sqlite", db).apply({
      desired,
      db,
      dialect: "sqlite",
      source: "ui",
      promptChannel: "browser",
      uiTargetSlug: "hero",
      uiTargetKind: "component",
    });
    expect(applied.success).toBe(true);

    const live = await introspectLiveSnapshot(db, "sqlite", [tableName]);
    expect(
      live.tables.find(t => t.name === tableName)?.columns.map(c => c.name)
    ).toContain("tags");

    const preview = await previewDesiredSchema({
      desired,
      db,
      dialect: "sqlite",
    });
    expect(columnOperations(preview.operations)).toEqual([]);
    sqlite.close();
  });

  it("previews as unchanged for a required many-to-many", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzleSqlite({ client: sqlite });
    const desired = componentDesired(`${tableName}_req`, true);

    const applied = await makePipeline("sqlite", db).apply({
      desired,
      db,
      dialect: "sqlite",
      source: "ui",
      promptChannel: "browser",
      uiTargetSlug: "hero",
      uiTargetKind: "component",
    });
    expect(applied.success).toBe(true);

    const preview = await previewDesiredSchema({
      desired,
      db,
      dialect: "sqlite",
    });
    expect(columnOperations(preview.operations)).toEqual([]);
    sqlite.close();
  });
});

describe.skipIf(!PG_URL)(
  "component with a many-to-many converges (postgres)",
  () => {
    const tableName = `${PG.prefix}_comp_hero`;
    let pool: Pool;
    let db: ReturnType<typeof drizzlePg>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: PG_URL });
      db = drizzlePg({ client: pool });
      await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
    });

    afterAll(async () => {
      await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
      await pool.end();
    });

    it("previews as unchanged after the push creates its table", async () => {
      const desired = componentDesired(tableName);

      const applied = await makePipeline("postgresql", db).apply({
        desired,
        db,
        dialect: "postgresql",
        source: "ui",
        promptChannel: "browser",
        uiTargetSlug: "hero",
        uiTargetKind: "component",
      });
      expect(applied.success).toBe(true);

      const live = await introspectLiveSnapshot(db, "postgresql", [tableName]);
      expect(
        live.tables.find(t => t.name === tableName)?.columns.map(c => c.name)
      ).toContain("tags");

      const preview = await previewDesiredSchema({
        desired,
        db,
        dialect: "postgresql",
      });
      expect(columnOperations(preview.operations)).toEqual([]);
    });

    it("previews as unchanged for a required many-to-many", async () => {
      const requiredTable = `${PG.prefix}_comp_hero_req`;
      await db.execute(`DROP TABLE IF EXISTS "${requiredTable}"`);
      const desired = componentDesired(requiredTable, true);

      const applied = await makePipeline("postgresql", db).apply({
        desired,
        db,
        dialect: "postgresql",
        source: "ui",
        promptChannel: "browser",
        uiTargetSlug: "hero",
        uiTargetKind: "component",
      });
      expect(applied.success).toBe(true);

      const preview = await previewDesiredSchema({
        desired,
        db,
        dialect: "postgresql",
      });
      expect(columnOperations(preview.operations)).toEqual([]);
      await db.execute(`DROP TABLE IF EXISTS "${requiredTable}"`);
    });
  }
);

describe.skipIf(!MYSQL_URL)(
  "component with a many-to-many converges (mysql)",
  () => {
    const tableName = `${MYSQL.prefix}_comp_hero`;
    let pool: MysqlPool;
    let db: ReturnType<typeof drizzleMysql<Record<string, never>, MysqlPool>>;

    beforeAll(async () => {
      pool = createPool({ uri: MYSQL_URL });
      db = drizzleMysql({ client: pool });
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
    });

    afterAll(async () => {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
      await new Promise<void>(res => pool.end(() => res()));
    });

    it("previews as unchanged after the push creates its table", async () => {
      const desired = componentDesired(tableName);

      const applied = await makePipeline("mysql", db).apply({
        desired,
        db,
        dialect: "mysql",
        source: "ui",
        promptChannel: "browser",
        databaseName: new URL(MYSQL_URL).pathname.slice(1),
        uiTargetSlug: "hero",
        uiTargetKind: "component",
      });
      expect(applied.success).toBe(true);

      const live = await introspectLiveSnapshot(db, "mysql", [tableName]);
      expect(
        live.tables.find(t => t.name === tableName)?.columns.map(c => c.name)
      ).toContain("tags");

      const preview = await previewDesiredSchema({
        desired,
        db,
        dialect: "mysql",
      });
      expect(columnOperations(preview.operations)).toEqual([]);
    });
  }
);
