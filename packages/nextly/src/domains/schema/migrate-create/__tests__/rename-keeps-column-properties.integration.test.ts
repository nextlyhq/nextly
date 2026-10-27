/**
 * A generated migration that renames a column, or changes its nullability or default, changes only
 * what it names, on every dialect, as `nextly migrate` applies it.
 *
 * The column carries what a site or a plugin can give it outside the schema: a comment where the
 * dialect has one, a collation other than the table's, and a check, beside the index the schema
 * declares. None of those is in the snapshot a migration file is written from, so a statement
 * written from the snapshot alone loses them: MySQL's MODIFY restates the whole column and drops
 * what it leaves out, MySQL refuses to rename a column a check uses, and SQLite can only change a
 * column's nullability or default by rebuilding the table from the snapshot.
 *
 * Each case reads the table's whole definition from the database before and after, and requires
 * the after to be the before with only the named change applied (`helpers/table-definition.ts`),
 * so a property nobody listed here is held too. A SQLite rebuild that cannot keep a collation must
 * refuse, say why, and leave the table as it was.
 *
 * A default the schema declares is used for the default cases: a collection field's default is the
 * application's, never the column's, and `nextly migrate` refuses a database whose column carries
 * one the snapshot does not record, as drift. Each case runs on a database of its own for the same
 * reason.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import {
  readTableDefinition,
  withNamedChange,
  type NamedChange,
  type TableDefinition,
} from "../../__tests__/helpers/table-definition";
import { reconcileCore } from "../../migrate/core-reconcile";
import type { TableSpec } from "../../pipeline/diff/types";
import type { AppStreamTables } from "../app-stream";
import { generateMigration, type MinimalConfigField } from "../generate";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
  getDrizzle<T = unknown>(): T;
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

const quiet = createLogger({ quiet: true });

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(
    `a generated column change keeps what it does not name (${entry.dialect})`,
    () => {
      const { dialect } = entry;
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      let adapter: TestAdapter;
      let scratch: ScratchDatabase | null = null;
      let dir: string;
      let made = 0;

      beforeEach(async () => {
        made = 0;
        scratch =
          dialect === "sqlite"
            ? null
            : await createScratchDatabase(
                dialect,
                `keeps_${randomBytes(2).toString("hex")}`
              );
        adapter = entry.make(scratch?.url ?? entry.url ?? "");
        await adapter.connect();
        // What `nextly migrate` creates first: the ledger and the owner registry.
        await reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
        });
        dir = await mkdtemp(join(tmpdir(), "nextly-keeps-column-"));
      });

      afterEach(async () => {
        try {
          await adapter.disconnect();
        } finally {
          await scratch?.drop();
          scratch = null;
          await rm(dir, { recursive: true, force: true });
        }
      });

      const exec = (sql: string) => adapter.executeQuery(sql);
      const definitionOf = (table: string): Promise<TableDefinition> =>
        readTableDefinition(
          statement => adapter.executeQuery(statement),
          dialect,
          table
        );

      /** `nextly migrate:create` for `posts` with these fields, and, when given, the app's table. */
      async function migrateCreate(
        fields: MinimalConfigField[],
        appStream?: AppStreamTables
      ): Promise<void> {
        made += 1;
        await generateMigration({
          name: `step_${made}`,
          dialect,
          migrationsDir: dir,
          collections: [{ slug: "posts", tableName: "dc_posts", fields }],
          singles: [],
          components: [],
          ...(appStream ? { appStream } : {}),
          nonInteractive: true,
          autoAcceptRenames: true,
          now: new Date(Date.UTC(2026, 9, 28, 12, made)),
        });
      }

      /** `nextly migrate`. */
      function migrate(): Promise<number> {
        return runFileMigrations({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir: dir,
          logger: quiet,
        });
      }

      /**
       * Gives `table.column` what the schema does not record: a comment, a collation other than the
       * table's and a check, where the dialect has each. `collation: false` leaves the collation off,
       * for the SQLite case that can be rebuilt.
       */
      async function decorate(
        table: string,
        column: string,
        type: string,
        options: { collation?: boolean; check?: boolean } = {}
      ): Promise<void> {
        const collation = options.collation !== false;
        const check = options.check !== false;
        if (dialect === "postgresql") {
          if (collation) {
            await exec(
              `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE ${type} COLLATE "C"`
            );
          }
          await exec(
            `COMMENT ON COLUMN ${q(table)}.${q(column)} IS 'kept by the change'`
          );
          await exec(
            `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(`${table}_short`)} CHECK (char_length(${q(column)}) <= 60)`
          );
          return;
        }
        if (dialect === "mysql") {
          const [current] = await adapter.executeQuery<{
            type: string;
            nullable: string;
            extra: string;
            dflt: string | null;
          }>(
            `SELECT COLUMN_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\` FROM information_schema.COLUMNS ` +
              `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`
          );
          const [dflt] = await adapter.executeQuery<{ dflt: string | null }>(
            `SELECT COLUMN_DEFAULT AS dflt FROM information_schema.COLUMNS ` +
              `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`
          );
          await exec(
            `ALTER TABLE ${q(table)} MODIFY COLUMN ${q(column)} ${current.type}` +
              (collation ? " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin" : "") +
              (current.nullable === "YES" ? " NULL" : " NOT NULL") +
              (dflt.dflt === null ? "" : ` DEFAULT '${dflt.dflt}'`) +
              " COMMENT 'kept by the change'"
          );
          await exec(
            `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(`${table}_short`)} CHECK (char_length(${q(column)}) <= 60)`
          );
          return;
        }
        // SQLite keeps a column's collation and checks only in its CREATE statement, so the column is
        // made again with them, its index dropped and put back around it. The table is empty here.
        const indexes = await adapter.executeQuery<{
          name: string;
          sql: string;
        }>(
          `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql LIKE '%"${column}"%'`
        );
        for (const index of indexes) await exec(`DROP INDEX ${q(index.name)}`);
        const [info] = await adapter.executeQuery<{ dflt: string | null }>(
          `SELECT dflt_value AS dflt FROM pragma_table_info('${table}') WHERE name = '${column}'`
        );
        await exec(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
        await exec(
          `ALTER TABLE ${q(table)} ADD COLUMN ${q(column)} ${type}` +
            (info.dflt === null ? "" : ` DEFAULT ${info.dflt}`) +
            (collation ? " COLLATE NOCASE" : "") +
            (check ? ` CHECK (length(${q(column)}) <= 60)` : "")
        );
        for (const index of indexes) await exec(index.sql);
      }

      /** The definition before, the change applied, and the definition after: only the change differs. */
      async function expectOnly(
        table: string,
        before: TableDefinition,
        change: NamedChange
      ): Promise<void> {
        expect(await definitionOf(table)).toEqual(
          withNamedChange(before, change)
        );
      }

      /**
       * A definition with its columns ordered by name. A SQLite rebuild declares its columns in the
       * snapshot's order, which is by name, so a renamed column takes its new name's place there;
       * those cases compare this way for that reason alone.
       */
      const byName = (definition: TableDefinition): TableDefinition => ({
        ...definition,
        columns: [...definition.columns].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      });

      const heading = (
        name: string,
        extra: Partial<MinimalConfigField> = {}
      ): MinimalConfigField[] => [
        { name, type: "text", index: true, ...extra },
        { name: "views", type: "number" },
      ];
      const text = dialect === "mysql" ? "varchar(255)" : "text";

      /** `posts`, built by a first migration, decorated, and holding one entry. */
      async function seededPosts(
        options: { collation?: boolean; check?: boolean } = {}
      ): Promise<TableDefinition> {
        await migrateCreate(heading("heading"));
        await migrate();
        await decorate("dc_posts", "heading", text, options);
        await exec(
          `INSERT INTO ${q("dc_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("heading")}) VALUES ('p1', 'One', 'one', 'Hello')`
        );
        return definitionOf("dc_posts");
      }

      async function headingOf(column: string): Promise<unknown> {
        const [row] = await adapter.executeQuery<{ value: unknown }>(
          `SELECT ${q(column)} AS value FROM ${q("dc_posts")} WHERE ${q("id")} = 'p1'`
        );
        return row?.value;
      }

      it("renames the column and changes nothing else", async () => {
        const before = await seededPosts();

        await migrateCreate(heading("title2"));
        await migrate();

        await expectOnly("dc_posts", before, {
          rename: { from: "heading", to: "title2" },
        });
        expect(await headingOf("title2")).toBe("Hello");
      });

      // SQLite makes a column NOT NULL by rebuilding its table, which the cases below cover.
      it.skipIf(dialect === "sqlite")(
        "renames the column and makes it NOT NULL, changing nothing else",
        async () => {
          const before = await seededPosts();

          await migrateCreate(heading("title2", { required: true }));
          await migrate();

          await expectOnly("dc_posts", before, {
            rename: { from: "heading", to: "title2" },
            column: "title2",
            nullable: false,
          });
          expect(await headingOf("title2")).toBe("Hello");
        }
      );

      it.skipIf(dialect === "sqlite")(
        "makes the column NOT NULL and changes nothing else",
        async () => {
          const before = await seededPosts();

          await migrateCreate(heading("heading", { required: true }));
          await migrate();

          await expectOnly("dc_posts", before, {
            column: "heading",
            nullable: false,
          });
        }
      );

      it.skipIf(dialect !== "sqlite")(
        "rebuilds a SQLite table to make the renamed column NOT NULL, keeping the rest of it",
        async () => {
          // Nothing outside the schema: a hand-made collation or check is refused, as the next cases
          // show, so what a rebuild CAN carry is the table the snapshot describes.
          await migrateCreate(heading("heading"));
          await migrate();
          await exec(
            `INSERT INTO ${q("dc_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("heading")}) VALUES ('p1', 'One', 'one', 'Hello')`
          );
          const before = await definitionOf("dc_posts");

          await migrateCreate(heading("title2", { required: true }));
          await migrate();

          expect(byName(await definitionOf("dc_posts"))).toEqual(
            byName(
              withNamedChange(before, {
                rename: { from: "heading", to: "title2" },
                column: "title2",
                nullable: false,
              })
            )
          );
          expect(await headingOf("title2")).toBe("Hello");
        }
      );

      it.skipIf(dialect !== "sqlite")(
        "refuses a SQLite rebuild that would lose a check the schema does not track",
        async () => {
          const before = await seededPosts({ collation: false });

          await migrateCreate(heading("heading", { required: true }));
          await expect(migrate()).rejects.toThrow(
            /would drop checks its schema does not track/
          );

          expect(await definitionOf("dc_posts")).toEqual(before);
        }
      );

      it.skipIf(dialect !== "sqlite")(
        "refuses a SQLite rebuild that would lose a collation, and leaves the table as it was",
        async () => {
          const before = await seededPosts({ check: false });

          await migrateCreate(heading("heading", { required: true }));
          await expect(migrate()).rejects.toThrow(
            /would drop collations its schema does not track/
          );

          expect(await definitionOf("dc_posts")).toEqual(before);
        }
      );

      /** The app's table, whose column carries the default the schema declares for it. */
      function notes(column: string, columnDefault: string): AppStreamTables {
        const spec: TableSpec = {
          name: "app_notes",
          columns: [
            {
              name: "id",
              type: dialect === "mysql" ? "varchar(36)" : "text",
              nullable: false,
              primaryKey: true,
            },
            {
              name: column,
              type: dialect === "mysql" ? "varchar(64)" : "text",
              nullable: true,
              default: columnDefault,
            },
          ],
          // Named apart from the column, so the index is the same one before and after the rename.
          indexes: [
            { name: "app_notes_lookup", columns: [column], unique: false },
          ],
        };
        return { owned: [spec], contributed: new Map(), baselines: new Map() };
      }

      /** How this dialect reports the default `'final'`. */
      const finalDefault =
        dialect === "postgresql"
          ? "'final'::text"
          : dialect === "mysql"
            ? "final"
            : "'final'";

      it("renames a column and gives it the default its schema now states, changing nothing else", async () => {
        await migrateCreate(heading("heading"), notes("label", "'draft'"));
        await migrate();
        // On SQLite the default change is a rebuild, which carries only what the snapshot records.
        if (dialect !== "sqlite") {
          await decorate(
            "app_notes",
            "label",
            dialect === "mysql" ? "varchar(64)" : "text"
          );
        }
        await exec(
          `INSERT INTO ${q("app_notes")} (${q("id")}, ${q("label")}) VALUES ('n1', 'Note')`
        );
        const before = await definitionOf("app_notes");

        await migrateCreate(heading("heading"), notes("caption", "'final'"));
        await migrate();

        const expected = withNamedChange(before, {
          rename: { from: "label", to: "caption" },
          column: "caption",
          default: finalDefault,
        });
        const after = await definitionOf("app_notes");
        if (dialect === "sqlite")
          expect(byName(after)).toEqual(byName(expected));
        else expect(after).toEqual(expected);
        const [row] = await adapter.executeQuery<{ value: unknown }>(
          `SELECT ${q("caption")} AS value FROM ${q("app_notes")} WHERE ${q("id")} = 'n1'`
        );
        expect(row?.value).toBe("Note");
      });
    }
  );
}
