/**
 * A component table the creating SQL made, holding a many-to-many, previews as unchanged.
 *
 * The Builder creates a component's table with `FieldGroupSchemaService.generateMigrationSQL`, not
 * with the desired-table builder the preview compares against, so the two are independent
 * descriptions of one table. A many-to-many is the column they have disagreed on: its type (a JSON
 * list) and its nullability (nullable even when required). Built here through the creating SQL, so
 * a disagreement shows up as a planned operation for that column.
 */
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool } from "mysql2";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { previewDesiredSchema } from "../preview";
import type { DesiredSchema } from "../types";

type Dialect = "postgresql" | "mysql" | "sqlite";

const FIELDS = [
  { name: "title", type: "text", source: "ui" },
  {
    name: "tags",
    type: "relationship",
    source: "ui",
    options: { relationType: "manyToMany", target: "tags" },
  },
  {
    name: "topics",
    type: "relationship",
    required: true,
    source: "ui",
    options: { relationType: "manyToMany", target: "topics" },
  },
] as unknown as FieldConfig[];

function desiredFor(tableName: string): DesiredSchema {
  return {
    collections: {},
    singles: {},
    components: {
      hero: { slug: "hero", tableName, fields: FIELDS as never },
    },
  };
}

/** The creating SQL's statements, as the Builder runs them one at a time. */
function creatingStatements(dialect: Dialect, tableName: string): string[] {
  return new FieldGroupSchemaService(dialect)
    .generateMigrationSQL(tableName, FIELDS)
    .split("--> statement-breakpoint")
    .map(statement =>
      statement
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(statement => statement.length > 0);
}

interface Harness {
  db: unknown;
  run: (statement: string) => Promise<void>;
  close: () => Promise<void>;
}

/** The relation columns this suite pins. */
const RELATION_COLUMNS = new Set(["tags", "topics"]);

/**
 * What the preview plans for the many-to-many columns: a change to one of them, or an index over
 * one. The creator and the desired table still disagree about other columns of a component (the
 * system columns' defaults, the `created_at` index, a MySQL text field's width); those are not this
 * suite's subject, so they are left out rather than letting them hide or fake a result here.
 */
async function plannedFor(
  harness: Harness,
  dialect: Dialect,
  tableName: string
): Promise<unknown[]> {
  const preview = await previewDesiredSchema({
    desired: desiredFor(tableName),
    db: harness.db,
    dialect,
  });
  return preview.operations.filter(op => {
    const {
      tableName: table,
      columnName,
      index,
    } = op as {
      tableName?: string;
      columnName?: string;
      index?: { columns?: string[] };
    };
    if (table !== tableName) return false;
    if (columnName !== undefined) return RELATION_COLUMNS.has(columnName);
    return (index?.columns ?? []).some(column => RELATION_COLUMNS.has(column));
  });
}

async function expectCreatorTableConverges(
  harness: Harness,
  dialect: Dialect,
  tableName: string
): Promise<void> {
  await harness.run(`DROP TABLE IF EXISTS ${tableName}`);
  try {
    for (const statement of creatingStatements(dialect, tableName)) {
      await harness.run(statement);
    }
    expect(await plannedFor(harness, dialect, tableName)).toEqual([]);
  } finally {
    await harness.run(`DROP TABLE IF EXISTS ${tableName}`);
  }
}

const PG = makeTestContext("postgresql");
const MYSQL = makeTestContext("mysql");

describe("a creator-made component with a many-to-many (sqlite)", () => {
  it("previews as unchanged", async () => {
    const sqlite = new Database(":memory:");
    const harness: Harness = {
      db: drizzleSqlite({ client: sqlite }),
      run: statement => {
        sqlite.exec(statement);
        return Promise.resolve();
      },
      close: () => {
        sqlite.close();
        return Promise.resolve();
      },
    };
    await expectCreatorTableConverges(harness, "sqlite", "comp_m2m_creator");
    await harness.close();
  });
});

describe.skipIf(!PG.url)(
  "a creator-made component with a many-to-many (postgres)",
  () => {
    it("previews as unchanged", async () => {
      const pool = new Pool({ connectionString: PG.url ?? "" });
      const harness: Harness = {
        db: drizzlePg({ client: pool }),
        run: async statement => {
          await pool.query(statement);
        },
        close: () => pool.end(),
      };
      try {
        await expectCreatorTableConverges(
          harness,
          "postgresql",
          `cm_${PG.prefix.slice(-10)}`
        );
      } finally {
        await harness.close();
      }
    });
  }
);

describe.skipIf(!MYSQL.url)(
  "a creator-made component with a many-to-many (mysql)",
  () => {
    it("previews as unchanged", async () => {
      const pool = createPool({ uri: MYSQL.url ?? "" });
      const harness: Harness = {
        db: drizzleMysql({ client: pool }),
        run: async statement => {
          await pool.promise().query(statement);
        },
        close: () => new Promise<void>(resolve => pool.end(() => resolve())),
      };
      try {
        await expectCreatorTableConverges(
          harness,
          "mysql",
          `cm_${MYSQL.prefix.slice(-10)}`
        );
      } finally {
        await harness.close();
      }
    });
  }
);
