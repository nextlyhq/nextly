/**
 * An existing component table's many-to-many column becomes the JSON list column, keeping every id.
 *
 * Tables created before the many-to-many was stored as a list hold it in a scalar column: `uuid`
 * (the creating SQL) or `text` (the drizzle-kit route) on PostgreSQL, `varchar(36)` on MySQL. Each
 * case here starts from that column with rows in it, in every shape a route could have written,
 * applies the current schema, and reads the rows back. A second apply must change nothing.
 *
 * The old table is made by pushing the current schema and then putting the old column type back,
 * so every other column already matches and the only operation planned is the conversion.
 */
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../../init/schema-snapshot-cache";
import { buildInverseOperations } from "../../migrate-create/down-generator";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import type { ChangeColumnTypeOp } from "../diff/types";
import { previewDesiredSchema } from "../preview";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import { referenceConversionStatements } from "../reference-list-conversion";
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

const A = "3fb954e4-f04c-4de6-b970-d16bf548688a";
const B = "16d6dfdf-bcd5-4408-a97b-df9e2547b30f";

function desiredFor(tableName: string, extraField = false): DesiredSchema {
  return {
    collections: {},
    singles: {},
    components: {
      hero: {
        slug: "hero",
        tableName,
        fields: [
          {
            name: "tags",
            type: "relationship",
            options: { relationType: "manyToMany", target: "tags" },
          },
          ...(extraField ? [{ name: "legacy", type: "text" }] : []),
        ] as never,
      },
    },
  };
}

/**
 * Forget the previous apply. The pipeline skips an apply whose desired schema equals the last one it
 * applied in this process, and the conversion is applied with the same schema the table was pushed
 * with; an upgrade, which changes the desired column, never meets that cache.
 */
function forgetPreviousApply(): void {
  clearCachedSnapshot();
  clearLiveSnapshots();
}

