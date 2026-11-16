/**
 * An indexed text column with no length limit is created, and indexed, on every road and dialect.
 *
 * MySQL refuses a plain index on a TEXT column (error 1170, "BLOB/TEXT column used in key
 * specification without a key length"), so there the index keys the column's first 191 characters;
 * PostgreSQL and SQLite index the whole value. Each road's own statements are run against the
 * database and the index is read back from its catalog:
 *
 * - the Schema Builder creating a collection, and a component;
 * - the user extension table, for a custom user field;
 * - a migration file adding the index to a table that exists;
 * - the dev push replaying an index drizzle-kit never creates, as it does for a field added to a
 *   table that exists.
 *
 * A control on MySQL runs the whole-column spelling and watches it refused, so the prefix is what
 * these tests depend on rather than an incidental spelling.
 */
import { randomBytes } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../__tests__/helpers/fresh-database";
import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { UserFieldConfig } from "../../../users";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../field-groups/services/field-group-schema-service";
import { UserExtSchemaService } from "../../users/services/user-ext-schema-service";
import { splitSqlStatements } from "../migrate/split-sql";
import type { AddIndexOp, TableSpec } from "../pipeline/diff/types";
import { indexRestoreStatements } from "../pipeline/index-restore";
import { generateStatements } from "../pipeline/sql-templates";

import { readTableDefinition } from "./helpers/table-definition";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
}

const DIALECTS: {
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}[] = [
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
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** An unbounded text field asking to be indexed, beside one that does not. */
const FIELDS = [
  { name: "heading", type: "text", maxLength: 100 },
  { name: "note", type: "text", index: true },
];

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`an indexed unbounded text column (${entry.dialect})`, () => {
    const { dialect } = entry;
    /**
     * How the catalog reports the index's key: by prefix on MySQL, whole elsewhere. SQLite's
     * reader names each key part with its collation, the default `BINARY` here.
     */
    const key = {
      mysql: "note(191)",
      postgresql: "note",
      sqlite: "note BINARY",
    }[dialect];

    let adapter: TestAdapter;
    let scratch: ScratchDatabase | null = null;

    beforeEach(async () => {
      scratch =
        dialect === "sqlite"
          ? null
          : await createScratchDatabase(
              dialect,
              `textidx_${randomBytes(2).toString("hex")}`
            );
      adapter = entry.make(scratch?.url ?? entry.url ?? "");
      await adapter.connect();
    });

    afterEach(async () => {
      try {
        await adapter.disconnect();
      } finally {
        await scratch?.drop();
        scratch = null;
      }
    });

    /** Runs a road's SQL a statement at a time, as the migration runner splits it. */
    async function run(sql: string | readonly string[]): Promise<void> {
      const text = typeof sql === "string" ? sql : sql.join(";\n");
      for (const statement of splitSqlStatements(text, dialect)) {
        await adapter.executeQuery(statement);
      }
    }

    /** The key of each index on `table` whose name ends in `_note`. */
    async function noteIndexKeys(table: string): Promise<string[][]> {
      const definition = await readTableDefinition(
        statement => adapter.executeQuery(statement),
        dialect,
        table
      );
      return definition.indexes
        .filter(index => index.name.endsWith("_note"))
        .map(index => index.columns);
    }

    it("the Schema Builder creates a collection with it indexed", async () => {
      const table = "dc_textidx";
      await run(
        new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateMigrationSQL(table, FIELDS as FieldDefinition[])
      );
      expect(await noteIndexKeys(table)).toEqual([[key]]);
    });

    it("the Schema Builder creates a component with it indexed", async () => {
      const table = "comp_textidx";
      await run(
        new FieldGroupSchemaService(dialect).generateMigrationSQL(
          table,
          FIELDS as unknown as FieldConfig[]
        )
      );
      expect(await noteIndexKeys(table)).toEqual([[key]]);
    });

    it("the user extension table is created with a custom user field indexed", async () => {
      const sql = new UserExtSchemaService(
        dialect,
        undefined,
        silent
      ).generateMigrationSQL(FIELDS as unknown as UserFieldConfig[]);
      // The table's key to `users` is left out: this database has no `users` table, and the key
      // has nothing to do with the field's index.
      await run(
        splitSqlStatements(sql, dialect).filter(
          statement => !/FOREIGN KEY/i.test(statement)
        )
      );
      expect(await noteIndexKeys("user_ext")).toEqual([[key]]);
    });

    describe("adding the index to a table that exists", () => {
      const table: TableSpec = {
        name: "dc_textidx_later",
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          { name: "note", type: "text", nullable: true },
        ],
        indexes: [],
      };
      const addIndex: AddIndexOp = {
        type: "add_index",
        tableName: table.name,
        index: {
          name: "idx_dc_textidx_later_note",
          columns: ["note"],
          unique: false,
        },
      };

      beforeEach(async () => {
        await run(
          generateStatements([{ type: "add_table", table }], dialect, [table])
        );
      });

      it("a migration file adds it", async () => {
        await run(generateStatements([addIndex], dialect, [table]));
        expect(await noteIndexKeys(table.name)).toEqual([[key]]);
      });

      it("the dev push adds it", async () => {
        const desired = { tables: [{ ...table, indexes: [addIndex.index] }] };
        await run(indexRestoreStatements(desired, dialect, [], [addIndex]));
        expect(await noteIndexKeys(table.name)).toEqual([[key]]);
      });

      if (dialect === "mysql") {
        it("MySQL refuses the whole column as the key", async () => {
          await expect(
            adapter.executeQuery(
              `CREATE INDEX \`idx_dc_textidx_later_note\` ON \`${table.name}\` (\`note\`)`
            )
          ).rejects.toThrow(/key length|1170/i);
        });
      }
    });
  });
}
