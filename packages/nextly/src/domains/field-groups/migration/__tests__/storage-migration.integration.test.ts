/**
 * The storage migration against real servers, on every dialect.
 *
 * 🔴 The assertion this suite exists for is not structural. `_parent_table`
 * stores a PHYSICAL table name, so a field group nested inside another
 * addresses its parent by the very name a rename changes — and the read path
 * treats a parent it cannot match as *no rows* rather than as an error. A
 * migration that renames the tables without rewriting those strings therefore
 * reports success over content that has silently become unreachable: nothing
 * throws, and nothing is missing until someone reads it.
 *
 * Only a **nested** fixture can catch that. A top-level instance points at a
 * collection table, which this migration never renames, so it survives a broken
 * rewrite unchanged; the association only breaks one level down, where the
 * parent is itself a field group.
 *
 * So the load-bearing test writes nested content, migrates, and reads it back
 * by the association the read path uses, in both directions.
 *
 * Three properties are only decidable against a real server, which is why the
 * module's doubles cannot replace this: MySQL commits DDL implicitly,
 * identifier case is a server setting rather than a dialect property, and the
 * read path is a different code path from the migration that moves the storage
 * it reads.
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { getTableName, type Table } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getDrizzleKitForDialect } from "../../../../database/drizzle-kit-lazy";
import { SchemaRegistry } from "../../../../database/schema-registry";
import {
  dynamicCollectionsMysql,
  dynamicCollectionsPg,
  dynamicCollectionsSqlite,
} from "../../../../schemas/dynamic-collections";
import {
  dynamicFieldGroupsMysql,
  dynamicFieldGroupsPg,
  dynamicFieldGroupsSqlite,
} from "../../../../schemas/dynamic-field-groups";
import { dynamicSinglesMysql } from "../../../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../../../schemas/dynamic-singles/sqlite";
import { nextlyMetaTables } from "../../../../schemas/nextly-meta";
import { userTables } from "../../../../schemas/users";
import { schemaEventsTables } from "../../../../schemas/schema-events";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { versionsTables } from "../../../../schemas/versions";
import { webhookTables } from "../../../../schemas/webhooks";
import { splitStatements } from "../../../schema/pipeline/sql-statement-utils";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../services/field-group-schema-service";
import { MIGRATION_TARGET } from "../manifest";
import { runFieldGroupMigration } from "../run";
import { MIGRATION_LOCK_TABLE } from "../session";

interface TestAdapter {
  dialect: SupportedDialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  listTables(): Promise<string[]>;
  setTableResolver(registry: SchemaRegistry): void;
  select<T = Record<string, unknown>>(
    table: string,
    options: unknown
  ): Promise<T[]>;
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

/**
 * Every system table a run reads or rewrites, as production declares it.
 *
 * Assembled from the same Drizzle objects the core schema is built from rather
 * than hand-written, so the fixture cannot disagree with the thing under test.
 * The set is not arbitrary: the data steps rewrite stored field definitions in
 * all three dynamic registries, rescope `nextly_schema_events`, and walk the
 * `nextly_versions` and `nextly_events` ledgers — a fixture missing any of them
 * fails resolving a table rather than testing a migration.
 */
