/**
 * A field group's table has one shape whoever builds it, and no later change narrows the tables
 * already built either way.
 *
 * Two builders make a field group's table: the Builder's create, and a migration `migrate:create`
 * writes from the snapshot. They gave different tables (column defaults, an index, a column's
 * type), so the first Builder save of a table rewrote its columns, and on MySQL turned a text
 * field's `text` column into `varchar(255)`, a narrowing strict mode refuses once a value is longer.
 *
 * Both populations exist in databases today, so each is checked as it was built before this
 * change: a Builder-made table (planted in that shape) saved by the Builder, and a file-made table
 * given its next migration. Each keeps every column as it was, apart from the effects named here:
 * a Builder-made table gains the `created_at` index the snapshot always declared; a file-made table
 * gains the column defaults the Builder's create always gave.
 *
 * Read from the database whole (`helpers/table-definition.ts`), so a property nobody listed is held.
 */
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../__tests__/helpers/fresh-database";
import { runFileMigrations } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  readTableDefinition,
  type ColumnDefinition,
  type TableDefinition,
} from "../../schema/__tests__/helpers/table-definition";
import { reconcileCore } from "../../schema/migrate/core-reconcile";
import {
  generateMigration,
  type MinimalConfigField,
} from "../../schema/migrate-create/generate";

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

const TABLE = "comp_card";
/** The migration dev's `migrate:create` wrote for `FIELDS` before this change, per dialect. */
const MADE_BEFORE = join(
  __dirname,
  "fixtures",
  "field-group-made-by-a-migration"
);
const CREATED_AT_INDEX = `${STORAGE_FORMAT.indexPrefix}${TABLE}_created_at`;
const FIELDS: MinimalConfigField[] = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
const WITH_EXTRA: MinimalConfigField[] = [
  ...FIELDS,
  { name: "extra", type: "text" },
];
/** The columns whose default the Builder's create has always given. */
const DEFAULTED = [STORAGE_FORMAT.columns.order, "created_at", "updated_at"];

/** Columns by name, since the two builders need not declare them in the same order. */
const byName = (definition: TableDefinition): TableDefinition => ({
  ...definition,
  columns: [...definition.columns].sort((a, b) => a.name.localeCompare(b.name)),
});

const withoutColumn = (
  definition: TableDefinition,
  name: string
): TableDefinition => ({
  ...definition,
  columns: definition.columns.filter(column => column.name !== name),
});

const withoutIndex = (
  definition: TableDefinition,
  name: string
): TableDefinition => ({
  ...definition,
  indexes: definition.indexes.filter(index => index.name !== name),
});

/**
 * The one difference the two builders keep, by choice: on PostgreSQL the creator makes the parent
 * and type columns `varchar(255)` where the schema declares them unbounded. The diff counts a size
 * only when both sides state one, so neither population is ever planned a change to them, and
 * aligning either side would leave the other's tables to be changed.
 */
const withKnownDifference = (definition: TableDefinition): TableDefinition => ({
  ...definition,
  columns: definition.columns.map(
    (column): ColumnDefinition =>
      column.name.startsWith("_") && column.type === "character varying(255)"
        ? { ...column, type: "character varying" }
        : column
  ),
});