function makePipeline(
  dialect: "postgresql" | "mysql",
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

/**
 * The statements of the generated DOWN for this table's conversion from `fromType`, as a migration
 * file carries them: the inverse operation `migrate:create` builds, rendered by the conversion.
 */
function downStatements(
  dialect: "postgresql" | "mysql",
  tableName: string,
  fromType: string,
  toType: string
): string[] {
  const forward: ChangeColumnTypeOp = {
    type: "change_column_type",
    tableName,
    columnName: "tags",
    fromType,
    toType,
    nullable: true,
    fromNullable: true,
    conversion: "referenceList",
  };
  const [inverse] = buildInverseOperations([forward], {
    tables: [],
  }) as ChangeColumnTypeOp[];
  return referenceConversionStatements(inverse, dialect);
}

/** Rows of `id` and stored value, inserted with the component row's required system columns. */
function insertRows(
  tableName: string,
  quote: string,
  rows: readonly [string, string | null][]
): string {
  const q = (name: string): string => `${quote}${name}${quote}`;
  const values = rows
    .map(
      ([id, value]) =>
        `('${id}', 'p', 'pages', 'hero', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`})`
    )
    .join(", ");
  return (
    `INSERT INTO ${q(tableName)} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ` +
    `${q("_parent_field")}, ${q("created_at")}, ${q("updated_at")}, ${q("tags")}) VALUES ${values}`
  );
}

describe.skipIf(!PG.url)(
  "converting a PostgreSQL component many-to-many column",
  () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzlePg>;
    const tableName = `rl_${PG.prefix.slice(-10)}`;

    beforeAll(() => {
      pool = new Pool({ connectionString: PG.url ?? "" });
      db = drizzlePg({ client: pool });
    });

    afterAll(async () => {
      await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
      await pool.end();
    });

    /** A pushed table whose `tags` column is put back to `oldType`, holding `rows`. */
    async function oldTable(
      oldType: "uuid" | "text",
      rows: readonly [string, string | null][]
    ): Promise<void> {
      await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
      const pushed = await apply(desiredFor(tableName));
      expect(pushed.success).toBe(true);
      await pool.query(
        `ALTER TABLE "${tableName}" ALTER COLUMN "tags" TYPE ${oldType} USING NULL`
      );
      await pool.query(insertRows(tableName, '"', rows));
    }

    function apply(desired: DesiredSchema) {
      forgetPreviousApply();
      return makePipeline("postgresql", db).apply({
        desired,
        db,
        dialect: "postgresql",
        source: "ui",
        promptChannel: "browser",
        uiTargetSlug: "hero",
        uiTargetKind: "component",
      });
    }

    async function columnType(): Promise<string> {
      const result = await pool.query<{ udt_name: string }>(
        `SELECT udt_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tags'`,
        [tableName]
      );
      return result.rows[0]?.udt_name ?? "";
    }

    async function storedValues(): Promise<Record<string, unknown>> {
      const result = await pool.query<{ id: string; tags: unknown }>(
        `SELECT "id", "tags" FROM "${tableName}" ORDER BY "id"`
      );
      return Object.fromEntries(result.rows.map(row => [row.id, row.tags]));
    }

    async function plannedForTable(desired: DesiredSchema): Promise<unknown[]> {
      const preview = await previewDesiredSchema({
        desired,
        db,
        dialect: "postgresql",
      });
      return preview.operations.filter(
        op => (op as { tableName?: string }).tableName === tableName
      );
    }

    it("converts a uuid column, keeping each id as a one-item list", async () => {
      await oldTable("uuid", [
        ["r1", A],
        ["r2", null],
      ]);

      const converted = await apply(desiredFor(tableName));
      expect(converted.error).toBeUndefined();
      expect(await columnType()).toBe("jsonb");
      expect(await storedValues()).toEqual({ r1: [A], r2: null });

      expect(await plannedForTable(desiredFor(tableName))).toEqual([]);
    });

    it("converts a text column, reading every stored shape as a list", async () => {
      await oldTable("text", [
        ["r1", A],
        ["r2", `{"${A}","${B}"}`],
        ["r3", `["${A}","${B}"]`],
        ["r4", ""],
        ["r5", null],
        // One id the JSON serializer wrote into the column before it was converted.
        ["r6", `"${A}"`],
      ]);

      const converted = await apply(desiredFor(tableName));
      expect(converted.error).toBeUndefined();
      expect(await columnType()).toBe("jsonb");
      expect(await storedValues()).toEqual({
        r1: [A],
        r2: [A, B],
        r3: [A, B],
        r4: [],
        r5: null,
        r6: [A],
      });

      expect(await plannedForTable(desiredFor(tableName))).toEqual([]);
    });

    it("converts on the drizzle-kit route too, when the apply carries an operation the fast path cannot", async () => {
      // Pushed with an extra column first, so the apply that converts also drops it: a drop sends the
      // whole apply through drizzle-kit, which would otherwise cast the column itself and fail.
      await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
      expect((await apply(desiredFor(tableName, true))).success).toBe(true);
      await pool.query(
        `ALTER TABLE "${tableName}" ALTER COLUMN "tags" TYPE uuid USING NULL`
      );
      await pool.query(insertRows(tableName, '"', [["r1", A]]));

      const converted = await apply(desiredFor(tableName));
      expect(converted.error).toBeUndefined();
      expect(await columnType()).toBe("jsonb");
      expect(await storedValues()).toEqual({ r1: [A] });
    });

    it("refuses a column holding a malformed array literal, changing nothing", async () => {
      await oldTable("text", [
        ["r1", A],
        ["r2", `{"${A}`],
      ]);

      const refused = await apply(desiredFor(tableName));
      expect(refused.success).toBe(false);
      expect(JSON.stringify(refused.error)).toContain("COLUMN_NOT_CONVERTIBLE");
      expect(await columnType()).toBe("text");
      expect(await storedValues()).toEqual({ r1: A, r2: `{"${A}` });
    });

    it("rolls a converted uuid column back with its generated DOWN, keeping each id", async () => {
      await oldTable("uuid", [
        ["r1", A],
        ["r2", null],
      ]);
      expect((await apply(desiredFor(tableName))).error).toBeUndefined();
      await pool.query(
        `UPDATE "${tableName}" SET "tags" = '[]'::jsonb WHERE "id" = 'r2'`
      );

      for (const statement of downStatements(
        "postgresql",
        tableName,
        "uuid",
        "jsonb"
      )) {
        await pool.query(statement);
      }
      expect(await columnType()).toBe("uuid");
      expect(await storedValues()).toEqual({ r1: A, r2: null });
    });

    it("refuses the DOWN to a text column too when a row holds more than one id", async () => {
      await oldTable("text", [["r1", A]]);
      expect((await apply(desiredFor(tableName))).error).toBeUndefined();
      await pool.query(
        `UPDATE "${tableName}" SET "tags" = '["${A}","${B}"]'::jsonb`
      );

      const [statement] = downStatements(
        "postgresql",
        tableName,
        "text",
        "jsonb"
      );
      await expect(pool.query(statement)).rejects.toThrow(/more than one id/);
      expect(await columnType()).toBe("jsonb");
      expect(await storedValues()).toEqual({ r1: [A, B] });
    });

    it("refuses the DOWN when a row holds more than one id, changing nothing", async () => {
      await oldTable("uuid", [["r1", A]]);
      expect((await apply(desiredFor(tableName))).error).toBeUndefined();
      await pool.query(
        `UPDATE "${tableName}" SET "tags" = '["${A}","${B}"]'::jsonb`
      );

      const [statement] = downStatements(
        "postgresql",
        tableName,
        "uuid",
        "jsonb"
      );
      await expect(pool.query(statement)).rejects.toThrow();
      expect(await columnType()).toBe("jsonb");
      expect(await storedValues()).toEqual({ r1: [A, B] });
    });
  }
);

