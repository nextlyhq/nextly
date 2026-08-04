/**
 * The declared width on a runtime table is observed by DDL and by nothing else.
 *
 * `generateRuntimeSchema` feeds two very different consumers. One hands its result to drizzle-kit,
 * which renders it as `CREATE` / `ALTER`, so there the declared width IS the column. Every other
 * caller registers it so a query can look a table up by name, and those callers do not state which
 * builder made the table — they take the reading that a query cannot observe.
 *
 * That second half is an assumption about Drizzle, and this suite is the evidence for it. One
 * physical column is described twice, at two different declared widths, and a value longer than
 * either is written and read back through both descriptions. If Drizzle enforced a declared
 * `varchar(n)` on the way in or out, the narrower description would truncate or reject and the two
 * would disagree.
 *
 * The physical table is created by the production creator rather than by hand, so the fixture
 * cannot quietly declare a column shape the product does not build.
 *
 * Self-skips when the dialect's URL is unset. SQLite is not covered: it has one string type, so it
 * cannot express the disagreement this suite exists to test.
 */

import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { splitStatements } from "../../pipeline/sql-statement-utils";
import { generateRuntimeSchema } from "../runtime-schema-generator";

/** The adapter surface these tests drive. */
interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getDrizzle(): unknown;
}

/**
 * The two columns this suite reads off a generated table.
 *
 * Read as properties, which is how Drizzle is written against everywhere else — `eq(users.id, x)`.
 * The bulk column-map helper the ORM also offers would answer the same question and is refused by
 * the v1 legacy gate: it is deprecated but still compiles, so that gate is the only thing that
 * catches it.
 */
interface ProbeColumns {
  id: unknown;
  body: { getSQLType(): string };
}

const columnsOf = (table: unknown): ProbeColumns => table as ProbeColumns;

/** The minimum of Drizzle's query builder this suite uses. */
interface QueryDb {
  insert(table: unknown): {
    values(row: Record<string, unknown>): Promise<unknown>;
  };
  select(): {
    from(table: unknown): {
      where(condition: unknown): Promise<Record<string, unknown>[]>;
    };
  };
}

const DIALECTS: Array<{
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}> = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
  },
];

// What the physical table is built from: a plain text field, which every builder creates unbounded.
// The column can therefore hold the long value below, and any refusal comes from the ORM.
const CREATED_FIELDS: FieldDefinition[] = [
  { name: "body", type: "text" } as FieldDefinition,
];

// What the runtime table is described from. The variant and width are read by the collection
// creator and by neither other builder, so naming a builder here changes the declared column while
// the physical one stays exactly as it was created. That mismatch is the situation under test: it
// is what a query path gets when it does not know, and cannot know, which builder made the table.
const DESCRIBED_FIELDS: FieldDefinition[] = [
  {
    name: "body",
    type: "text",
    options: { variant: "short" },
    validation: { maxLength: 120 },
  } as FieldDefinition,
];

// Longer than either declared bound, so a bound that were enforced would be visible.
const LONG_VALUE = "x".repeat(1000);

for (const entry of DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`a declared width on the query path — ${entry.dialect}`, () => {
    let adapter: TestAdapter;
    let db: QueryDb;
    // Per-run name so this can never collide with a real table in a shared database.
    const tableName = `dc_w${randomBytes(6).toString("hex")}`;
    const quoted =
      entry.dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;

    beforeAll(async () => {
      adapter = entry.make(entry.url as string);
      await adapter.connect();
      db = adapter.getDrizzle() as QueryDb;

      // Built by the production creator, so the physical column is whatever the Schema Builder
      // actually makes for this declaration rather than whatever this file would have assumed.
      const createSql = new DynamicCollectionSchemaService(
        undefined,
        entry.dialect
      ).generateMigrationSQL(tableName, CREATED_FIELDS, { hasStatus: false });

      // The creator emits its index statements behind the kit's breakpoint markers, so the
      // production splitter runs here too rather than a lexical one.
      for (const statement of splitStatements([createSql])) {
        await adapter.executeQuery(statement);
      }
    }, 30000);

    afterAll(async () => {
      await adapter.executeQuery(`DROP TABLE IF EXISTS ${quoted}`);
      await adapter.disconnect();
    });

    // Both descriptions of the one physical table, differing only in which builder they name.
    const describedAs = (builtBy: "collection" | "codeFirst") =>
      generateRuntimeSchema(tableName, DESCRIBED_FIELDS, entry.dialect, {
        builtBy,
        status: false,
      }).table;

    it("describes the same column two different ways", () => {
      // Without this the round-trip below would prove nothing: it would be running the same
      // declaration twice.
      const columnType = (builtBy: "collection" | "codeFirst") =>
        columnsOf(describedAs(builtBy)).body.getSQLType();

      expect(columnType("collection")).not.toBe(columnType("codeFirst"));
    });

    it("writes and reads a value past the bound through either description", async () => {
      // The collection reading is the narrower of the two on both dialects: it takes the declared
      // 120 where the code-first reading takes this module's own default.
      const narrow = describedAs("collection");
      const wide = describedAs("codeFirst");

      const idOf = (table: unknown) => columnsOf(table).id;

      // `title` and `slug` are NOT NULL system columns the creator injects into every collection
      // table, so a row has to carry them whichever description writes it.
      const row = (id: string) => ({
        id,
        title: id,
        slug: id,
        body: LONG_VALUE,
      });

      // Written through the description declaring the narrower bound the value exceeds.
      await db.insert(narrow).values(row("narrow-write"));
      // And through the other, so neither direction is left untested.
      await db.insert(wide).values(row("wide-write"));

      const readBack = async (table: unknown, id: string) => {
        const rows = await db
          .select()
          .from(table)
          .where(eq(idOf(table) as never, id));
        return (rows[0] as { body: string }).body;
      };

      // Four combinations of write description and read description, all of the same length as
      // what was written: the declared width is not enforced by the ORM on either side.
      expect({
        narrowWriteNarrowRead: (await readBack(narrow, "narrow-write")).length,
        narrowWriteWideRead: (await readBack(wide, "narrow-write")).length,
        wideWriteNarrowRead: (await readBack(narrow, "wide-write")).length,
        wideWriteWideRead: (await readBack(wide, "wide-write")).length,
      }).toEqual({
        narrowWriteNarrowRead: LONG_VALUE.length,
        narrowWriteWideRead: LONG_VALUE.length,
        wideWriteNarrowRead: LONG_VALUE.length,
        wideWriteWideRead: LONG_VALUE.length,
      });
    }, 30000);
  });
}
