/**
 * A field group's table has one shape whoever builds it: the Builder's create, and a migration
 * `migrate:create` writes for the same field group, give the same table, as the database reports
 * it; and a Builder save that adds a field changes nothing about the columns already there.
 *
 * The comparison reads the whole table from the database (`helpers/table-definition.ts`), so a
 * default, an index or a type one builder gives and the other does not is found without listing it.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
import {
  readTableDefinition,
  type TableDefinition,
} from "../../schema/__tests__/helpers/table-definition";
import { reconcileCore } from "../../schema/migrate/core-reconcile";
import { generateMigration } from "../../schema/migrate-create/generate";

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

const FIELDS = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];

/** Columns by name, since the two builders need not declare them in the same order. */
const byName = (definition: TableDefinition): TableDefinition => ({
  ...definition,
  columns: [...definition.columns].sort((a, b) => a.name.localeCompare(b.name)),
});

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`a field group's table has one shape (${entry.dialect})`, () => {
    const { dialect } = entry;
    let t: TestNextly | undefined;
    let adapter: TestAdapter | undefined;
    let scratch: ScratchDatabase | null = null;
    let dir: string | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      await adapter?.disconnect();
      adapter = undefined;
      await scratch?.drop();
      scratch = null;
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
      dir = undefined;
      vi.unstubAllEnvs();
    });

    /** The table the Builder's create makes, and the same table after a save that adds a field. */
    async function builtByTheBuilder(): Promise<{
      created: TableDefinition;
      saved: TableDefinition;
    }> {
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({ dialect: dialect as TestDialect });
      const current = t;
      const read = () =>
        readTableDefinition(
          statement =>
            (
              current.adapter as unknown as {
                executeQuery<R>(sql: string): Promise<R[]>;
              }
            ).executeQuery(statement),
          dialect,
          "comp_card"
        );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "card", label: "Card", fields: FIELDS }
      );
      const created = await read();
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "card" },
        {
          fields: [...FIELDS, { name: "extra", type: "text" }],
          confirmed: true,
          schemaVersion: 1,
        }
      );
      const after = await read();
      return {
        created,
        saved: {
          ...after,
          columns: after.columns.filter(column => column.name !== "extra"),
        },
      };
    }

    /** The table a `migrate:create` file makes for the same field group, run by `nextly migrate`. */
    async function builtByAMigration(): Promise<TableDefinition> {
      scratch =
        dialect === "sqlite"
          ? null
          : await createScratchDatabase(
              dialect,
              `fgshape_${randomBytes(2).toString("hex")}`
            );
      adapter = entry.make(scratch?.url ?? entry.url ?? "");
      await adapter.connect();
      const db = adapter;
      await reconcileCore({
        db: db.getDrizzle(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      dir = await mkdtemp(join(tmpdir(), "nextly-fg-shape-"));
      await generateMigration({
        name: "card",
        dialect,
        migrationsDir: dir,
        collections: [],
        singles: [],
        components: [{ slug: "card", tableName: "comp_card", fields: FIELDS }],
        nonInteractive: true,
        autoAcceptRenames: true,
        now: new Date(Date.UTC(2026, 10, 11, 12, 0)),
      });
      await runFileMigrations({
        adapter: db as never,
        db: db.getDrizzle(),
        dialect,
        migrationsDir: dir,
        logger: createLogger({ quiet: true }),
      });
      return readTableDefinition(
        statement => db.executeQuery(statement),
        dialect,
        "comp_card"
      );
    }

    it("is the same table from the Builder's create as from a migration", async () => {
      const fromMigration = await builtByAMigration();
      const { created } = await builtByTheBuilder();

      expect(byName(created)).toEqual(byName(fromMigration));
    });

    it("keeps the columns already there through a save that adds a field", async () => {
      const { created, saved } = await builtByTheBuilder();

      expect(saved).toEqual(created);
    });
  });
}
