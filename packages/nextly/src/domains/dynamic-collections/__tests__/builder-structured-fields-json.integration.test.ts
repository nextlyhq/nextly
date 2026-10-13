/**
 * A repeater or group on a table the Schema Builder creates is stored in the dialect's JSON type,
 * the type the schema diff compares the table against.
 *
 * The Builder's own DDL (`DynamicCollectionSchemaService`) creates Builder collections and singles,
 * and the singles the CLI's sync creates. It stored a repeater or group as `text` while the
 * descriptor, which the diff and the runtime table both read, names `jsonb` on PostgreSQL and
 * `json` on MySQL. So every such table previewed as needing a type change it never asked for, and
 * `db:sync` offered to convert it.
 *
 * Two halves: the table the generator creates previews as unchanged, on the two dialects where the
 * types differ (SQLite stores JSON as text either way); and a value written through the Direct API
 * reads back as written, on every dialect this process can reach, so the column change is not
 * paid for with the data.
 */
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../database/__tests__/integration/helpers/test-db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { previewDesiredSchema } from "../../schema/pipeline/preview";
import type { DesiredSchema } from "../../schema/pipeline/types";
import type { SingleMetadataService } from "../../singles/services/single-metadata-service";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

const PG = makeTestContext("postgresql");
const MYSQL = makeTestContext("mysql");

const FIELDS: FieldDefinition[] = [
  { name: "headline", type: "text" },
  {
    name: "hero",
    type: "group",
    fields: [{ name: "title", type: "text" }],
  } as FieldDefinition,
  {
    name: "links",
    type: "repeater",
    fields: [{ name: "url", type: "text" }],
  } as FieldDefinition,
];

/** The desired schema the diff builds for this Builder single. */
function builderSingle(tableName: string): DesiredSchema {
  return {
    collections: {},
    singles: {
      site: {
        slug: "site",
        tableName,
        fields: FIELDS as never,
        builderOwned: true,
      },
    },
    components: {},
  };
}

/** The Builder's own DDL for the single, as statements. */
function builderDdl(
  dialect: "postgresql" | "mysql",
  tableName: string
): string[] {
  return new DynamicCollectionSchemaService(undefined, dialect)
    .generateMigrationSQL(tableName, FIELDS, { isSingle: true })
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

/**
 * The diff's column operations. Index operations are left out, as in the pipeline's own
 * convergence suite: a type disagreement shows up on the column.
 */
function columnOperations(
  operations: readonly { type: string }[]
): readonly { type: string }[] {
  return operations.filter(op => !op.type.endsWith("_index"));
}

describe.skipIf(!PG.url)(
  "a Builder single's repeater and group (postgres)",
  () => {
    // `single_` first: the diff reads a table as a Single by that prefix, and a Single has no owner
    // column, so a name that hid it would be judged as a collection and asked for one.
    const tableName = `single_${PG.prefix}_site`;
    let pool: Pool;
    let db: ReturnType<typeof drizzlePg>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: PG.url ?? "" });
      db = drizzlePg({ client: pool });
      await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
    });

    afterAll(async () => {
      await db.execute(`DROP TABLE IF EXISTS "${tableName}"`);
      await pool.end();
    });

    it("previews as unchanged once the Builder's own DDL creates it", async () => {
      for (const statement of builderDdl("postgresql", tableName)) {
        await db.execute(statement);
      }

      const preview = await previewDesiredSchema({
        desired: builderSingle(tableName),
        db,
        dialect: "postgresql",
      });

      expect(columnOperations(preview.operations)).toEqual([]);
    });
  }
);

describe.skipIf(!MYSQL.url)(
  "a Builder single's repeater and group (mysql)",
  () => {
    // `single_` first, as above.
    const tableName = `single_${MYSQL.prefix}_site`;
    let pool: MysqlPool;
    let db: ReturnType<typeof drizzleMysql<Record<string, never>, MysqlPool>>;

    beforeAll(async () => {
      pool = createPool({ uri: MYSQL.url ?? "" });
      db = drizzleMysql({ client: pool });
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
    });

    afterAll(async () => {
      await pool.promise().query(`DROP TABLE IF EXISTS \`${tableName}\``);
      await new Promise<void>(resolve => pool.end(() => resolve()));
    });

    it("previews as unchanged once the Builder's own DDL creates it", async () => {
      for (const statement of builderDdl("mysql", tableName)) {
        await pool.promise().query(statement);
      }

      const preview = await previewDesiredSchema({
        desired: builderSingle(tableName),
        db,
        dialect: "mysql",
      });

      expect(columnOperations(preview.operations)).toEqual([]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a Builder single's repeater and group keep their values (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    it("reads back a group and a repeater as they were written", async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      const metadata = handle.getService(
        "singleMetadataService" as never
      ) as unknown as SingleMetadataService;
      await metadata.createSingle({
        slug: "site",
        label: "Site",
        tableName: "single_site",
        fields: FIELDS,
        source: "ui",
        locked: false,
        schemaHash: "builder-structured-fields",
        schemaVersion: 1,
      } as never);

      const written = {
        headline: "Hello",
        hero: { title: "Welcome" },
        links: [{ url: "https://example.com" }, { url: "https://example.org" }],
      };
      await handle.nextly.updateSingle({
        slug: "site",
        data: written,
      } as never);
      const read = (await handle.nextly.findSingle({
        slug: "site",
      } as never)) as Record<string, unknown>;

      expect(read.hero).toEqual(written.hero);
      expect(read.links).toEqual(written.links);
    });
  }
);
