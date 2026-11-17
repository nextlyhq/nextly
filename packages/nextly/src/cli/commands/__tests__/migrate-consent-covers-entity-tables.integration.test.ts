/**
 * A data-loss consent naming a collection's or Single's main table covers the
 * rest of that entity and nothing of another: its translation and junction
 * tables, and its rows in shared tables, on PostgreSQL, MySQL and SQLite.
 *
 * One migration drops a translated collection and a translated Single, each
 * with a junction table and field-group values, while another collection with
 * its own junction stays. A consent naming only one of the two, or only the
 * staying collection, refuses the whole run before anything changes: every
 * table, every row (registry rows, permissions, history rows, the archive,
 * field-group values and the record of content events among them) and the
 * ledger are as they were. A consent naming both main tables applies the
 * drops. Before any consent, the listing gives each owned table's rows and
 * each entity's own rows in each shared table.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  NO_CONSENT,
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import { marksNoTransaction } from "../../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../errors/nextly-error";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";
import { downDatabaseDeps, migrateDownCore } from "../migrate-down";

/** Every table a lock keeps its row in: not part of what a run leaves behind. */
const LOCK_TABLES = new Set([
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
]);

const logger = createLogger({ quiet: true });

/** The consent `--accept-data-loss=<targets>` gives. */
function consentFor(targets: string): DataLossConsent {
  return resolveDataLossConsent({ flag: targets, env: {} });
}

/** A many-to-many field keeping its links in a junction it names. */
function manyToMany(name: string, target: string, junctionTable: string) {
  return {
    name,
    type: "relationship",
    options: { relationType: "manyToMany", target, junctionTable },
  };
}