/** The definition with the defaults of `DEFAULTED` left out, for comparing everything else. */
const withoutSystemDefaults = (
  definition: TableDefinition
): TableDefinition => ({
  ...definition,
  columns: definition.columns.map(
    (column): ColumnDefinition =>
      DEFAULTED.includes(column.name)
        ? { ...column, default: null, extra: null }
        : column
  ),
});

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`a field group's table has one shape (${entry.dialect})`, () => {
    const { dialect } = entry;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    let t: TestNextly | undefined;
    let adapter: TestAdapter | undefined;
    let scratch: ScratchDatabase | null = null;
    let dir: string | undefined;
    let made = 0;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      await adapter?.disconnect();
      adapter = undefined;
      await scratch?.drop();
      scratch = null;
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
      dir = undefined;
      made = 0;
      vi.unstubAllEnvs();
    });

    // --- The Builder's road ---------------------------------------------------------------

    async function builderExec<T>(statement: string): Promise<T[]> {
      return (
        (t as TestNextly).adapter as unknown as {
          executeQuery<R>(sql: string): Promise<R[]>;
        }
      ).executeQuery<T>(statement);
    }

    const builderTable = () =>
      readTableDefinition(statement => builderExec(statement), dialect, TABLE);

    async function builderCreate(): Promise<TableDefinition> {
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({ dialect: dialect as TestDialect });
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields: FIELDS }
      );
      return builderTable();
    }

    async function builderSave(): Promise<TableDefinition> {
      // The version the registry holds, as the Builder sends the one it loaded: a create whose
      // save writes its migration records the row again once applied, so it is not always 1.
      const { schemaVersion } = await (t as TestNextly)
        .getService("fieldGroupRegistryService")
        .getComponent("card");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "card" },
        { fields: WITH_EXTRA, confirmed: true, schemaVersion }
      );
      return withoutColumn(await builderTable(), "extra");
    }

    /**
     * Turns the table the Builder's create makes now back into the one it made before this change:
     * no `created_at` index; on PostgreSQL the parent and type columns `varchar(255)`; on MySQL a
     * text field's column `text`.
     */
    async function asCreatedBefore(): Promise<void> {
      const indexed = (await builderTable()).indexes.some(
        index => index.name === CREATED_AT_INDEX
      );
      if (dialect === "mysql") {
        if (indexed) {
          await builderExec(`DROP INDEX ${q(CREATED_AT_INDEX)} ON ${q(TABLE)}`);
        }
        await builderExec(
          `ALTER TABLE ${q(TABLE)} MODIFY COLUMN \`heading\` text NULL`
        );
        return;
      }
      if (indexed) await builderExec(`DROP INDEX ${q(CREATED_AT_INDEX)}`);
      if (dialect === "postgresql") {
        const { parentTable, parentField } = STORAGE_FORMAT.columns;
        for (const column of [parentTable, parentField]) {
          await builderExec(
            `ALTER TABLE ${q(TABLE)} ALTER COLUMN ${q(column)} TYPE varchar(255)`
          );
        }
      }
    }

    // --- The migration file's road --------------------------------------------------------

    async function fileExec<T>(statement: string): Promise<T[]> {
      return (adapter as TestAdapter).executeQuery<T>(statement);
    }

    const fileTable = () =>
      readTableDefinition(statement => fileExec(statement), dialect, TABLE);

    async function openFileDatabase(): Promise<void> {
      scratch =
        dialect === "sqlite"
          ? null
          : await createScratchDatabase(
              dialect,
              `fgshape_${randomBytes(2).toString("hex")}`
            );
      adapter = entry.make(scratch?.url ?? entry.url ?? "");
      await adapter.connect();
      await reconcileCore({
        db: adapter.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      dir = await mkdtemp(join(tmpdir(), "nextly-fg-shape-"));
    }

    /** `nextly migrate` over what the folder holds. */
    async function migrate(): Promise<TableDefinition> {
      const db = adapter as TestAdapter;
      await runFileMigrations({
        adapter: db as never,
        db: db.getDrizzle(),
        dialect,
        migrationsDir: dir as string,
        logger: createLogger({ quiet: true }),
      });
      return fileTable();
    }

    /**
     * `nextly migrate:create` for the field group with `fields`, declared by the Builder or in code,
     * then `nextly migrate`.
     */
    async function migrateWith(
      fields: MinimalConfigField[],
      source: "builder" | "code"
    ): Promise<TableDefinition> {
      made += 1;
      await generateMigration({
        name: `card_${made}`,
        dialect,
        migrationsDir: dir as string,
        collections: [],
        singles: [],
        components: [
          {
            slug: "card",
            tableName: TABLE,
            fields,
            ...(source === "builder"
              ? { settings: { source, settings: { slug: "card" } } }
              : {}),
          },
        ],
        nonInteractive: true,
        autoAcceptRenames: true,
        now: new Date(Date.UTC(2026, 10, 11, 12, made)),
      });
      return migrate();
    }

    // --- Cases ----------------------------------------------------------------------------

    it("is the same table from the Builder's create as from a migration", async () => {
      await openFileDatabase();
      const fromMigration = await migrateWith(FIELDS, "builder");
      const created = await builderCreate();

      expect(withKnownDifference(byName(created))).toEqual(
        withKnownDifference(byName(fromMigration))
      );
    });

    it("keeps a table the Builder's create makes as it is through a save that adds a field", async () => {
      const created = await builderCreate();

      expect(await builderSave()).toEqual(created);
    });

    it("keeps every column of a table the Builder made before, through a save, adding only the created_at index", async () => {
      await builderCreate();
      await asCreatedBefore();
      const before = await builderTable();
      expect(before.indexes.map(index => index.name)).not.toContain(
        CREATED_AT_INDEX
      );

      const after = await builderSave();

      expect(withoutIndex(after, CREATED_AT_INDEX)).toEqual(before);
      expect(after.indexes.map(index => index.name)).toContain(
        CREATED_AT_INDEX
      );
    });

    it("keeps every column of a table a migration made before, through its next migration, adding only the column defaults", async () => {
      await openFileDatabase();
      await cp(join(MADE_BEFORE, dialect), dir as string, { recursive: true });
      const before = await migrate();

      // The fixture's field group is declared in code, as every file-made one is today.
      const after = withoutColumn(
        await migrateWith(WITH_EXTRA, "code"),
        "extra"
      );

      expect(withoutSystemDefaults(after)).toEqual(
        withoutSystemDefaults(before)
      );
      for (const column of after.columns.filter(c =>
        DEFAULTED.includes(c.name)
      )) {
        expect(column.default, column.name).not.toBeNull();
      }
    });
  });
}
