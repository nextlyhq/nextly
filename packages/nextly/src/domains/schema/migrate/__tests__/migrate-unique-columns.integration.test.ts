/**
 * `nextly migrate` making a column unique, on every dialect, through the real command core
 * (`migrateCore`) and a migrations folder of the test's own.
 *
 * - A file creating a unique index on a collection's column whose entries repeat a value is
 *   refused before any statement, naming the collection, the field and each repeated value with
 *   how many entries hold it. Nothing is applied and the ledger records nothing.
 * - A file creating one over a column whose only repeats are entries holding no value is applied,
 *   and the column then refuses a repeat.
 * - A one-to-one an earlier release left without its uniqueness is made unique by the run, after
 *   its files, and then refuses a repeat; while any one-to-one repeats a value the run refuses,
 *   naming each, and makes none unique; a run stopped part-way is finished by the next, which
 *   adds only what is missing.
 * - A later file creating the uniqueness the run already made is applied, its index left out:
 *   MySQL, with no `IF NOT EXISTS`, would refuse the duplicate name.
 * - A translated one-to-one is made unique within each language, on its translations table, and
 *   refused while two documents in one language point at one person, naming the language; a
 *   Single's one-to-one is made unique as a collection's is.
 * - An upgrade run with nothing pending changes nothing in the database but the one-to-one's
 *   uniqueness, and with a repeat changes nothing at all: the one-to-one case of the gate that
 *   holds an upgrade to the operations it is allowed.
 *
 * The tables come from the production generators and the index statement from the production
 * template, in a file written by `migrate:create`'s own formatter. Each test runs on a database
 * of its own, because each runs the whole command.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateCore, runPluginPhase } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { NextlyError } from "../../../../errors/nextly-error";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { companionUniqueIndexName } from "../../../i18n/migration/companion-unique-indexes";
import { ensureCompanionTable } from "../../../i18n/runtime/companion-io";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { ensureSchemaEventsTable } from "../../events/schema-events-ddl";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { SchemaOwnersRepository } from "../../ownership/schema-owners-repository";
import { buildCollectionMetadataUpsert } from "../../ui-schema/metadata-sql";
import { formatMigrationFile } from "../../migrate-create/format-file";
import { diffSnapshots } from "../../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  readIndexUniqueness,
  readUniqueColumns,
  uniqueIndexNames,
} from "../../pipeline/live-table-facts";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { createIndexSql } from "../../pipeline/sql-templates/create-index";
import { splitStatements } from "../../pipeline/sql-statement-utils";
import { uniqueIndexNameForColumn } from "../../services/index-name";
import { NO_CONSENT } from "../data-loss-consent";
import {
  migrationChecksum,
  type MigrationContent,
} from "../plugin/plugin-migration";
import {
  adoptUniqueIndexesAlreadyThere,
  readRepeatedValues,
} from "../unique-column-guard";

const logger = createLogger({ quiet: true });
const NAME = "20261111_000001_unique_column";
const FILE = `${NAME}.sql`;

const PEOPLE = "dc_people";
const PROFILES = "dc_profiles";
const NOTES = "dc_notes";
const NOTES_LOCALES = `${NOTES}_locales`;
const SETTINGS = resolveSingleTableName({ slug: "settings" });
const UNIQUE = uniqueIndexNameForColumn(PROFILES, "person");

/** A relationship of the profiles to a person, as the earlier Builder stored it. */
const relationship = (
  name: string,
  relationType: "manyToOne" | "oneToOne"
) => ({
  name,
  type: "relationship",
  options: { target: "people", relationType },
});

