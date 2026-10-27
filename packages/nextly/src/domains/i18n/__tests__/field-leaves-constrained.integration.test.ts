/**
 * A translated field marked Required or Unique becomes shared in one change, keeping its default
 * language's value as the shared one, when the values in place satisfy the setting.
 *
 * The shared column has to be created without its constraint, filled from the default language,
 * and only then constrained: created constrained, every existing row briefly holds the same
 * placeholder or none, which neither setting accepts. When the default language's values do not
 * satisfy the setting (an entry without one, for Required; a value two entries share, for Unique)
 * the change is refused before anything runs, saying how many entries are in the way.
 *
 * Every Builder path that can make the change: a collection's save and schema dialog, a Single's
 * save and schema dialog, and a field group's schema dialog.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// What runs before each statement of a schema change applied after its first push (a leaving
// field's settings): nothing unless a test arms it, to model a write landing at that moment.
const { beforeStatement } = vi.hoisted(() => ({
  beforeStatement: {
    run: undefined as ((sql: string) => Promise<void>) | undefined,
  },
}));

vi.mock(
  "../../schema/services/apply-migration-statements",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../schema/services/apply-migration-statements")
      >();
    return {
      ...actual,
      applyMigrationStatements: async (
        ...args: Parameters<typeof actual.applyMigrationStatements>
      ) => {
        await beforeStatement.run?.(args[1]);
        return actual.applyMigrationStatements(...args);
      },
    };
  }
);

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { PushSchemaPipeline } from "../../schema/pipeline/pushschema-pipeline";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  listEntries(params: {
    collectionName: string;
    overrideAccess?: boolean;
    status?: "published" | "draft" | "all";
  }): Promise<unknown>;
}

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): Entries;
}

/**
 * The field under test. An email field is stored in a bounded text column on every dialect, so
 * MySQL can make it unique (an unbounded text column it cannot key), and the schema dialogs'
 * fields payload takes it as it is.
 */
