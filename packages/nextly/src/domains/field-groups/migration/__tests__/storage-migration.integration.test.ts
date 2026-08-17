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
import { getCoreSchema, getCoreTableNames } from "../../../../schemas";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { versionsTables } from "../../../../schemas/versions";
import { webhookTables } from "../../../../schemas/webhooks";
import { diffSnapshots } from "../../../schema/pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../../schema/pipeline/diff/introspect-live";
import { splitStatements } from "../../../schema/pipeline/sql-statement-utils";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../services/field-group-schema-service";
import { MetaService } from "../../../meta/services/meta-service";
import {
  FIELD_GROUP_STORAGE_VOCABULARY,
  LEGACY_STORAGE_VOCABULARY,
  assertLedgersSettled,
  settleLedgersStep,
} from "../data-steps";
import { MIGRATION_TARGET } from "../manifest";
import { runFieldGroupMigration } from "../run";
import { getFieldGroupRegistryAliases } from "../../storage/registry-schemas";
import {
  resolveRegistryNameFromCatalog,
  resolveTypeColumns,
} from "../../storage/resolve-storage-names";
import {
  MIGRATION_LOCK_TABLE,
  withMigrationSession,
  type MigrationDialect,
} from "../session";

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
 * The set is not arbitrary: a run renames storage recorded across all three
 * dynamic registries and walks the `nextly_versions` and `nextly_events`
 * ledgers — a fixture missing any of them fails resolving a table rather than
 * testing a migration.
 *
 * `nextly_schema_events` is here because the suite asserts what the run leaves
 * ALONE as well as what it moves: a run must not rescope those events, since
 * the journal matches them against the legacy spelling on read.
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
    // all three dynamic registries carry `created_by → users.id`, and MySQL
    // enforces that at CREATE time, refusing the constraint outright when the
    // parent table is absent. It is declared here rather than assumed because
    // the container is shared: a `users` left behind by another suite would
    // satisfy the constraint on a developer machine and be absent on a clean
    // one, so the fixture creates every table it depends on.
    ...userTables(dialect),
    ...registries,
    ...nextlyMetaTables(dialect),
    ...schemaEventsTables(dialect),
    ...versionsTables(dialect),
    ...webhookTables(dialect),
  };
}

/**
 * The Drizzle handle behind a test adapter.
 *
 * `TestAdapter` is the narrow surface these cases drive; the handle is not part
 * of it, so the narrowing is written once here rather than at each call.
 */
function drizzleOf(adapter: unknown): unknown {
  return (adapter as { getDrizzle(): unknown }).getDrizzle();
}

/**
 * Insert through the adapter's typed CRUD.
 *
 * `TestAdapter` is the narrow surface these cases drive and does not name
 * `insert`; the object behind it is a real adapter. Narrowed once here so each
 * dialect's own JSON and boolean handling is used rather than three
 * hand-written spellings of one statement.
 */
function insertRow(
  adapter: unknown,
  table: string,
  values: Record<string, unknown>
): Promise<unknown> {
  return (
    adapter as {
      insert(t: string, v: Record<string, unknown>): Promise<unknown>;
    }
  ).insert(table, values);
}

/**
 * Read through the adapter's typed CRUD, narrowed for the same reason.
 *
 * A registry's `fields` column is `jsonb` on Postgres, `json` on MySQL and
 * text-with-a-json-mode on SQLite. Going through the adapter is what makes one
 * call correct on all three, and it decodes the document exactly as the code
 * under test does rather than handing back a dialect's raw representation.
 */
function selectRows(
  adapter: unknown,
  table: string,
  where: unknown
): Promise<Record<string, unknown>[]> {
  return (
    adapter as {
      select(
        t: string,
        options: { where: unknown }
      ): Promise<Record<string, unknown>[]>;
    }
  ).select(table, { where });
}