describe.each(LOCK_DIALECTS)(
  "nextly migrate making a column unique on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-unique-column-"));
      // Nextly's own tables, the registry among them, so the file is all a run has left to do.
      await migrate();
      await seedEntities();
    }, 120_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    function migrate() {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
        consent: NO_CONSENT,
      });
    }

    async function run(statements: string[]): Promise<void> {
      for (const statement of statements) await adapter.executeQuery(statement);
    }

    /**
     * People, and profiles each pointing at a person by two relationships the earlier Builder made
     * without uniqueness: their tables from the production generators, and their registry rows.
     */
    async function seedEntities(): Promise<void> {
      const tables = new DynamicCollectionSchemaService(undefined, dialect);
      const profileFields = [
        relationship("person", "manyToOne"),
        relationship("partner", "manyToOne"),
      ];
      await run(
        splitStatements([
          tables.generateMigrationSQL(PEOPLE, [
            { name: "name", type: "text" },
          ] as never),
          tables.generateMigrationSQL(PROFILES, profileFields as never),
        ])
      );
      for (const [slug, tableName, fields] of [
        ["people", PEOPLE, [{ name: "name", type: "text" }]],
        ["profiles", PROFILES, profileFields],
      ] as const) {
        await adapter.insert("dynamic_collections", {
          // The registries key rows by UUID on PostgreSQL.
          id: randomUUID(),
          slug,
          labels: { singular: slug, plural: slug },
          tableName,
          fields,
          source: "ui",
          locked: false,
          schemaHash: "test",
          schemaVersion: 1,
          migrationStatus: "applied",
        } as never);
      }
      await run(
        ["ada", "bob"].map(
          id =>
            `INSERT INTO ${q(PEOPLE)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
        )
      );
    }

    /** A profile pointing at `person`, or at no one, and at `partner`, or at no one. */
    function profile(
      id: string,
      person: string | null,
      partner: string | null = null
    ): string {
      const value = (v: string | null) => (v === null ? "NULL" : `'${v}'`);
      return `INSERT INTO ${q(PROFILES)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("person")}, ${q("partner")}) VALUES ('${id}', '${id}', '${id}', ${value(person)}, ${value(partner)})`;
    }

    /**
     * The profiles' relationships recorded as one-to-ones, as the registry holds a one-to-one the
     * earlier Builder added to an existing collection: its column left without uniqueness.
     */
    async function recordOneToOnes(...names: string[]): Promise<void> {
      const fields = ["person", "partner"].map(name =>
        relationship(name, names.includes(name) ? "oneToOne" : "manyToOne")
      );
      await adapter.executeQuery(
        `UPDATE ${q("dynamic_collections")} SET ${q("fields")} = '${JSON.stringify(fields)}' WHERE ${q("slug")} = 'profiles'`
      );
    }

    async function isUnique(column: string): Promise<boolean> {
      return (
        await readUniqueColumns(adapter.getDrizzle(), dialect, PROFILES)
      ).has(column);
    }

    /** The file as `migrate:create` writes it: the unique index the generators write. */
    function writeUniqueFile(): void {
      writeFileAs(NAME, [
        createIndexSql(
          PROFILES,
          { name: UNIQUE, columns: ["person"], unique: true },
          dialect,
          q
        ),
      ]);
    }

    /** A file named `name` holding `statements`, as `migrate:create`'s formatter writes it. */
    function writeFileAs(name: string, statements: string[]): void {
      writeFileSync(
        join(migrationsDir, `${name}.sql`),
        formatMigrationFile({
          name,
          dialect,
          sqlStatements: statements,
          downSqlStatements: [],
          collections: [],
          singles: [],
          components: [],
          hasUserExt: false,
        }),
        "utf8"
      );
    }

    async function refusal(): Promise<NextlyError> {
      const error = await migrate().then(
        () => undefined,
        (thrown: unknown) => thrown
      );
      expect(NextlyError.is(error)).toBe(true);
      return error as NextlyError;
    }

    async function ledger(): Promise<string[]> {
      const rows = await new SchemaEventsRepository(
        adapter.getDrizzle(),
        dialect
      ).findFileApplies(FILE);
      return rows.map(row => row.status);
    }

    async function personIsUnique(): Promise<boolean> {
      return (
        await readUniqueColumns(adapter.getDrizzle(), dialect, PROFILES)
      ).has("person");
    }

    async function refusedAsRepeat(statement: string): Promise<boolean> {
      return adapter.executeQuery(statement).then(
        () => false,
        () => true
      );
    }

    it("refuses a file making a column unique over entries that repeat a value, naming each value; nothing applied", async () => {
      await run([
        profile("p1", "ada"),
        profile("p2", "ada"),
        profile("p3", "ada"),
        profile("p4", "bob"),
        profile("p5", "bob"),
        profile("p6", null),
      ]);
      writeUniqueFile();

      const error = await refusal();

      expect(error.publicMessage).toBe(
        `${FILE} was not applied. Collection 'profiles': field 'person' cannot become unique while 2 values repeat: "ada" (3 entries), "bob" (2 entries). Give each entry its own value, or clear the repeats, then run \`nextly migrate\` again.`
      );
      expect(await personIsUnique()).toBe(false);
      expect(await ledger()).toEqual([]);
    }, 120_000);

    it("applies a file making a column unique whose only repeats hold no value, which then refuses a repeat", async () => {
      await run([
        profile("p1", "ada"),
        profile("p2", null),
        profile("p3", null),
      ]);
      writeUniqueFile();

      await migrate();

      expect(await personIsUnique()).toBe(true);
      expect(await refusedAsRepeat(profile("p4", "ada"))).toBe(true);
    }, 120_000);

    it("makes a one-to-one an earlier release left without uniqueness unique, which then refuses a repeat", async () => {
      await recordOneToOnes("person");
      await run([
        profile("p1", "ada"),
        profile("p2", "bob"),
        profile("p3", null),
        profile("p4", null),
      ]);

      await migrate();

      expect(await isUnique("person")).toBe(true);
      // A many-to-one is left as it is.
      expect(await isUnique("partner")).toBe(false);
      expect(await refusedAsRepeat(profile("p5", "ada"))).toBe(true);
      expect(await refusedAsRepeat(profile("p6", null))).toBe(false);
    }, 120_000);

    it("refuses while a one-to-one repeats a value, naming each, and makes none unique", async () => {
      await recordOneToOnes("person", "partner");
      await run([
        profile("p1", "ada", "ada"),
        profile("p2", "ada", "bob"),
        profile("p3", "bob", null),
      ]);

      const error = await refusal();

      expect(error.publicMessage).toBe(
        `Making one-to-one relationships unique was not applied. Collection 'profiles': field 'person' cannot become unique while 1 value repeats: "ada" (2 entries). Give each entry its own value, or clear the repeats, then run \`nextly migrate\` again.`
      );
      expect(await isUnique("person")).toBe(false);
      expect(await isUnique("partner")).toBe(false);
    }, 120_000);

    it("finishes a run stopped part-way, adding only the uniqueness still missing", async () => {
      await recordOneToOnes("person", "partner");
      await run([profile("p1", "ada", "bob"), profile("p2", "bob", "ada")]);
      // As a run stopped after its first index leaves it.
      await run([
        createIndexSql(
          PROFILES,
          { name: UNIQUE, columns: ["person"], unique: true },
          dialect,
          q
        ),
      ]);

      await migrate();
      await migrate();

      expect(await isUnique("person")).toBe(true);
      expect(await isUnique("partner")).toBe(true);
      expect(await refusedAsRepeat(profile("p3", null, "bob"))).toBe(true);
    }, 120_000);

    it("applies a later file creating the uniqueness the run already made, leaving its index out", async () => {
      await recordOneToOnes("person");
      await run([profile("p1", "ada"), profile("p2", "bob")]);
      await migrate();
      expect(await isUnique("person")).toBe(true);

      writeUniqueFile();
      await migrate();

      expect(await ledger()).toEqual(["applied"]);
      expect(await isUnique("person")).toBe(true);
      expect(await refusedAsRepeat(profile("p3", "ada"))).toBe(true);
    }, 120_000);

    /**
     * Notes, translated, each pointing at a person by a translated relationship the earlier
     * Builder made without uniqueness, recorded now as a one-to-one: the main table from the
     * production generator and the translations table as the runtime creates it.
     */
    async function seedTranslatedNotes(): Promise<void> {
      const tables = new DynamicCollectionSchemaService(undefined, dialect);
      await run(
        splitStatements([tables.generateMigrationSQL(NOTES, [] as never)])
      );
      const person = (relationType: "manyToOne" | "oneToOne") => ({
        ...relationship("person", relationType),
        localized: true,
      });
      await ensureCompanionTable(adapter as never, {
        builtBy: "collection",
        slug: "notes",
        tableName: NOTES,
        fields: [person("manyToOne")] as never,
        dialect,
      });
      await adapter.insert("dynamic_collections", {
        id: randomUUID(),
        slug: "notes",
        labels: { singular: "notes", plural: "notes" },
        tableName: NOTES,
        fields: [person("oneToOne")],
        localized: true,
        source: "ui",
        locked: false,
        schemaHash: "test",
        schemaVersion: 1,
        migrationStatus: "applied",
      } as never);
      await run(
        ["n1", "n2", "n3"].map(
          id =>
            `INSERT INTO ${q(NOTES)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
        )
      );
    }

    /** A note's person in one language. */
    function noteIn(note: string, language: string, person: string): string {
      return `INSERT INTO ${q(NOTES_LOCALES)} (${q("_parent")}, ${q("_locale")}, ${q("person")}) VALUES ('${note}', '${language}', '${person}')`;
    }

    async function notesPersonIsUniquePerLanguage(): Promise<boolean> {
      return uniqueIndexNames(
        await readIndexUniqueness(adapter.getDrizzle(), dialect, NOTES_LOCALES)
      ).has(companionUniqueIndexName(NOTES_LOCALES, "person"));
    }

    it("makes a translated one-to-one unique within each language", async () => {
      await seedTranslatedNotes();
      await run([
        noteIn("n1", "en", "ada"),
        noteIn("n2", "en", "bob"),
        noteIn("n1", "de", "bob"),
      ]);

      await migrate();

      expect(await notesPersonIsUniquePerLanguage()).toBe(true);
      expect(await refusedAsRepeat(noteIn("n3", "en", "ada"))).toBe(true);
      expect(await refusedAsRepeat(noteIn("n3", "de", "ada"))).toBe(false);
    }, 120_000);

    it("refuses while two documents in one language point at one person, naming the language", async () => {
      await seedTranslatedNotes();
      await run([noteIn("n1", "en", "ada"), noteIn("n2", "en", "ada")]);

      const error = await refusal();

      expect(error.publicMessage).toBe(
        `Making one-to-one relationships unique was not applied. Collection 'notes': field 'person' cannot become unique while 1 value repeats: "ada" (2 entries in "en"). Give each entry its own value, or clear the repeats, then run \`nextly migrate\` again.`
      );
      expect(await notesPersonIsUniquePerLanguage()).toBe(false);
    }, 120_000);

    it("makes a Single's one-to-one unique", async () => {
      const tables = new DynamicCollectionSchemaService(undefined, dialect);
      await run(
        splitStatements([
          tables.generateMigrationSQL(
            SETTINGS,
            [relationship("owner", "manyToOne")] as never,
            { isSingle: true }
          ),
        ])
      );
      await adapter.insert("dynamic_singles", {
        id: randomUUID(),
        slug: "settings",
        label: "settings",
        tableName: SETTINGS,
        fields: [relationship("owner", "oneToOne")],
        source: "ui",
        locked: false,
        schemaHash: "test",
        schemaVersion: 1,
        migrationStatus: "applied",
      } as never);

      await migrate();

      expect(
        (await readUniqueColumns(adapter.getDrizzle(), dialect, SETTINGS)).has(
          "owner"
        )
      ).toBe(true);
    }, 120_000);

    /** Every table of the database, as introspection reads it. */
    async function wholeDatabase() {
      const tables = await (
        adapter as unknown as { listTables(): Promise<string[]> }
      ).listTables();
      return introspectLiveSnapshot(adapter.getDrizzle(), dialect, tables);
    }

    it("plans nothing on an upgrade with nothing pending but the one-to-one's uniqueness", async () => {
      await recordOneToOnes("person");
      await run([profile("p1", "ada"), profile("p2", "bob")]);
      const before = await wholeDatabase();

      await migrate();

      const changes = diffSnapshots(before, await wholeDatabase());
      expect(
        changes.map(change =>
          change.type === "add_index"
            ? `${change.type} ${change.tableName}.${change.index.name}`
            : change.type
        )
      ).toEqual([`add_index ${PROFILES}.${UNIQUE}`]);
    }, 120_000);

    it("changes nothing on an upgrade with nothing pending while the one-to-one repeats a value", async () => {
      await recordOneToOnes("person");
      await run([profile("p1", "ada"), profile("p2", "ada")]);
      const before = await wholeDatabase();

      await refusal();

      expect(diffSnapshots(before, await wholeDatabase())).toEqual([]);
    }, 120_000);

    it("leaves a one-to-one's uniqueness gone when a file makes it many-to-one and records it so", async () => {
      await recordOneToOnes("person");
      await migrate();
      expect(await isUnique("person")).toBe(true);
      // As `migrate:create` writes the change: the index dropped, and the registry row the file
      // carries for the collection whose table it changes.
      writeFileAs(NAME, [
        dialect === "mysql"
          ? `DROP INDEX ${q(UNIQUE)} ON ${q(PROFILES)}`
          : `DROP INDEX IF EXISTS ${q(UNIQUE)}`,
        buildCollectionMetadataUpsert(
          {
            slug: "profiles",
            labels: { singular: "profiles", plural: "profiles" },
            fields: [
              relationship("person", "manyToOne"),
              relationship("partner", "manyToOne"),
            ],
          } as never,
          dialect
        ).replace(/;\s*$/, ""),
      ]);
      await run([profile("p1", "ada")]);

      await migrate();

      expect(await isUnique("person")).toBe(false);
      expect(await refusedAsRepeat(profile("p2", "ada"))).toBe(false);
    }, 120_000);

    it("refuses a plugin's module making its table's column unique over repeats, before its first statement", async () => {
      const notes = "plugin_notes_unique";
      await run([
        `CREATE TABLE ${q(notes)} (${q("id")} varchar(36) PRIMARY KEY, ${q("code")} varchar(64))`,
        `INSERT INTO ${q(notes)} (${q("id")}, ${q("code")}) VALUES ('n1', 'x'), ('n2', 'x')`,
      ]);
      await new SchemaOwnersRepository(adapter.getDrizzle(), dialect).upsert([
        {
          tableName: notes,
          ownerKind: "plugin",
          ownerId: "ucx",
          migratedBy: "plugin:ucx",
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "active",
        },
      ]);
      const up = [
        `ALTER TABLE ${q(notes)} ADD COLUMN ${q("extra")} varchar(255)`,
        createIndexSql(
          notes,
          { name: "uq_plugin_notes_code", columns: ["code"], unique: true },
          dialect,
          q
        ),
      ];
      const none = { tables: [] };
      const sides = { postgresql: none, mysql: none, sqlite: none };
      const content: MigrationContent = {
        name: "20261111_000002_unique_code",
        schemaVersion: 1,
        dialects: {
          postgresql: { up, down: [] },
          mysql: { up, down: [] },
          sqlite: { up, down: [] },
        },
        snapshot: sides,
        before: sides,
      };

      const error = await runPluginPhase({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        pluginMigrationSets: [
          {
            pluginName: "ucx",
            pluginVersion: "1.0.0",
            migrations: [{ ...content, checksum: migrationChecksum(content) }],
          },
        ],
      }).then(
        () => undefined,
        (thrown: unknown) => thrown
      );

      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).publicMessage).toContain(
        `Table '${notes}': column 'code' cannot become unique while 1 value repeats: "x" (2 entries).`
      );
      const live = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
        notes,
      ]);
      expect(live.tables[0]?.columns.map(c => c.name)).not.toContain("extra");
    }, 120_000);

    it.skipIf(dialect === "mysql")(
      "adopts no unique index the database holds over part of the column only",
      async () => {
        await run([
          `CREATE UNIQUE INDEX ${q(UNIQUE)} ON ${q(PROFILES)} (${q("person")}) WHERE ${q("person")} <> 'ada'`,
        ]);
        const statement = createIndexSql(
          PROFILES,
          { name: UNIQUE, columns: ["person"], unique: true },
          dialect,
          q
        );

        const adoption = await adoptUniqueIndexesAlreadyThere(
          adapter.getDrizzle(),
          dialect,
          [statement]
        );

        expect(adoption).toEqual({ statements: [statement], adopted: [] });
      },
      120_000
    );

    it("counts no blank as a repeat where the index leaves blanks out", async () => {
      const codes = "dc_unique_codes";
      await run([
        `CREATE TABLE ${q(codes)} (${q("id")} varchar(36) PRIMARY KEY, ${q("code")} varchar(64), ${q("_locale")} varchar(20))`,
        `INSERT INTO ${q(codes)} (${q("id")}, ${q("code")}, ${q("_locale")}) VALUES ('c1', '', 'en'), ('c2', '', 'en'), ('c3', 'x', 'en'), ('c4', 'x', 'en')`,
      ]);

      const asIndexed = await readRepeatedValues(
        adapter.getDrizzle(),
        dialect,
        codes,
        "code",
        "_locale",
        true
      );

      expect(asIndexed).toEqual([{ value: "x", entries: 2, language: "en" }]);
    }, 120_000);
  }
);