describe.skipIf(!MYSQL.url)(
  "converting a MySQL component many-to-many column",
  () => {
    let pool: MysqlPool;
    let db: ReturnType<typeof drizzleMysql<Record<string, never>, MysqlPool>>;
    const tableName = `rl_${MYSQL.prefix.slice(-10)}`;

    beforeAll(() => {
      pool = createPool({ uri: MYSQL.url ?? "" });
      db = drizzleMysql({ client: pool });
    });

    afterAll(async () => {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
      await new Promise<void>(resolve => pool.end(() => resolve()));
    });

    function apply(desired: DesiredSchema) {
      forgetPreviousApply();
      return makePipeline("mysql", db).apply({
        desired,
        db,
        dialect: "mysql",
        source: "ui",
        promptChannel: "browser",
        databaseName: new URL(MYSQL.url ?? "").pathname.slice(1),
        uiTargetSlug: "hero",
        uiTargetKind: "component",
      });
    }

    async function mysqlColumnType(): Promise<string | undefined> {
      const [typeRows] = await pool
        .promise()
        .query(
          `SELECT DATA_TYPE AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'tags'`,
          [tableName]
        );
      return (typeRows as { t: string }[])[0]?.t;
    }

    async function mysqlValues(): Promise<Record<string, unknown>> {
      const [rows] = await pool
        .promise()
        .query(`SELECT id, tags FROM \`${tableName}\` ORDER BY id`);
      return Object.fromEntries(
        (rows as { id: string; tags: unknown }[]).map(row => [row.id, row.tags])
      );
    }

    /** A pushed table whose `tags` column is put back to `oldType`, holding `rows`. */
    async function mysqlOldTable(
      oldType: string,
      rows: readonly [string, string | null][]
    ): Promise<void> {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
      expect((await apply(desiredFor(tableName))).success).toBe(true);
      await pool
        .promise()
        .query(
          `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`tags\` ${oldType} NULL`
        );
      await pool.promise().query(insertRows(tableName, "`", rows));
    }

    it("converts a text column holding a JSON-string id, without keeping its quotes", async () => {
      // A text column is where a conversion stopped part-way leaves the column, and a single id the
      // JSON serializer writes there is a JSON string.
      await mysqlOldTable("text", [
        ["r1", `"${A}"`],
        ["r2", A],
      ]);
      expect((await apply(desiredFor(tableName))).error).toBeUndefined();
      expect(await mysqlColumnType()).toBe("json");
      expect(await mysqlValues()).toEqual({ r1: [A], r2: [A] });
    });

    it("rolls a converted varchar(36) column back with its generated DOWN, keeping each id", async () => {
      await mysqlOldTable("varchar(36)", [
        ["r1", A],
        ["r2", ""],
        ["r3", null],
      ]);
      expect((await apply(desiredFor(tableName))).error).toBeUndefined();

      for (const statement of downStatements(
        "mysql",
        tableName,
        "varchar(36)",
        "json"
      )) {
        await pool.promise().query(statement);
      }
      expect(await mysqlColumnType()).toBe("varchar");
      expect(await mysqlValues()).toEqual({ r1: A, r2: null, r3: null });
    });

    it("refuses the DOWN before anything changes when a row holds more than one id", async () => {
      await mysqlOldTable("varchar(36)", [["r1", A]]);
      expect((await apply(desiredFor(tableName))).error).toBeUndefined();
      await pool
        .promise()
        .query(
          `UPDATE \`${tableName}\` SET \`tags\` = JSON_ARRAY('${A}', '${B}')`
        );

      const [guard] = downStatements("mysql", tableName, "varchar(36)", "json");
      await expect(pool.promise().query(guard)).rejects.toThrow();
      expect(await mysqlColumnType()).toBe("json");
      expect(await mysqlValues()).toEqual({ r1: [A, B] });
    });

    it("converts a varchar(36) column, keeping each id as a one-item list", async () => {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
      expect((await apply(desiredFor(tableName))).success).toBe(true);
      await pool
        .promise()
        .query(
          `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`tags\` varchar(36) NULL`
        );
      await pool.promise().query(
        insertRows(tableName, "`", [
          ["r1", A],
          ["r2", ""],
          ["r3", null],
        ])
      );

      const converted = await apply(desiredFor(tableName));
      expect(converted.error).toBeUndefined();

      const [typeRows] = await pool
        .promise()
        .query(
          `SELECT DATA_TYPE AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'tags'`,
          [tableName]
        );
      expect((typeRows as { t: string }[])[0]?.t).toBe("json");

      const [rows] = await pool
        .promise()
        .query(`SELECT id, tags FROM \`${tableName}\` ORDER BY id`);
      expect(
        Object.fromEntries(
          (rows as { id: string; tags: unknown }[]).map(row => [
            row.id,
            row.tags,
          ])
        )
      ).toEqual({ r1: [A], r2: [], r3: null });

      const preview = await previewDesiredSchema({
        desired: desiredFor(tableName),
        db,
        dialect: "mysql",
      });
      // Only the converted column: a component table pushed on MySQL still previews its timestamp
      // columns' type and defaults as changed, which is not this suite's subject.
      expect(
        preview.operations.filter(
          op =>
            (op as { tableName?: string }).tableName === tableName &&
            (op as { columnName?: string }).columnName === "tags"
        )
      ).toEqual([]);
    });
  }
);