const CODE = { name: "code", type: "email" };
const VIEWS = { name: "views", type: "number" };

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a Required or Unique field that becomes shared",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const q = (name: string) => quote(dialect, name);

    function handler(): CollectionsHandler {
      return current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
    }

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function schemaVersionOf(
      registry: string,
      slug: string
    ): Promise<number> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT ${q("schema_version")} AS version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      return Number(row?.version ?? 1);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    /**
     * A translated collection `posts` whose `code` holds, in English, each of `english` (one entry
     * per value; `undefined` writes an entry with no English `code`).
     */
    async function seedCollection(english: (string | undefined)[]) {
      const created = await handler().createCollection({
        name: "posts",
        label: "Post",
        localized: true,
        fields: [CODE, VIEWS],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      const entries = handler().getEntryService();
      for (const value of english) {
        const entry = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true, locale: "en" },
          value === undefined ? { views: 1 } : { code: value, views: 1 }
        );
        expect(entry.success, JSON.stringify(entry)).toBe(true);
      }
    }

    /** A translated Single `hero` whose `code` holds `english[0]` in English, or none. */
    async function seedSingle(english: (string | undefined)[]) {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", localized: true, fields: [CODE, VIEWS] }
      );
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      const [value] = english;
      const written = await singles.update(
        "hero",
        value === undefined ? { views: 1 } : { code: value, views: 1 },
        { locale: "en", overrideAccess: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
    }

    /**
     * A translated field group `promo` with one row per value of `english`. Its rows belong to the
     * entries that embed it, so each is written as an embedding entry would write it.
     */
    async function seedFieldGroup(english: (string | undefined)[]) {
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "promo",
          label: "Promo",
          localized: true,
          fields: [CODE, VIEWS],
        }
      );
      for (const [i, value] of english.entries()) {
        const id = `promo-${i + 1}`;
        await query(
          `INSERT INTO ${q("comp_promo")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(q).join(", ")}) ` +
            `VALUES ('${id}', 'entry-${i + 1}', 'dc_pages', 'promo', 1)`
        );
        await query(
          `INSERT INTO ${q("comp_promo_locales")} (${["_parent", "_locale", "code"].map(q).join(", ")}) ` +
            `VALUES ('${id}', 'en', ${value === undefined ? "NULL" : `'${value}'`})`
        );
      }
    }

    /** The system columns each table needs a value in, beside `id`, and a value for each. */
    const SYSTEM_COLUMNS: Record<string, Record<string, string>> = {
      dc_posts: { title: "'Extra'", slug: "'extra'" },
      single_hero: { title: "'Extra'", slug: "'extra'" },
      comp_promo: {
        _parent_id: "'entry-extra'",
        _parent_table: "'dc_pages'",
        _parent_field: "'promo'",
        created_at: "'2026-01-01 00:00:00'",
        updated_at: "'2026-01-01 00:00:00'",
      },
    };

    /**
     * A row for `table` beside the entity's own, holding `code` (a SQL literal). A table with a
     * `slug` takes the row's id there: its slug is unique, so two rows sharing one would be
     * refused for the slug whatever `code` holds.
     */
    function rowFor(table: string, id: string, code: string): string {
      const system = SYSTEM_COLUMNS[table];
      const values = {
        ...system,
        ...("slug" in system ? { slug: `'${id}'` } : {}),
        id: `'${id}'`,
        code,
      };
      return (
        `INSERT INTO ${q(table)} (${Object.keys(values).map(q).join(", ")}) ` +
        `VALUES (${Object.values(values).join(", ")})`
      );
    }

    /** Every Builder path a translated field can become shared by, with its entity. */
    const PATHS = [
      {
        path: "a collection's builder saves the field alone",
        // Saved through the schema service's own ALTER, which on SQLite renders no column
        // modification (`generateAlterTableMigration`), so the NOT NULL of a Required setting on an
        // existing column is not applied there.
        sqliteSkipsColumnModification: true,
        entity: "collection",
        table: "dc_posts",
        seed: seedCollection,
        save: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
        change: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
      },
      {
        path: "a collection's change is applied with the schema dialog",
        sqliteSkipsColumnModification: false,
        entity: "collection",
        table: "dc_posts",
        seed: seedCollection,
        save: async (fields: unknown[]) => {
          const saved = await handler().updateCollection(
            { collectionName: "posts" },
            { fields }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
        },
        change: async (fields: unknown[]) => {
          await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_collections",
                "posts"
              ),
            }
          );
        },
      },
      {
        path: "a Single's schema is saved",
        // Saved through the schema service's own ALTER, which on SQLite renders no column
        // modification (`generateAlterTableMigration`), so the NOT NULL of a Required setting on an
        // existing column is not applied there.
        sqliteSkipsColumnModification: true,
        entity: "single",
        table: "single_hero",
        seed: seedSingle,
        save: async (fields: unknown[]) => {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { fields }
          );
        },
        change: async (fields: unknown[]) => {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { fields }
          );
        },
      },
      {
        path: "a Single's change is applied with the schema dialog",
        sqliteSkipsColumnModification: false,
        entity: "single",
        table: "single_hero",
        seed: seedSingle,
        save: async (fields: unknown[]) => {
          await dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { fields }
          );
        },
        change: async (fields: unknown[]) => {
          await dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "hero" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
            }
          );
        },
      },
      {
        path: "a field group's change is applied with the schema dialog",
        sqliteSkipsColumnModification: false,
        entity: "fieldGroup",
        table: "comp_promo",
        seed: seedFieldGroup,
        save: async (fields: unknown[]) => {
          await dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "promo" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_components",
                "promo"
              ),
            }
          );
        },
        change: async (fields: unknown[]) => {
          await dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "promo" },
            {
              fields,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_components",
                "promo"
              ),
            }
          );
        },
      },
    ];
    type Path = (typeof PATHS)[number];

    const SETTINGS = [
      { setting: "required", flags: { required: true } },
      { setting: "unique", flags: { unique: true } },
    ];

    /**
     * The entity seeded with `english`, then given `flags` while `code` is still translated, as an
     * author would have it.
     */
    async function seedConstrained(
      path: Path,
      flags: Record<string, unknown>,
      english: (string | undefined)[]
    ): Promise<void> {
      await path.seed(english);
      await path.save([{ ...CODE, ...flags }, VIEWS]);
    }

    async function sharedCodes(table: string): Promise<unknown[]> {
      const rows = await query<{ code: unknown }>(
        `SELECT ${q("code")} AS code FROM ${q(table)} ORDER BY ${q("code")}`
      );
      return rows.map(row => row.code);
    }

    /** The English values on the companion, without the entries that have none. */
    async function englishCodes(table: string): Promise<unknown[]> {
      const rows = await query<{ code: unknown }>(
        `SELECT ${q("code")} AS code FROM ${q(`${table}_locales`)} ` +
          `WHERE ${q("_locale")} = 'en' AND ${q("code")} IS NOT NULL ORDER BY ${q("code")}`
      );
      return rows.map(row => row.code);
    }

    /** The error a refused change raised or reported, as text. */
    function reported(refusal: unknown): string {
      return refusal instanceof Error
        ? `${refusal.message} ${JSON.stringify((refusal as { publicData?: unknown }).publicData ?? null)}`
        : String(refusal);
    }

    function attempt(promise: Promise<void>): Promise<unknown> {
      return promise.then(
        () => undefined,
        (error: unknown) => error
      );
    }

    /** True when the row is taken, else the database's reason. */
    async function inserts(sql: string): Promise<true | string> {
      return query(sql).then(
        () => true as const,
        (error: unknown) =>
          error instanceof Error ? error.message.slice(0, 300) : String(error)
      );
    }

    /**
     * Whether the database takes a row that keeps the setting and one that breaks it. The first
     * has to be taken: a row refused for another reason (another column it lacks) is no evidence.
     */
    async function databaseEnforces(
      table: string,
      setting: string
    ): Promise<{ keeps: true | string; breaks: boolean }> {
      const keeps = await inserts(
        rowFor(table, "kept-1", "'kept@example.com'")
      );
      const breaks =
        (await inserts(
          rowFor(
            table,
            "broken-1",
            setting === "unique" ? "'kept@example.com'" : "NULL"
          )
        )) === true;
      return { keeps, breaks };
    }

    // SQLite skips column modification on a save that goes through the schema service's ALTER, so
    // there a Required setting reaching the shared column leaves it nullable and a row without a
    // value is taken. Stated as what happens rather than skipped, so the assertion fails, and is
    // to be turned around, once that save can modify a column on SQLite. Unique is an index, which
    // every dialect creates on an existing column, and the schema dialogs' push rebuilds a SQLite
    // table to apply NOT NULL.
    const notNullSkipped = (p: Path, setting: string) =>
      dialect === "sqlite" &&
      setting === "required" &&
      p.sqliteSkipsColumnModification;

    it.each(
      PATHS.flatMap(p =>
        SETTINGS.map(s => ({
          ...p,
          ...s,
          outcome: notNullSkipped(p, s.setting)
            ? "takes a row without one, as SQLite skips column modification on a save,"
            : `enforces ${s.setting}`,
        }))
      )
    )(
      "keeps English's values as the shared ones and $outcome when $path",
      async path => {
        // A Single holds one entry; the others hold two with distinct values.
        const english =
          path.entity === "single"
            ? ["a1@example.com"]
            : ["a1@example.com", "b2@example.com"];
        await seedConstrained(path, path.flags, english);

        await path.change([
          { ...CODE, localized: false, ...path.flags },
          VIEWS,
        ]);

        expect(await sharedCodes(path.table)).toEqual(english);
        expect(await databaseEnforces(path.table, path.setting)).toEqual({
          keeps: true,
          breaks: notNullSkipped(path, path.setting),
        });
      }
    );

    it.each(PATHS)(
      "refuses a Required field while an entry has no English value, saying how many, when $path",
      async path => {
        const english =
          path.entity === "single"
            ? [undefined]
            : ["a1@example.com", undefined];
        await seedConstrained(path, { required: true }, english);

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, required: true }, VIEWS])
        );

        expect(reported(refusal)).toMatch(/1 entry has no English code/);
        // Nothing changed: still translated, its English values in place.
        expect(await englishCodes(path.table)).toEqual(
          english.filter(v => v !== undefined)
        );
        expect(await columnsOf(path.table)).not.toContain("code");
      }
    );

    // A Single holds one entry, so no two of its entries can share a value.
    it.each(PATHS.filter(p => p.entity !== "single"))(
      "refuses a Unique field while two entries share an English value, without naming it, when $path",
      async path => {
        await seedConstrained(path, {}, [
          "same@example.com",
          "same@example.com",
        ]);

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, unique: true }, VIEWS])
        );

        expect(reported(refusal)).toMatch(
          /2 entries would share a value for code, which must be unique/
        );
        expect(reported(refusal)).not.toContain("same@example.com");
        expect(await englishCodes(path.table)).toEqual([
          "same@example.com",
          "same@example.com",
        ]);
        expect(await columnsOf(path.table)).not.toContain("code");
      }
    );

    // The move gives an entry with no row in English another language's value, so the check is
    // made on the values the move writes, not on the English rows alone.
    it.each(PATHS.filter(p => p.entity !== "single"))(
      "refuses a Unique field when an entry without English would take another entry's value from its other language, when $path",
      async path => {
        await seedConstrained(path, {}, ["a1@example.com", undefined]);
        // The second entry's only row is in Spanish, holding the first entry's English value.
        await query(
          `UPDATE ${q(`${path.table}_locales`)} SET ${q("_locale")} = 'es', ${q("code")} = 'a1@example.com' ` +
            `WHERE ${q("_locale")} = 'en' AND ${q("code")} IS NULL`
        );

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, unique: true }, VIEWS])
        );

        expect(reported(refusal)).toMatch(
          /2 entries would share a value for code, which must be unique/
        );
        expect(await columnsOf(path.table)).not.toContain("code");
      }
    );

    /** The registry table of each entity a schema dialog changes, and its slug there. */
    const REGISTRY: Record<string, { table: string; slug: string }> = {
      collection: { table: "dynamic_collections", slug: "posts" },
      single: { table: "dynamic_singles", slug: "hero" },
      fieldGroup: { table: "dynamic_components", slug: "promo" },
    };

    /** Whether the registry still describes `code` as translated. */
    async function registryTranslatesCode(entity: string): Promise<unknown> {
      return (await registryCode(entity))?.localized;
    }

    /** The registry's record of `code` for `entity`. */
    async function registryCode(
      entity: string
    ): Promise<{ localized?: boolean; unique?: boolean } | undefined> {
      const { table, slug } = REGISTRY[entity];
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q(table)} WHERE ${q("slug")} = '${slug}'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string; localized?: boolean; unique?: boolean }[];
      return fields.find(f => f.name === "code");
    }

    /** What a read of the entity's content returns, through the product's own read path. */
    async function readContent(entity: string): Promise<string> {
      if (entity === "collection") {
        return JSON.stringify(
          await handler().getEntryService().listEntries({
            collectionName: "posts",
            overrideAccess: true,
            status: "all",
          })
        );
      }
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      return JSON.stringify(
        await singles.get("hero", { overrideAccess: true })
      );
    }

    // A leaving field's setting is applied after its values are shared and its companion column is
    // gone. When that step is refused (here a write landing in between gives a second entry an
    // existing value), the move has committed, so the field is recorded as the table holds it:
    // shared, without the setting. The record, its version and the runtime shape all say so, the
    // admin is told which setting was not applied, and saving again applies it.
    it.each(
      PATHS.filter(
        p =>
          p.path.includes("schema dialog") ||
          p.path === "a Single's schema is saved"
      )
    )(
      "records a field without the Unique it did not get, reads it at once, and applies Unique on the next save, when $path",
      async path => {
        const english =
          path.entity === "single"
            ? ["a1@example.com"]
            : ["a1@example.com", "b2@example.com"];
        await seedConstrained(path, { unique: true }, english);
        const change = [{ ...CODE, localized: false, unique: true }, VIEWS];
        const { table: registry, slug } = REGISTRY[path.entity];
        const versionBefore = await schemaVersionOf(registry, slug);

        // The real statements, run as they are; just before the one applying Unique, a row sharing
        // an entry's value is written to the main table. A dialog applies the setting in a second
        // push; a Single's save, in a statement of its own after the companion reconcile.
        const concurrent = () =>
          query(rowFor(path.table, "concurrent-1", "'a1@example.com'"));
        let injected = false;
        const realApply = PushSchemaPipeline.prototype.apply;
        let pushes = 0;
        const spy = vi
          .spyOn(PushSchemaPipeline.prototype, "apply")
          .mockImplementation(async function (
            this: PushSchemaPipeline,
            ...args: Parameters<PushSchemaPipeline["apply"]>
          ) {
            pushes += 1;
            if (pushes === 2 && path.path.includes("schema dialog")) {
              injected = true;
              await concurrent();
            }
            return realApply.apply(this, args);
          });
        beforeStatement.run = async (sql: string) => {
          if (injected || !/unique/i.test(sql) || !/code/.test(sql)) return;
          injected = true;
          await concurrent();
        };
        const failure = await attempt(path.change(change));
        spy.mockRestore();
        beforeStatement.run = undefined;

        expect(injected).toBe(true);
        // Told which setting, on which field, and what to do.
        expect(failure).toBeInstanceOf(NextlyError);
        expect((failure as NextlyError).message).toMatch(
          /Unique on code was not applied.*Save again to apply it/
        );
        // Recorded as the table holds it, under a new version.
        expect(await columnsOf(`${path.table}_locales`)).not.toContain("code");
        expect(await registryCode(path.entity)).toMatchObject({
          localized: false,
        });
        expect((await registryCode(path.entity))?.unique).not.toBe(true);
        const versionAfterFailure = await schemaVersionOf(registry, slug);
        expect(versionAfterFailure).toBeGreaterThan(versionBefore);
        // Read at once through the runtime shape registered for the table as it is. A field
        // group's rows are read only through the entries that embed them.
        if (path.entity !== "fieldGroup") {
          expect(await readContent(path.entity)).toContain("a1@example.com");
        }
        if (path.entity === "single") {
          const singles: SingleEntryService =
            current.getService("singleEntryService");
          const rewritten = await singles.update(
            "hero",
            { code: "a1@example.com", views: 2 },
            { overrideAccess: true }
          );
          expect(rewritten.success, JSON.stringify(rewritten)).toBe(true);
        }

        await query(
          `DELETE FROM ${q(path.table)} WHERE ${q("id")} = 'concurrent-1'`
        );
        await path.change(change);

        expect(await registryCode(path.entity)).toMatchObject({
          localized: false,
          unique: true,
        });
        // The save that applies the setting changes what is recorded, so it moves the version on:
        // a save planned before it is refused.
        expect(await schemaVersionOf(registry, slug)).toBeGreaterThan(
          versionAfterFailure
        );
        expect(await sharedCodes(path.table)).toEqual(english);
        // The row sharing an entry's value first, then one of the same shape that does not: the
        // second is taken, so the first was refused for its value, not for its shape.
        expect(
          await inserts(rowFor(path.table, "broken-1", "'a1@example.com'"))
        ).not.toBe(true);
        expect(
          await inserts(rowFor(path.table, "kept-1", "'kept@example.com'"))
        ).toBe(true);
      }
    );

    // Both settings at once: the shared column is added holding neither and takes both after the
    // copy, so what the entries must satisfy is asked of the values that copy writes, not of the
    // one placeholder an added Required column would otherwise start with in every entry.
    it.each(
      PATHS.filter(p => p.entity === "collection").map(p => ({
        ...p,
        required: notNullSkipped(p, "required")
          ? "takes a row without one, as SQLite skips column modification on a save"
          : "enforces Required",
      }))
    )(
      "keeps English's values as the shared ones for a field both Required and Unique, enforcing Unique, and $required, when $path",
      async path => {
        const english = ["a1@example.com", "b2@example.com"];
        const flags = { required: true, unique: true };
        await seedConstrained(path, flags, english);

        await path.change([{ ...CODE, localized: false, ...flags }, VIEWS]);

        expect(await sharedCodes(path.table)).toEqual(english);
        // A row keeping both first, so a refusal of the two that follow is their value's.
        expect(
          await inserts(rowFor(path.table, "kept-1", "'kept@example.com'"))
        ).toBe(true);
        expect(
          await inserts(rowFor(path.table, "duplicate-1", "'a1@example.com'"))
        ).not.toBe(true);
        expect(
          (await inserts(rowFor(path.table, "missing-1", "NULL"))) === true
        ).toBe(notNullSkipped(path, "required"));
      }
    );

    // Two groups of entries sharing a value, of two and of three: every entry in either is in the
    // way, so the refusal counts five.
    it.each(PATHS.filter(p => p.entity !== "single"))(
      "counts the entries of every group that would share a value, when $path",
      async path => {
        await seedConstrained(path, {}, [
          "two@example.com",
          "two@example.com",
          "three@example.com",
          "three@example.com",
          "three@example.com",
        ]);

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, unique: true }, VIEWS])
        );

        expect(reported(refusal)).toMatch(
          /5 entries would share a value for code, which must be unique/
        );
      }
    );

    // A companion missing the field's column while the main table has none either is not a change
    // an earlier apply left part-way: its values are nowhere this change can read. The save is
    // refused before any schema work, as one whose values cannot be read.
    it.each(PATHS)(
      "refuses before any schema change when the companion lacks the field's column and the main table has none, when $path",
      async path => {
        const english =
          path.entity === "single"
            ? ["a1@example.com"]
            : ["a1@example.com", "b2@example.com"];
        await seedConstrained(path, {}, english);
        await query(
          `ALTER TABLE ${q(`${path.table}_locales`)} DROP COLUMN ${q("code")}`
        );

        const refusal = await attempt(
          path.change([{ ...CODE, localized: false, unique: true }, VIEWS])
        );

        expect(refusal).toBeInstanceOf(Error);
        expect(await columnsOf(path.table)).not.toContain("code");
        expect(await registryTranslatesCode(path.entity)).not.toBe(false);
      }
    );
  }
);