/** The kinds of core operation that name a given table, for an exact assertion. */
function namesRegistry(
  ops: ReadonlyArray<{
    type: string;
    table?: { name: string };
    tableName?: string;
  }>,
  table: string
): string[] {
  return ops
    .filter(op => (op.table?.name ?? op.tableName) === table)
    .map(op => op.type);
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
     * The invariant: every column the migration reads is present here because
     * production declares it, not because this file lists it. A copied
     * `CREATE TABLE` holds only the columns it was written with, and it goes
     * out of date silently — the migration reads `nextly_meta.updated_at`, and
     * a stand-in missing it fails on every dialect for a reason that looks
     * like a product defect.
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

    /**
     * The columns a table actually carries, per the live catalog.
     *
     * Read through the same introspection the migration uses, so a dialect that
     * reports a name differently reports it identically to both. Structural
     * assertions on `listTables` cannot see a column, so a discriminator rename
     * that was skipped — or reconciled as already satisfied when it was not —
     * is invisible without this.
     */
    async function columnsOf(table: string): Promise<string[]> {
      const snapshot = await introspectLiveSnapshot(
        drizzleOf(adapter),
        entry.dialect,
        [table]
      );
      return (
        snapshot.tables
          .find(spec => spec.name === table)
          ?.columns.map(column => column.name) ?? []
      );
    }

    /**
     * What settlement would still call unrewritten, asked of the live database.
     *
     * Runs the production predicate rather than a second scanner, so this
     * observes exactly what the settlement check observes.
     */
    async function settlementResidue(): Promise<void> {
      return withMigrationSession(
        {
          adapter: adapter as never,
          dialect: entry.dialect as MigrationDialect,
          label: "settlement-residue-probe",
        },
        session =>
          assertLedgersSettled({
            session,
            meta: new MetaService(adapter as never, logger as never),
            migrationId: "settlement-residue-probe",
            from: LEGACY_STORAGE_VOCABULARY,
            to: FIELD_GROUP_STORAGE_VOCABULARY,
          })
      );
    }

    async function migrate(direction: "up" | "down") {
      return runFieldGroupMigration({
        adapter: adapter as never,
        logger: logger as never,
        direction,
        // These fixtures are created and dropped by the suite itself, so the acknowledgement is
        // trivially true here. Stated rather than defaulted, because a default would mean the
        // production precondition is never exercised by anything that calls this helper.
        backupConfirmed: true,
      });
    }

    /**
     * Both spellings registered, so reads resolve before and after a run.
     *
     * The discriminator is resolved from the live catalog rather than assumed,
     * which is what a booting process does. Registered before a run it names
     * the legacy column; re-registered after one it names the migrated column,
     * from the same code and without being told which generation it is in.
     */
    async function registerRuntimeSchemas(): Promise<void> {
      const pairs: [string, { name: string; type: string }[]][] = [
        [outerTable, [{ name: "heading", type: "text" }]],
        [outerMigrated, [{ name: "heading", type: "text" }]],
        [innerTable, innerFields],
        [innerMigrated, innerFields],
      ];
      const typeColumns = await resolveTypeColumns(
        adapter as never,
        pairs.map(([table]) => table)
      );
      for (const [table, fields] of pairs) {
        registry.registerDynamicSchema(
          table,
          schemaService.generateRuntimeSchema(table, fields as never, {
            typeColumn: typeColumns.get(table) ?? STORAGE_FORMAT.columns.type,
          })
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
      //
      // 🔴 The aliases are added HERE and not to `systemTablesFor`, which is the
      // same split production draws. That set also generates this fixture's DDL,
      // and the migrated registry belongs in a schema REGISTRY but never in a
      // schema PUSH: creating it up front would hand the migration a rename
      // target that already exists. Every production site that builds a registry
      // registers both spellings, so a fixture registering one would refuse a
      // read production serves.
      registry.registerStaticSchemas({
        ...systemTablesFor(entry.dialect),
        ...getFieldGroupRegistryAliases(entry.dialect),
      });
      adapter.setTableResolver(registry);

      await dropEverything();
      await createSystemTables();

      // The parent comes from the collection generator production uses, not a
      // hand-written CREATE TABLE. It is only ever addressed as a
      // `_parent_table` VALUE here, so a minimal stand-in would function — and
      // a fixture that functions while describing storage production does not
      // create is how a suite certifies a shape that does not exist.
      for (const statement of splitStatements([
        collectionSchemaService.generateMigrationSQL(parentTable, [
          { name: "title", type: "text" },
        ] as never),
      ])) {
        await adapter.executeQuery(statement);
      }
      // `slug` is NOT NULL on a real collection. The generator emits every
      // system column the real table has, which is the whole reason to use it.
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
      // the one a rename strands when the pointer is not rewritten with it.
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

      await registerRuntimeSchemas();
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

    // 🔴 The assertion the reader-side expansion exists for, and the one the
    // suite could not make before it: the SAME code reads content through the
    // typed CRUD on both generations, choosing the discriminator from the
    // catalog rather than being told which generation it is in. Before this
    // resolution existed the post-migration read projected `_component_type`
    // against a table carrying `_field_group_type` and failed outright.
    it("reads content through the typed CRUD on either generation", async () => {
      const readTyped = async (table: string, parent: string) => {
        await registerRuntimeSchemas();
        const rows = await adapter.select<Record<string, unknown>>(table, {
          where: {
            and: [
              {
                column: STORAGE_FORMAT.columns.parentId,
                op: "=",
                value: "outer-1",
              },
              {
                column: STORAGE_FORMAT.columns.parentTable,
                op: "=",
                value: parent,
              },
              {
                column: STORAGE_FORMAT.columns.parentField,
                op: "=",
                value: "inner",
              },
            ],
          },
        });
        return rows[0];
      };

      const before = await readTyped(innerTable, outerTable);
      expect(before?.body).toBe("Nested body");
      // The discriminator comes back under its stable property key whichever
      // physical column carries it, which is what keeps every consumer of a
      // component row unchanged across the migration.
      expect(before).toHaveProperty(STORAGE_FORMAT.columns.type);

      await migrate("up");

      const after = await readTyped(innerMigrated, outerMigrated);
      expect(after?.body).toBe("Nested body");
      expect(after).toHaveProperty(STORAGE_FORMAT.columns.type);
    });

    it("renames the registry, the tables and the discriminator", async () => {
      await migrate("up");
      const names = await adapter.listTables();

      expect(names).toContain(MIGRATION_TARGET.registryTable);
      expect(names).not.toContain(STORAGE_FORMAT.registryTable);
      expect(names).toContain(outerMigrated);
      expect(names).toContain(innerMigrated);
      expect(names).not.toContain(outerTable);

      // The discriminator is a separate step from its table's rename, and the
      // plan can record it as already satisfied. Both halves are asserted on
      // both tables: present under the migrated name AND gone under the legacy
      // one, so a column added rather than renamed does not read as success.
      for (const table of [outerMigrated, innerMigrated]) {
        const columns = await columnsOf(table);
        expect(columns).toContain(MIGRATION_TARGET.columnType);
        expect(columns).not.toContain(STORAGE_FORMAT.columns.type);
      }
    });

    /**
     * 🔴 The command an operator runs right after upgrading, on the exact
     * database this migration just produced.
     *
     * The core schema is a DESIRED shape, so a registry name in it that the
     * database does not have is an instruction to CREATE that table — and the
     * reader rule is legacy-if-present, so an empty `dynamic_components` beside
     * the populated `dynamic_field_groups` makes every field group unreachable
     * with nothing raised anywhere.
     *
     * The whole core schema is not reconciled here because this fixture holds
     * only the tables the migration touches; the invariant under test is
     * narrower and exact: **no core operation may name either registry.** Not
     * the legacy one, which must not be created, and not the migrated one,
     * whose shape the rename left matching.
     */
    it("proposes no core-schema change for the registry after a run", async () => {
      await migrate("up");

      const options = {
        fieldGroupRegistryTable: await resolveRegistryNameFromCatalog(
          adapter as never
        ),
      };
      expect(options.fieldGroupRegistryTable).toBe(
        MIGRATION_TARGET.registryTable
      );

      const live = await introspectLiveSnapshot(
        drizzleOf(adapter),
        entry.dialect,
        getCoreTableNames(options)
      );
      const ops = diffSnapshots(live, getCoreSchema(entry.dialect, options));

      expect(namesRegistry(ops, STORAGE_FORMAT.registryTable)).toEqual([]);
      expect(namesRegistry(ops, MIGRATION_TARGET.registryTable)).toEqual([]);
    });

    // The negative control for the case above, and the reason it is worth its
    // own leg: run the same reconcile WITHOUT resolving, and it proposes
    // creating the legacy registry on a database that has just been migrated.
    // That is the defect, reproduced against a real database.
    it("would create the legacy registry if the reconcile did not resolve", async () => {
      await migrate("up");

      const live = await introspectLiveSnapshot(
        drizzleOf(adapter),
        entry.dialect,
        getCoreTableNames()
      );
      const ops = diffSnapshots(live, getCoreSchema(entry.dialect));

      expect(namesRegistry(ops, STORAGE_FORMAT.registryTable)).toContain(
        "add_table"
      );
    });

    /**
     * 🔴 A write that lands after its step verified must stop the run settling.
     *
     * Each data step checks its surface the moment it finishes, so a row
     * committed afterwards sits in a surface nothing revisits and the run would
     * report success over storage that is not fully migrated. That row stays
     * readable while both spellings are served, so the failure only appears once
     * the contract release removes the legacy arm — with nothing left connecting
     * it to the migration that caused it.
     *
     * Planted after the run rather than raced against it: the outcome is what is
     * under test, and a row carrying the legacy wire key in an already-passed
     * surface is exactly the state a concurrent write leaves behind.
     */
    it("sees a legacy row left in a rewritten ledger", async () => {
      await migrate("up");
      // The control, and it is not optional: the assertion below passes against
      // a probe that reports everything as unsettled. This is what says the
      // probe can tell a clean run from a dirty one.
      await expect(settlementResidue()).resolves.toBeUndefined();

      await insertRow(adapter, "nextly_versions", {
        id: randomUUID(),
        scopeKind: "collection",
        scopeSlug: "articles",
        entryId: randomUUID(),
        status: "published",
        isAutosave: false,
        snapshot: { [STORAGE_FORMAT.wireTypeKey]: "hero" },
      });

      // The refusal is the step's own, so it names the surface and the row.
      // Asserted on `logContext.reason` rather than the message, which is the
      // operator-facing text and free to change.
      await expect(settlementResidue()).rejects.toMatchObject({
        logContext: {
          reason: "row rewrite did not reach every row",
          table: "nextly_versions",
          property: "snapshot",
        },
      });
    });

    /**
     * 🔴 The property the post-hoc assertion did not have: a retry converges.
     *
     * The settle step re-runs the ledger rewrites before it checks them, so a
     * straggler committed after its original step is simply rewritten. Planting
     * one before the run reaches its final step cannot be timed reliably, so it
     * is planted after a completed run and the step is re-driven — which is
     * exactly what an operator does after a refusal, and the case the previous
     * design could never clear.
     */
    it("rewrites a straggler rather than refusing forever", async () => {
      await migrate("up");

      await insertRow(adapter, "nextly_versions", {
        id: randomUUID(),
        scopeKind: "collection",
        scopeSlug: "articles",
        entryId: randomUUID(),
        status: "published",
        isAutosave: false,
        snapshot: { [STORAGE_FORMAT.wireTypeKey]: "hero" },
      });
      await expect(settlementResidue()).rejects.toMatchObject({
        logContext: { reason: "row rewrite did not reach every row" },
      });

      // The step's own run, which is what a retry executes.
      await withMigrationSession(
        {
          adapter: adapter as never,
          dialect: entry.dialect as MigrationDialect,
          label: "settle-retry",
        },
        session =>
          settleLedgersStep({
            meta: new MetaService(adapter as never, logger as never),
            migrationId: "settle-retry",
            from: LEGACY_STORAGE_VOCABULARY,
            to: FIELD_GROUP_STORAGE_VOCABULARY,
          }).run(session)
      );

      await expect(settlementResidue()).resolves.toBeUndefined();
    });

    /**
     * 🔴 The regression this whole module was reshaped around.
     *
     * A stored field definition's `type` is read through `STORAGE_FORMAT` by
     * code that accepts no other spelling, so a migration that moved it would
     * leave definitions the runtime cannot read — boot validation rejects every
     * field-group field and the application exits. The data survives and the
     * migration reports success, which is why nothing points back at it.
     *
     * Asserted against a real database rather than a fake one because the
     * rewrite that caused it went through the same typed CRUD this fixture
     * uses, and a unit double cannot show that the column was left alone in the
     * three dialects' JSON encodings.
     */
    it("leaves stored field definitions in the legacy vocabulary", async () => {
      const registryRow = async (): Promise<Record<string, unknown>> => {
        const table = await resolveRegistryNameFromCatalog(adapter as never);
        const rows = await selectRows(adapter, table, {
          and: [{ column: "slug", op: "=", value: outerSlug }],
        });
        const row = rows[0];
        if (row === undefined)
          throw new Error(`no registry row for ${outerSlug}`);
        return row;
      };

      // The control: the definition carries the legacy spelling BEFORE the run,
      // so the assertion afterwards is about the migration rather than about a
      // fixture that never had it.
      expect(JSON.stringify((await registryRow()).fields)).toContain(
        `"${STORAGE_FORMAT.fieldType}"`
      );

      await migrate("up");

      const after = await registryRow();
      expect(JSON.stringify(after.fields)).toContain(
        `"${STORAGE_FORMAT.fieldType}"`
      );
      expect(JSON.stringify(after.fields)).not.toContain(
        `"${MIGRATION_TARGET.fieldType}"`
      );
      // The registry's own provenance column is left alone for the same reason:
      // nothing compares it on read, and the code sync rewrites it on the next
      // boot, so moving it is churn a settlement check then has to chase.
      expect(String(after.configPath)).toContain(STORAGE_FORMAT.configPathDir);
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

      // The inverse of the up assertion. A rollback that restores the names
      // while leaving the discriminator migrated is structurally successful and
      // unreadable, which is the same failure shape as a stranded pointer.
      for (const table of [outerTable, innerTable]) {
        const columns = await columnsOf(table);
        expect(columns).toContain(STORAGE_FORMAT.columns.type);
        expect(columns).not.toContain(MIGRATION_TARGET.columnType);
      }

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
