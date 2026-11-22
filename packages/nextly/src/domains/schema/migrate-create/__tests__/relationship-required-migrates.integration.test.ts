/**
 * A relationship's `required` reaches its column through `nextly migrate:create` and `nextly
 * migrate`, on every dialect: made required, the next migration makes the column NOT NULL; made
 * optional, nullable; and nothing else about the table changes.
 *
 * The column descriptor these migrations are planned from called a relationship's column nullable
 * whatever `required` said, so a migration created a required relationship's column nullable and
 * turning `required` on or off planned nothing.
 *
 * That leaves databases whose required relationship has a nullable column. The table and snapshot
 * such a database holds are the ones an optional relationship gets, column for column, so the first
 * step below builds them that way. Its next migration makes the column NOT NULL, and an entry with
 * no value in it refuses that migration, naming the field, with nothing changed.
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
import { NextlyError } from "../../../../errors/nextly-error";
import {
  readTableDefinition,
  withNamedChange,
  type NamedChange,
  type TableDefinition,
} from "../../__tests__/helpers/table-definition";
import { reconcileCore } from "../../migrate/core-reconcile";
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

const posts = (required: boolean): MinimalConfigField[] => [
  { name: "heading", type: "text" },
  {
    name: "author",
    type: "relationship",
    relationTo: "authors",
    ...(required ? { required: true } : {}),
  },
];

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`a relationship's required, migrated (${entry.dialect})`, () => {
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
              `relreq_${randomBytes(2).toString("hex")}`
            );
      adapter = entry.make(scratch?.url ?? entry.url ?? "");
      await adapter.connect();
      // What `nextly migrate` creates first: the ledger and the owner registry.
      await reconcileCore({
        db: adapter.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      dir = await mkdtemp(join(tmpdir(), "nextly-relationship-required-"));
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

    /**
     * The table's definition. A SQLite rebuild declares its columns in the snapshot's order, by
     * name, so columns are compared by name there.
     */
    async function definitionOf(table: string): Promise<TableDefinition> {
      const definition = await readTableDefinition(
        statement => adapter.executeQuery(statement),
        dialect,
        table
      );
      return byName(definition);
    }

    const byName = (definition: TableDefinition): TableDefinition =>
      dialect === "sqlite"
        ? {
            ...definition,
            columns: [...definition.columns].sort((a, b) =>
              a.name.localeCompare(b.name)
            ),
          }
        : definition;

    async function expectOnly(
      before: TableDefinition,
      change: NamedChange
    ): Promise<void> {
      expect(await definitionOf("dc_posts")).toEqual(
        byName(withNamedChange(before, change))
      );
    }

    /** `nextly migrate:create` for `authors` and `posts`, with posts' author required or not. */
    async function migrateCreate(required: boolean): Promise<void> {
      made += 1;
      await generateMigration({
        name: `step_${made}`,
        dialect,
        migrationsDir: dir,
        collections: [
          {
            slug: "authors",
            tableName: "dc_authors",
            fields: [{ name: "name", type: "text" }],
          },
          { slug: "posts", tableName: "dc_posts", fields: posts(required) },
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        autoAcceptRenames: true,
        now: new Date(Date.UTC(2026, 10, 11, 12, made)),
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

    async function insertPost(author: string | null): Promise<void> {
      await exec(
        `INSERT INTO ${q("dc_posts")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("heading")}, ${q("author")}) ` +
          `VALUES ('p1', 'One', 'one', 'Hello', ${author === null ? "NULL" : `'${author}'`})`
      );
    }

    async function authorOfP1(): Promise<unknown> {
      const [row] = await adapter.executeQuery<{ value: unknown }>(
        `SELECT ${q("author")} AS value FROM ${q("dc_posts")} WHERE ${q("id")} = 'p1'`
      );
      return row?.value;
    }

    const authorColumn = async () =>
      (await definitionOf("dc_posts")).columns.find(
        column => column.name === "author"
      );

    it("creates a required relationship's column NOT NULL", async () => {
      await migrateCreate(true);
      await migrate();
      expect((await authorColumn())?.nullable).toBe(false);
    });

    it("makes the column NOT NULL when the relationship becomes required, keeping its value and the rest of the table", async () => {
      // Also the database an earlier version made for a required relationship: its table and
      // snapshot are an optional relationship's (see the header).
      await migrateCreate(false);
      await migrate();
      await insertPost("a1");
      const before = await definitionOf("dc_posts");
      // Positive control: the column starts nullable.
      expect((await authorColumn())?.nullable).toBe(true);

      await migrateCreate(true);
      await migrate();

      await expectOnly(before, { column: "author", nullable: false });
      expect(await authorOfP1()).toBe("a1");
    });

    it("makes the column nullable when the relationship becomes optional, keeping the rest of the table", async () => {
      await migrateCreate(true);
      await migrate();
      await insertPost("a1");
      const before = await definitionOf("dc_posts");
      expect((await authorColumn())?.nullable).toBe(false);

      await migrateCreate(false);
      await migrate();

      await expectOnly(before, { column: "author", nullable: true });
      expect(await authorOfP1()).toBe("a1");
    });

    it("refuses to make the column NOT NULL while an entry has no value in it, naming the field, with nothing changed", async () => {
      await migrateCreate(false);
      await migrate();
      await insertPost(null);
      const before = await definitionOf("dc_posts");

      await migrateCreate(true);
      const error = await migrate().then(
        () => undefined,
        (thrown: unknown) => thrown
      );

      expect(NextlyError.is(error)).toBe(true);
      const data = (error as NextlyError).publicData as {
        errors: Array<{ code: string; message: string }>;
      };
      expect(data.errors.map(e => e.code)).toEqual([
        "REQUIRED_COLUMN_HAS_NULLS",
      ]);
      expect(data.errors[0].message).toMatch(/'author'.*1 row/);
      expect(await definitionOf("dc_posts")).toEqual(before);
      expect(await authorOfP1()).toBeNull();
    });
  });
}