describe.each(LOCK_DIALECTS)(
  "consent naming an entity's main table on %s",
  dialect => {
    const P = `cce_${randomBytes(3).toString("hex")}`;
    // A translated collection and a translated Single the migration drops, each with a junction.
    const posts = `${P}_posts`;
    const home = `${P}_home`;
    // A collection that stays, with a junction of its own.
    const pages = `${P}_pages`;
    // The field groups' shared table: each entity's values keyed by its main table.
    const seo = `comp_${P}_seo`;
    let seq = 0;
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-entity-consent-"));
      // Nextly's own tables first, then the entities' tables and rows.
      await migrate();
      const entityTables = (main: string, junction: string) => [
        `CREATE TABLE ${main} (id varchar(36) PRIMARY KEY, title varchar(64))`,
        `CREATE TABLE ${main}_locales (id varchar(36) PRIMARY KEY, parent_id varchar(36), locale varchar(8), title varchar(64))`,
        `CREATE TABLE ${junction} (id varchar(36) PRIMARY KEY, source_id varchar(36), target_id varchar(36))`,
        `INSERT INTO ${main} (id, title) VALUES ('e1', 'a')`,
        `INSERT INTO ${main}_locales (id, parent_id, locale, title) VALUES ('l1', 'e1', 'fr', 'b')`,
        `INSERT INTO ${junction} (id, source_id, target_id) VALUES ('j1', 'e1', 't1')`,
      ];
      file(
        [
          ...entityTables(posts, `${posts}_tags`),
          ...entityTables(home, `${home}_links`),
          ...entityTables(pages, `${pages}_refs`),
          `CREATE TABLE ${seo} (id varchar(36) PRIMARY KEY, _parent_id varchar(36), _parent_table varchar(128), _parent_field varchar(64), _order integer, title varchar(64))`,
          `INSERT INTO ${seo} (id, _parent_id, _parent_table, _parent_field, _order, title) VALUES ('s1', 'e1', '${posts}', 'seo', 0, 'p'), ('s2', 'e1', '${home}', 'seo', 0, 'h'), ('s3', 'e1', '${pages}', 'seo', 0, 'g')`,
        ],
        []
      );
      expect((await migrate()).applied).toBe(1);
      await register("collection", "posts", posts, `${posts}_tags`);
      await register("single", "home", home, `${home}_links`);
      await register("collection", "pages", pages, `${pages}_refs`);
      for (const [kind, slug] of [
        ["collection", "posts"],
        ["single", "home"],
        ["collection", "pages"],
      ] as const) {
        await seedSharedRows(kind, slug);
      }
    }, 180_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    /** The entity's registry row, naming its main table and the junction its field names. */
    async function register(
      kind: "collection" | "single",
      slug: string,
      table: string,
      junction: string
    ) {
      const now = new Date();
      const common = {
        id: randomUUID(),
        slug,
        tableName: table,
        fields: [
          { name: "title", type: "text" },
          manyToMany("links", "x", junction),
        ],
        schemaHash: "h",
        source: "code",
        createdAt: now,
        updatedAt: now,
      };
      await adapter.insert(
        kind === "collection" ? "dynamic_collections" : "dynamic_singles",
        kind === "collection"
          ? { ...common, labels: { singular: slug, plural: slug } }
          : { ...common, label: slug }
      );
    }

    /** One of each history row, an archived translation, a permission and a content event of the entity's document. */
    async function seedSharedRows(kind: "collection" | "single", slug: string) {
      const now = new Date();
      await adapter.insert("nextly_versions", {
        id: randomUUID(),
        scopeKind: kind,
        scopeSlug: slug,
        entryId: "e1",
        versionNo: null,
        status: "draft",
        isAutosave: true,
        snapshot: JSON.stringify({}),
        createdAt: now,
        updatedAt: now,
      });
      await adapter.insert("nextly_version_pins", {
        id: randomUUID(),
        scopeKind: kind,
        scopeSlug: slug,
        entryId: "e1",
        holder: "release",
        slot: "s",
        versionNo: 1,
        pinKey: `${kind}:${slug}:e1`,
        createdAt: now,
        updatedAt: now,
      });
      await adapter.insert("nextly_version_views", {
        id: randomUUID(),
        userId: "u1",
        scopeKind: kind,
        scopeSlug: slug,
        entryId: "e1",
        part: "",
        viewKey: `${kind}:${slug}:e1:u1`,
        versionNo: 1,
        viewedAt: now,
        visitStartedAt: now,
        createdAt: now,
      });
      await adapter.insert("nextly_i18n_archive", {
        collection: slug,
        entityKind: kind,
        entryId: "e1",
        locale: "fr",
        field: "title",
        value: "b",
        archivedAt: now,
      });
      await adapter.insert("permissions", {
        id: randomUUID(),
        name: `Read ${slug}`,
        slug: `read-${slug}`,
        action: "read",
        resource: slug,
        createdAt: now,
        updatedAt: now,
      });
      await adapter.insert("nextly_content_events", {
        id: randomUUID(),
        subjectKind: kind,
        subjectSlug: slug,
        subjectId: "e1",
        kind: "updated",
        actorKind: "system",
        occurredAt: now,
      });
    }

    function migrate(
      consent: DataLossConsent = NO_CONSENT,
      extra: { interactive?: boolean; printed?: string[] } = {}
    ) {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger:
          extra.printed === undefined
            ? logger
            : {
                ...logger,
                warn: (line: string) => {
                  extra.printed?.push(line);
                },
              },
        lockMode: "wait",
        lockWaitMs: 30_000,
        consent,
        interactive: extra.interactive ?? false,
        // A person at the terminal who answers no.
        askToDelete: () => Promise.resolve(false),
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
    }

    async function migrateDown(consent: DataLossConsent) {
      return migrateDownCore({
        ...(await downDatabaseDeps({ adapter, dialect })),
        nodeEnv: "test",
        logger,
        options: { step: 1, yes: true, consent },
        fileExists: () => Promise.resolve(true),
        readDownSql: filename => {
          const content = readFileSync(join(migrationsDir, filename), "utf8");
          return Promise.resolve({
            sql: parseSqlSections(content).downSql,
            transaction: !marksNoTransaction(content),
          });
        },
        withLock: withMigrateLock,
      });
    }

    /** A hand-written migration file, after the ones before it. */
    function file(up: string[], down: string[]): string {
      seq += 1;
      const name = `20261116_${String(seq).padStart(6, "0")}_${P}`;
      const statements = (list: string[]) => list.map(s => `${s};`).join("\n");
      writeFileSync(
        join(migrationsDir, `${name}.sql`),
        `-- Migration: ${name}\n\n-- UP\n${statements(up)}\n\n-- DOWN\n${statements(down)}\n`,
        "utf8"
      );
      return `${name}.sql`;
    }

    /** The migration that drops both entities: junctions, then translation tables, then main tables. */
    function dropBoth(): string {
      return file(
        [
          `DROP TABLE ${posts}_tags`,
          `DROP TABLE ${home}_links`,
          `DROP TABLE ${posts}_locales`,
          `DROP TABLE ${home}_locales`,
          `DROP TABLE ${posts}`,
          `DROP TABLE ${home}`,
        ],
        []
      );
    }

    /** How many rows of one entity each shared table holds, by kind. */
    async function sharedRowsOf(
      kind: "collection" | "single",
      slug: string,
      main: string
    ) {
      const count = async (table: string, where: string) =>
        Number(
          (
            await adapter.executeQuery<{ n: unknown }>(
              `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`
            )
          )[0]?.n ?? 0
        );
      const scoped = `scope_kind = '${kind}' AND scope_slug = '${slug}'`;
      return {
        versions: await count("nextly_versions", scoped),
        pins: await count("nextly_version_pins", scoped),
        views: await count("nextly_version_views", scoped),
        archive: await count(
          "nextly_i18n_archive",
          `collection = '${slug}' AND entity_kind = '${kind}'`
        ),
        events: await count(
          "nextly_content_events",
          `subject_kind = '${kind}' AND subject_slug = '${slug}'`
        ),
        permissions: await count("permissions", `resource = '${slug}'`),
        fieldGroups: await count(seo, `_parent_table = '${main}'`),
      };
    }

    /** Every table's row count, the registries' slugs and the ledger. */
    async function databaseState() {
      const tables: Record<string, number> = {};
      for (const name of (await adapter.listTables()).sort()) {
        if (LOCK_TABLES.has(name)) continue;
        const rows = await adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${name}`
        );
        tables[name] = Number(rows[0]?.n ?? 0);
      }
      const slugs = async (registry: string) =>
        (
          await adapter.executeQuery<{ slug: string }>(
            `SELECT slug FROM ${registry}`
          )
        )
          .map(row => row.slug)
          .sort();
      const ledger = (
        await new SchemaEventsRepository(
          adapter.getDrizzle(),
          dialect
        ).listFileApplies()
      )
        .map(row => `${row.filename}:${row.status}`)
        .sort();
      // Whether each permission is orphaned, which a run removing a registry row would change.
      const permissions = (
        await adapter.executeQuery<{ slug: string; orphaned_at: unknown }>(
          "SELECT slug, orphaned_at FROM permissions"
        )
      )
        .map(
          row => `${row.slug}:${row.orphaned_at === null ? "kept" : "orphaned"}`
        )
        .sort();
      return {
        tables,
        permissions,
        collections: await slugs("dynamic_collections"),
        singles: await slugs("dynamic_singles"),
        ledger,
      };
    }

    /** The refusal a run ended with, and that it changed nothing. */
    async function refusedUnchanged(work: () => Promise<unknown>) {
      const before = await databaseState();
      // The fixture reaches every kind of row the assertion is about.
      for (const table of [
        `${home}_locales`,
        `${home}_links`,
        seo,
        "nextly_versions",
        "nextly_version_pins",
        "nextly_version_views",
        "nextly_i18n_archive",
        "nextly_content_events",
        "permissions",
      ]) {
        expect(before.tables[table], table).toBeGreaterThan(0);
      }
      const error = await work().then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(error)).toBe(true);
      expect(await databaseState()).toEqual(before);
      return (error as NextlyError).publicMessage;
    }

    it("refuses the whole run when the consent names only the collection's main table", async () => {
      const name = dropBoth();
      const message = await refusedUnchanged(() => migrate(consentFor(posts)));
      expect(message).toContain(name);
      // Named: the Single's tables, with their rows, and its rows in each shared table.
      expect(message).toContain(`table ${home} (1 row)`);
      expect(message).toContain(
        `table ${home}_locales (1 row), belonging to ${home}`
      );
      expect(message).toContain(
        `table ${home}_links (1 row), belonging to ${home}`
      );
      for (const shared of [
        seo,
        "nextly_i18n_archive",
        "nextly_versions",
        "nextly_version_pins",
        "nextly_version_views",
      ]) {
        expect(message).toContain(`rows of Single "home" in ${shared} (1 row)`);
      }
      // Not named: what the consent covers, the collection's translation table and junction.
      expect(message).not.toContain(`${posts}_locales`);
      expect(message).not.toContain(`${posts}_tags`);
      expect(message).toContain(`--accept-data-loss=${posts},${home}`);
    }, 180_000);

    it("covers none of the removed entities when the consent names another collection's main table", async () => {
      dropBoth();
      const message = await refusedUnchanged(() => migrate(consentFor(pages)));
      expect(message).toContain(
        `table ${posts}_locales (1 row), belonging to ${posts}`
      );
      expect(message).toContain(`rows of collection "posts" in ${seo} (1 row)`);
      expect(message).toContain(`table ${home} (1 row)`);
    }, 180_000);

    it("applies the drops when the consent names both main tables", async () => {
      dropBoth();
      expect((await migrate(consentFor(`${posts},${home}`))).applied).toBe(1);
      const after = await databaseState();
      for (const gone of [
        posts,
        `${posts}_locales`,
        `${posts}_tags`,
        home,
        `${home}_locales`,
        `${home}_links`,
      ]) {
        expect(after.tables[gone], gone).toBeUndefined();
      }
      // The collection that stays keeps its tables, its junction and their rows.
      expect(after.tables[pages]).toBe(1);
      expect(after.tables[`${pages}_locales`]).toBe(1);
      expect(after.tables[`${pages}_refs`]).toBe(1);
      // And its rows in every shared table, which a consent naming the two others does not reach.
      expect(await sharedRowsOf("collection", "pages", pages)).toEqual({
        versions: 1,
        pins: 1,
        views: 1,
        archive: 1,
        events: 1,
        permissions: 1,
        fieldGroups: 1,
      });
    }, 180_000);

    it("lists each owned table's rows and each entity's own shared rows before asking", async () => {
      dropBoth();
      const printed: string[] = [];
      const before = await databaseState();
      const error = await migrate(NO_CONSENT, {
        interactive: true,
        printed,
      }).then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(error) && error.code).toBe("DATA_LOSS_DECLINED");
      expect(await databaseState()).toEqual(before);
      const listing = printed.join("\n");
      expect(listing).toContain(
        `table ${posts}_tags (1 row), belonging to ${posts}`
      );
      // The entity's own rows in a shared table, never the table's: each holds three entities' rows.
      expect(listing).toContain(
        `rows of collection "posts" in nextly_versions (1 row): its autosaves`
      );
      expect(listing).toContain(
        `rows of Single "home" in nextly_i18n_archive (1 row): its archived translations`
      );
      expect(listing).not.toContain(`"pages"`);
    }, 180_000);

    it("rolls back a migration adding a collection under consent naming its main table, and refuses consent naming another", async () => {
      const docs = `${P}_docs`;
      file(
        [
          `CREATE TABLE ${docs} (id varchar(36) PRIMARY KEY)`,
          `CREATE TABLE ${docs}_locales (id varchar(36) PRIMARY KEY, locale varchar(8))`,
          `CREATE TABLE ${docs}_tags (id varchar(36) PRIMARY KEY)`,
        ],
        [
          `DROP TABLE ${docs}_tags`,
          `DROP TABLE ${docs}_locales`,
          `DROP TABLE ${docs}`,
        ]
      );
      expect((await migrate()).applied).toBe(1);
      await register("collection", "docs", docs, `${docs}_tags`);
      const before = await databaseState();
      const refused = await migrateDown(consentFor(pages)).then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(refused)).toBe(true);
      expect((refused as NextlyError).publicMessage).toContain(
        `table ${docs}_locales (0 rows), belonging to ${docs}`
      );
      expect(await databaseState()).toEqual(before);
      expect((await migrateDown(consentFor(docs))).rolledBack).toHaveLength(1);
      const after = await databaseState();
      expect(after.tables[docs]).toBeUndefined();
      expect(after.tables[`${docs}_locales`]).toBeUndefined();
      expect(after.tables[`${docs}_tags`]).toBeUndefined();
    }, 180_000);
  }
);