function systemTablesFor(dialect: SupportedDialect): Record<string, unknown> {
  const registries =
    dialect === "postgresql"
      ? {
          collections: dynamicCollectionsPg,
          singles: dynamicSinglesPg,
          fieldGroups: dynamicFieldGroupsPg,
        }
      : dialect === "mysql"
        ? {
            collections: dynamicCollectionsMysql,
            singles: dynamicSinglesMysql,
            fieldGroups: dynamicFieldGroupsMysql,
          }
        : {
            collections: dynamicCollectionsSqlite,
            singles: dynamicSinglesSqlite,
            fieldGroups: dynamicFieldGroupsSqlite,
          };
  return {
    // 🔴 `users` is here for a foreign key, not because the migration reads it:
    // all three dynamic registries carry `created_by → users.id`. MySQL enforces
    // that at CREATE time and refuses the constraint outright when the parent is
    // absent. This suite passed for a while only because a leftover `users` from
    // another suite happened to be sitting in the container — a fixture whose
    // correctness depends on what ran before it is not a fixture, and it would
    // have failed on CI's clean database.
    ...userTables(dialect),
    ...registries,
    ...nextlyMetaTables(dialect),
    ...schemaEventsTables(dialect),
    ...versionsTables(dialect),
    ...webhookTables(dialect),
  };
}

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`field-group storage migration — ${entry.dialect}`, () => {
    let adapter: TestAdapter;
    let registry: SchemaRegistry;
    let schemaService: FieldGroupSchemaService;
    let collectionSchemaService: DynamicCollectionSchemaService;

    // 🔴 The tag goes in the SLUG, not in the table name. `retargetName` only
    // produces a rename when `tableName === resolveComponentTableName(slug)`,
    // so a directly-named table would be left out of the plan entirely — a
    // fixture that looks isolated and silently tests nothing.
    const tag = randomBytes(5).toString("hex");
    const outerSlug = `outer${tag}`;
    const innerSlug = `inner${tag}`;
    const outerTable = `${STORAGE_FORMAT.tablePrefix}${outerSlug}`;
    const innerTable = `${STORAGE_FORMAT.tablePrefix}${innerSlug}`;
    const outerMigrated = `${MIGRATION_TARGET.tablePrefix}${outerSlug}`;
    const innerMigrated = `${MIGRATION_TARGET.tablePrefix}${innerSlug}`;
    const parentTable = `dc_pages${tag}`;

    const q = (id: string): string =>
      entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;

    const innerFields = [{ name: "body", type: "text" }];
    const outerFields = [
      { name: "heading", type: "text" },
      { name: "inner", type: STORAGE_FORMAT.fieldType, component: innerSlug },
    ];

    async function drop(...tables: string[]): Promise<void> {
      // Foreign keys make teardown order-dependent, and each dialect needs a
      // different answer:
      //
      // - Postgres takes CASCADE, which settles it in one pass.
      // - MySQL has no CASCADE and refuses to drop a parent while ANY child
      //   references it — including a table this suite did not create. Ordering
      //   cannot fix that, because the blocking child may not be ours to drop,
      //   so foreign-key enforcement is suspended for the teardown instead.
      //   This is a throwaway container by contract (`pnpm docker:test`).
      // - SQLite needs neither, but takes a second pass for the same reason
      //   Postgres takes CASCADE.
      const cascade = entry.dialect === "postgresql" ? " CASCADE" : "";
      if (entry.dialect === "mysql") {
        await adapter.executeQuery("SET FOREIGN_KEY_CHECKS = 0");
      }
      try {
        for (let pass = 0; pass < 2; pass += 1) {
          for (const table of tables) {
            try {
              await adapter.executeQuery(
                `DROP TABLE IF EXISTS ${q(table)}${cascade}`
              );
            } catch {
              // Best-effort: a leftover from a failed run must not block the next.
            }
          }
        }
      } finally {
        // Restored even when a drop threw: leaving enforcement off would let a
        // later suite in the same container write rows no constraint checks.
        if (entry.dialect === "mysql") {
          await adapter.executeQuery("SET FOREIGN_KEY_CHECKS = 1");
        }
      }
    }

    /**
     * Everything this suite can leave behind, under BOTH spellings.
     *
     * A run that fails midway leaves storage half-renamed, and a leftover
     * `dynamic_field_groups` poisons every later run in the same container —
     * the engine finds it and reads the world as already migrated. The system
     * names are read off the Drizzle objects rather than restated, so a table
     * added to the fixture cannot be forgotten here.
     */
    async function dropEverything(): Promise<void> {
      await drop(
        ...Object.values(systemTablesFor(entry.dialect)).map(table =>
          getTableName(table as Table)
        ),
        `${outerTable}${STORAGE_FORMAT.companionSuffix}`,
        `${outerMigrated}${STORAGE_FORMAT.companionSuffix}`,
        innerTable,
        innerMigrated,
        outerTable,
        outerMigrated,
        parentTable,
        STORAGE_FORMAT.registryTable,
        MIGRATION_TARGET.registryTable,
        MIGRATION_LOCK_TABLE
      );
    }

    /**
     * The system tables, generated from the PRODUCTION Drizzle definitions.
     *
     * Never hand-written. A copied `CREATE TABLE` drifts the moment a column is
     * added, and it drifts silently — the first version of this suite omitted
     * `nextly_meta.updated_at` and every dialect failed on a column the marker
     * reads.
     */
    async function createSystemTables(): Promise<void> {
      const kit = await getDrizzleKitForDialect(entry.dialect);
      const empty = await kit.generateDrizzleJson({});
      const desired = await kit.generateDrizzleJson(
        systemTablesFor(entry.dialect) as never
      );
      const statements = await kit.generateMigration(
        empty as never,
        desired as never
      );
      for (const statement of splitStatements(statements)) {
        await adapter.executeQuery(statement);
      }
    }

    /** A field-group table, from the generator production uses. */
    async function createFieldGroupTable(
      table: string,
      fields: { name: string; type: string }[]
    ): Promise<void> {
      for (const statement of splitStatements([
        schemaService.generateMigrationSQL(table, fields as never),
      ])) {
        await adapter.executeQuery(statement);
      }
    }

    async function registerFieldGroup(
      slug: string,
      table: string,
      fields: unknown[]
    ): Promise<void> {
      const now = "2026-07-31 00:00:00";
      // `locked` and `localized` are real booleans on Postgres and integers on
      // the other two; one literal is wrong on one of them.
      const no = entry.dialect === "postgresql" ? "false" : "0";
      await adapter.executeQuery(
        `INSERT INTO ${q(STORAGE_FORMAT.registryTable)}
           (${q("id")}, ${q("slug")}, ${q("label")}, ${q("table_name")}, ${q("fields")},
            ${q("source")}, ${q("locked")}, ${q("localized")}, ${q("schema_hash")},
            ${q("schema_version")}, ${q("migration_status")}, ${q("config_path")},
            ${q("created_at")}, ${q("updated_at")})
         VALUES ('${randomUUID()}', '${slug}', '${slug}', '${table}',
                 '${JSON.stringify(fields).replace(/'/g, "''")}',
                 'ui', ${no}, ${no}, 'hash-${slug}', 1, 'applied',
                 '${STORAGE_FORMAT.configPathDir}/${slug}.ts', '${now}', '${now}')`
      );
    }

    /** One embedded instance, associated by the three plain string columns. */
    async function insertInstance(args: {
      table: string;
      id: string;
      parentId: string;
      parentTable: string;
      field: string;
      column: string;
      value: string;
    }): Promise<void> {
      const columns = STORAGE_FORMAT.columns;
      await adapter.executeQuery(
        `INSERT INTO ${q(args.table)}
           (${q("id")}, ${q(columns.parentId)}, ${q(columns.parentTable)},
            ${q(columns.parentField)}, ${q(columns.order)}, ${q(args.column)})
         VALUES ('${args.id}', '${args.parentId}', '${args.parentTable}',
                 '${args.field}', 0, '${args.value}')`
      );
    }

    /**
     * Resolve an embedded instance by the association the read path uses.
     *
     * Matching `_parent_id` + `_parent_table` + `_parent_field` is exactly what
     * `getExistingInstances` does, and the association is what a rename breaks.
     * Asserting the row exists would not detect that: the row survives a broken
     * rename intact, and only stops being *reachable*.
     *
     * 🔴 Issued as SQL rather than through the typed CRUD, and NOT for
     * convenience. Every runtime Drizzle schema declares the discriminator
     * under its legacy name — `MIGRATION_TARGET.columnType` appears nowhere
     * outside the migration itself — so the typed path projects
     * `_component_type` and fails outright against storage this migration has
     * renamed. Asserting through it would therefore fail for a reason this
     * test is not about, conflating "the association survived the rename" with
     * "the runtime schema addresses the migrated discriminator". Those are
     * separate properties and this function isolates the first.
     */
    async function resolveEmbedded(args: {
      table: string;
      parentId: string;
      parentTable: string;
      field: string;
    }): Promise<Record<string, unknown> | undefined> {
      const c = STORAGE_FORMAT.columns;
      const rows = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT * FROM ${q(args.table)}
          WHERE ${q(c.parentId)} = '${args.parentId}'
            AND ${q(c.parentTable)} = '${args.parentTable}'
            AND ${q(c.parentField)} = '${args.field}'`
      );
      return rows[0];
    }

    async function migrate(direction: "up" | "down") {
      return runFieldGroupMigration({
        adapter: adapter as never,
        logger: logger as never,
        direction,
      });
    }

    /** Both spellings registered, so reads resolve before and after a run. */
    function registerRuntimeSchemas(): void {
      const pairs: [string, { name: string; type: string }[]][] = [
        [outerTable, [{ name: "heading", type: "text" }]],
        [outerMigrated, [{ name: "heading", type: "text" }]],
        [innerTable, innerFields],
        [innerMigrated, innerFields],
      ];
      for (const [table, fields] of pairs) {
        registry.registerDynamicSchema(
          table,
          schemaService.generateRuntimeSchema(table, fields as never)
        );
      }
    }

    beforeEach(async () => {
      if (adapter === undefined) {
        adapter = entry.make(entry.url as string);
        await adapter.connect();
        schemaService = new FieldGroupSchemaService(entry.dialect as never);
        collectionSchemaService = new DynamicCollectionSchemaService(
          undefined,
          entry.dialect
        );
      }
      registry = new SchemaRegistry(entry.dialect);
      // The system tables go in too, not just the field-group ones. The typed
      // CRUD resolves every table through this registry and refuses any name it
      // does not declare, so without them the registry service cannot read
      // `dynamic_components` at all — and the read path swallows that as "no
      // component data" rather than surfacing it.
      registry.registerStaticSchemas(systemTablesFor(entry.dialect));
      adapter.setTableResolver(registry);

      await dropEverything();
      await createSystemTables();

      // The parent comes from the collection generator production uses, not a
      // hand-written CREATE TABLE. It is only ever addressed as a
      // `_parent_table` VALUE here, so a minimal stand-in would function — and
      // that is exactly how a fixture drifts from the storage it claims to
      // represent. This suite already learned that lesson once: an invented
      // system table omitted a column the marker reads.
      for (const statement of splitStatements([
        collectionSchemaService.generateMigrationSQL(parentTable, [
          { name: "title", type: "text" },
        ] as never),
      ])) {
        await adapter.executeQuery(statement);
      }
      // `slug` is NOT NULL on a real collection — the generator emits the system
      // columns a hand-written stand-in omitted, which is the whole reason to
      // use it.
      await adapter.executeQuery(
        `INSERT INTO ${q(parentTable)} (${q("id")}, ${q("title")}, ${q("slug")})
         VALUES ('page-1', 'Page', 'page-1')`
      );

      await createFieldGroupTable(outerTable, [
        { name: "heading", type: "text" },
      ]);
      await createFieldGroupTable(innerTable, innerFields);
      await registerFieldGroup(outerSlug, outerTable, outerFields);
      await registerFieldGroup(innerSlug, innerTable, innerFields);

      // The outer instance hangs off the page; the inner one hangs off the
      // OUTER INSTANCE, addressing it by `comp_outer<tag>`. That second row is
      // the one a rename used to strand.
      await insertInstance({
        table: outerTable,
        id: "outer-1",
        parentId: "page-1",
        parentTable,
        field: "hero",
        column: "heading",
        value: "Hello",
      });
      await insertInstance({
        table: innerTable,
        id: "inner-1",
        parentId: "outer-1",
        parentTable: outerTable,
        field: "inner",
        column: "body",
        value: "Nested body",
      });

      registerRuntimeSchemas();
    });

    afterAll(async () => {
      await dropEverything();
      await adapter.disconnect();
    });

    // 🔴 THE test. Everything else in this file is secondary to it.
    it("keeps nested content resolvable across the migration", async () => {
      const before = await resolveEmbedded({
        table: innerTable,
        parentId: "outer-1",
        parentTable: outerTable,
        field: "inner",
      });
      expect(before?.body).toBe("Nested body");

      const outcome = await migrate("up");
      expect(outcome.ran).toBe(true);

      // Resolved through the MIGRATED parent name, which is what a runtime
      // consumer now passes. If `_parent_table` still held `comp_outer<tag>`,
      // this finds nothing and the content is gone with nothing having failed.
      const after = await resolveEmbedded({
        table: innerMigrated,
        parentId: "outer-1",
        parentTable: outerMigrated,
        field: "inner",
      });
      expect(after?.body).toBe("Nested body");
    });

    it("renames the registry, the tables and the discriminator", async () => {
      await migrate("up");
      const names = await adapter.listTables();

      expect(names).toContain(MIGRATION_TARGET.registryTable);
      expect(names).not.toContain(STORAGE_FORMAT.registryTable);
      expect(names).toContain(outerMigrated);
      expect(names).toContain(innerMigrated);
      expect(names).not.toContain(outerTable);
    });

    it("reports a second run as already migrated", async () => {
      await migrate("up");
      const again = await migrate("up");

      expect(again).toEqual({ ran: false, reason: "already-migrated" });
    });

    // 🔴 The same defect from the other side: a rollback that restores the
    // names while leaving the pointers migrated is structurally successful and
    // resolves to nothing.
    it("restores the storage and the association on the way back down", async () => {
      await migrate("up");
      const outcome = await migrate("down");
      expect(outcome.ran).toBe(true);

      const names = await adapter.listTables();
      expect(names).toContain(STORAGE_FORMAT.registryTable);
      expect(names).toContain(outerTable);
      expect(names).not.toContain(outerMigrated);

      const restored = await resolveEmbedded({
        table: innerTable,
        parentId: "outer-1",
        parentTable: outerTable,
        field: "inner",
      });
      expect(restored?.body).toBe("Nested body");
    });
  });
}
