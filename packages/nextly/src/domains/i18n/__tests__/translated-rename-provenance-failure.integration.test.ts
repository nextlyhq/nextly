/**
 * A translated Single whose schema dialog renames a translated field runs the save's migration
 * file, then follows it with the translations step (`afterFile`): the field's translation
 * provenance moves to its new name (`renameFieldProvenance`). The file commits first, and with it
 * the registry row it carries, so the change has landed whatever that step does.
 *
 * Where that step fails, the save answers so: the change landed, its translations step failed, and
 * a developer can finish it with the statements the server log gives (the provenance records moved
 * by hand). Saving again would not, as no later save knows of the rename. The row's version moves
 * on, as its fields did, so a client still holding the old one is refused.
 *
 * The failure is the database's own: a trigger refuses the provenance rename. The file itself ran,
 * as the renamed translations column shows, and the provenance kept the old name. Where the row's
 * version cannot be written either, the answer is still the move's, with that failure logged.
 *
 * A translated Collection's save stops before its registry row is written, so it answers that it
 * was saved only in part, followed by the kept file's steps. The statements the log gives move
 * the records as the move does, a path that would no longer fit the column dropped.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { getLoggerFromDI } from "../../../dispatcher/helpers/di";
import {
  renameFieldProvenance,
  renameFieldProvenanceStatements,
} from "../provenance/record-provenance";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

const LOCALES = ["en", "es"];
const SLUG = "trp_hero";
const TABLE = `single_${SLUG}`;
const PROVENANCE = "nextly_translation_provenance";
const TRANSLATED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];
/** `heading` renamed to `title2`, still translated. */
const RENAMED = [
  { name: "title2", type: "text" },
  { name: "views", type: "number" },
];

/**
 * The statements the server log gives for moving an entity's records of `heading` to `title2` by
 * hand: the field's own records; each row's record whose new path would pass the column's 255
 * characters dropped (none can here, as `title2` is the shorter name); then each row's record
 * under `heading#`.
 */
function finishingStatements(
  dialect: TestDialect,
  kind: "single" | "collection" = "single",
  slug = SLUG
): string[] {
  const scope =
    dialect === "mysql"
      ? `\`scope_kind\` = '${kind}' AND \`scope_slug\` = '${slug}'`
      : `"scope_kind" = '${kind}' AND "scope_slug" = '${slug}'`;
  if (dialect === "mysql") {
    return [
      `UPDATE \`nextly_translation_provenance\` SET \`field_path\` = 'title2' WHERE ${scope} AND \`field_path\` = 'heading';`,
      `DELETE FROM \`nextly_translation_provenance\` WHERE ${scope} AND SUBSTRING(\`field_path\`, 1, 8) = 'heading#' AND CHAR_LENGTH(\`field_path\`) > 256;`,
      `UPDATE \`nextly_translation_provenance\` SET \`field_path\` = CONCAT('title2#', SUBSTRING(\`field_path\`, 9)) WHERE ${scope} AND SUBSTRING(\`field_path\`, 1, 8) = 'heading#';`,
    ];
  }
  return [
    `UPDATE "nextly_translation_provenance" SET "field_path" = 'title2' WHERE ${scope} AND "field_path" = 'heading';`,
    `DELETE FROM "nextly_translation_provenance" WHERE ${scope} AND SUBSTR("field_path", 1, 8) = 'heading#' AND LENGTH("field_path") > 256;`,
    `UPDATE "nextly_translation_provenance" SET "field_path" = 'title2#' || SUBSTR("field_path", 9) WHERE ${scope} AND SUBSTR("field_path", 1, 8) = 'heading#';`,
  ];
}

/** A dialect's identifier quoting, for the raw reads below. */
function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "a translated Single's rename whose translations step fails",
  dialect => {
    let t: TestNextly;

    beforeEach(async () => {
      // The schema dialog runs its migration file in development only.
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: LOCALES, defaultLocale: "en" },
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SLUG, label: "Hero", localized: true, fields: TRANSLATED }
      );
      const singles: SingleEntryService = t.getService("singleEntryService");
      for (const [locale, heading] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ]) {
        const written = await singles.update(
          SLUG,
          { heading, views: 7, _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await dropTrigger();
      await t?.destroy();
      vi.unstubAllEnvs();
    });

    /**
     * Every error-level line the server logs from here on: through the app's logger where one is
     * registered, and through the console, which the fallback logger writes to.
     */
    function captureErrorLog(): () => string[] {
      const lines: string[] = [];
      const record = (...args: unknown[]) => {
        lines.push(
          args
            .map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg)))
            .join(" ")
        );
      };
      vi.spyOn(console, "error").mockImplementation(record);
      const logger = getLoggerFromDI();
      if (logger !== undefined) {
        vi.spyOn(logger, "error").mockImplementation(record);
      }
      return () => lines;
    }

    async function query<T>(sql: string): Promise<T[]> {
      return t.adapter.executeQuery<T>(sql);
    }

    /**
     * A registry row's fields, schema version and translation switch, as stored: the Single's by
     * default.
     */
    async function recorded(registry = "dynamic_singles", slug = SLUG) {
      clearRegistryRowCache();
      const [row] = await t.adapter.select<Record<string, unknown>>(registry, {
        columns: ["fields", "schemaVersion", "localized"],
        where: { and: [{ column: "slug", op: "=", value: slug }] },
      });
      const fields =
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
      return {
        fields: (fields as { name: string }[] | undefined)?.map(f => f.name),
        schemaVersion: Number(row?.schemaVersion),
        localized: Boolean(row?.localized),
      };
    }

    /** The Single's provenance records, by id and field path, sorted. */
    async function provenanceRows(): Promise<string[]> {
      const rows = await query<{ id: string; path: string }>(
        `SELECT ${quote(dialect, "id")} AS id, ${quote(dialect, "field_path")} AS path FROM ${quote(dialect, PROVENANCE)} WHERE ${quote(dialect, "scope_slug")} = '${SLUG}'`
      );
      return rows.map(row => `${String(row.id)} ${String(row.path)}`).sort();
    }

    /** The field paths an entity's provenance records (the Single's by default), sorted. */
    async function provenancePaths(slug = SLUG): Promise<string[]> {
      const rows = await query<{ path: string }>(
        `SELECT ${quote(dialect, "field_path")} AS path FROM ${quote(dialect, PROVENANCE)} WHERE ${quote(dialect, "scope_slug")} = '${slug}'`
      );
      return [...new Set(rows.map(row => String(row.path)))].sort();
    }

    async function companionColumns(table = TABLE): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}_locales')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}_locales'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}_locales'`
      );
      return rows.map(row => String(row.name));
    }

    /** A trigger refusing any change of an entity's provenance records of `heading`. */
    async function refuseProvenanceRename(slug = SLUG): Promise<void> {
      const when = `OLD.${quote(dialect, "scope_slug")} = '${slug}' AND OLD.${quote(dialect, "field_path")} = 'heading'`;
      if (dialect === "postgresql") {
        await query(
          `CREATE FUNCTION trp_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure of the provenance rename'; END $$ LANGUAGE plpgsql`
        );
        await query(
          `CREATE TRIGGER trp_refuse BEFORE UPDATE ON ${PROVENANCE} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION trp_refuse()`
        );
      } else if (dialect === "mysql") {
        await query(
          `CREATE TRIGGER trp_refuse BEFORE UPDATE ON ${PROVENANCE} FOR EACH ROW BEGIN IF ${when} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected failure of the provenance rename'; END IF; END`
        );
      } else {
        await query(
          `CREATE TRIGGER trp_refuse BEFORE UPDATE ON ${PROVENANCE} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'injected failure of the provenance rename'); END`
        );
      }
    }

    /**
     * A trigger refusing a move of a Single's registry version. The save's migration file writes
     * the row's fields and leaves its version as it was, so only the write after it is refused.
     */
    async function refuseVersionBump(): Promise<void> {
      const version = quote(dialect, "schema_version");
      if (dialect === "postgresql") {
        await query(
          `CREATE FUNCTION trp_refuse_version() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure of the version write'; END $$ LANGUAGE plpgsql`
        );
        await query(
          `CREATE TRIGGER trp_refuse_version BEFORE UPDATE ON dynamic_singles FOR EACH ROW WHEN (OLD.${version} IS DISTINCT FROM NEW.${version}) EXECUTE FUNCTION trp_refuse_version()`
        );
      } else if (dialect === "mysql") {
        await query(
          `CREATE TRIGGER trp_refuse_version BEFORE UPDATE ON dynamic_singles FOR EACH ROW BEGIN IF NOT (OLD.${version} <=> NEW.${version}) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected failure of the version write'; END IF; END`
        );
      } else {
        await query(
          `CREATE TRIGGER trp_refuse_version BEFORE UPDATE ON dynamic_singles WHEN OLD.${version} IS NOT NEW.${version} BEGIN SELECT RAISE(ABORT, 'injected failure of the version write'); END`
        );
      }
    }

    async function dropTrigger(): Promise<void> {
      if (t === undefined) return;
      for (const [name, table] of [
        ["trp_refuse", PROVENANCE],
        ["trp_refuse_version", "dynamic_singles"],
      ]) {
        await query(
          dialect === "postgresql"
            ? `DROP TRIGGER IF EXISTS ${name} ON ${table}`
            : `DROP TRIGGER IF EXISTS ${name}`
        );
        if (dialect === "postgresql") {
          await query(`DROP FUNCTION IF EXISTS ${name}()`);
        }
      }
    }

    /** The schema dialog applying `fields` (the rename by default) at `version` (the row's). */
    async function applyRename(
      version?: number,
      fields: unknown[] = RENAMED
    ): Promise<{ failed: boolean; said: string; message?: string }> {
      const at = version ?? (await recorded()).schemaVersion;
      try {
        const answer = await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: SLUG },
          {
            fields,
            confirmed: true,
            localized: true,
            renameResolutions: [
              {
                tableName: `${TABLE}_locales`,
                fromColumn: "heading",
                toColumn: "title2",
                choice: "rename" as const,
              },
            ],
            schemaVersion: at,
          }
        );
        if (answer instanceof Response) {
          return {
            failed: answer.status >= 400,
            said: JSON.stringify(await answer.json()),
          };
        }
        return { failed: false, said: JSON.stringify(answer) };
      } catch (error) {
        // What a refusal names goes with it, so a failing case says why.
        const data = (error as { publicData?: unknown }).publicData;
        return {
          failed: true,
          said: `${String(error)} ${JSON.stringify(data ?? null)}`,
          message: error instanceof Error ? error.message : undefined,
        };
      }
    }

    it("moves the field's provenance to its new name when nothing fails", async () => {
      // Control: the save's translations step is what writes the records the trigger below guards.
      expect(await provenancePaths(), "the seeded provenance").toContain(
        "heading"
      );

      const { failed, said } = await applyRename();

      expect(failed, `the rename failed: ${said}`).toBe(false);
      expect(await provenancePaths()).toContain("title2");
      expect(await provenancePaths()).not.toContain("heading");
      expect((await recorded()).fields).toEqual(["title2", "views"]);

      // The move moves only what is still under the old name, so a second one changes nothing.
      const moved = await provenanceRows();
      await renameFieldProvenance(t.adapter, {
        scopeKind: "single",
        scopeSlug: SLUG,
        from: "heading",
        to: "title2",
      });
      expect(await provenanceRows(), "the records after a second move").toEqual(
        moved
      );
    });

    it("answers that the change landed and its translations step failed, moving the row's version on", async () => {
      const before = await recorded();
      expect(before.fields, "the Single as seeded").toEqual([
        "heading",
        "views",
      ]);
      expect(await provenancePaths(), "the seeded provenance").toContain(
        "heading"
      );
      await refuseProvenanceRename();
      const logged = captureErrorLog();

      const { failed, said, message } = await applyRename();

      expect(failed, `the rename answered: ${said}`).toBe(true);
      expect(message).toBe(
        `Single "${SLUG}" was saved: its change landed, but its translations step failed, so the translation records of "heading" were not moved to "title2". Until they are, no language of title2 can be found out of date. A developer can finish it with the statements in the server log.`
      );
      // The file ran: the translations column carries the new name.
      expect(await companionColumns(), "the translations columns").toContain(
        "title2"
      );
      // The translations step was refused: the provenance kept the old name.
      expect(await provenancePaths(), "the provenance").toContain("heading");
      expect(await provenancePaths(), "the provenance").not.toContain("title2");
      // The row is as the file left it, its version moved on.
      expect(await recorded(), "the registry row").toEqual({
        fields: ["title2", "views"],
        schemaVersion: before.schemaVersion + 1,
        localized: true,
      });
      // The statements that finish it, for a developer.
      const log = logged().join("\n");
      for (const statement of finishingStatements(dialect)) {
        expect(log, "the server log").toContain(statement);
      }

      // A client still holding the old version is refused, and the row stays.
      const afterFailure = await recorded();
      const stale = await applyRename(before.schemaVersion, [
        ...RENAMED,
        { name: "note", type: "text" },
      ]);
      expect(stale.failed, `the stale save answered: ${stale.said}`).toBe(true);
      expect(await recorded(), "the registry row").toEqual(afterFailure);
    });

    it("keeps the move's answer when the row's version cannot be written either", async () => {
      const before = await recorded();
      await refuseProvenanceRename();
      await refuseVersionBump();
      const logged = captureErrorLog();

      const { failed, said, message } = await applyRename();

      expect(failed, `the rename answered: ${said}`).toBe(true);
      expect(message).toBe(
        `Single "${SLUG}" was saved: its change landed, but its translations step failed, so the translation records of "heading" were not moved to "title2". Until they are, no language of title2 can be found out of date. A developer can finish it with the statements in the server log.`
      );
      // Control: the version write was refused, so the row keeps its version.
      expect(await recorded(), "the registry row").toEqual({
        fields: ["title2", "views"],
        schemaVersion: before.schemaVersion,
        localized: true,
      });
      const log = logged().join("\n");
      for (const statement of finishingStatements(dialect)) {
        expect(log, "the server log").toContain(statement);
      }
      expect(log, "the server log").toContain(
        `The registry row of '${SLUG}' was not written after its rename, so its version did not move on`
      );
      // A read in this process finds the renamed field. Translated values are read through a
      // shape built from the registry row, which the file already wrote, so this holds whether or
      // not the running shape was refreshed; a translated rename is saved alone, so the main
      // table's shape is unchanged.
      const singles: SingleEntryService = t.getService("singleEntryService");
      const read = await singles.get(SLUG, {
        locale: "es",
        overrideAccess: true,
      });
      expect(
        (read.data as Record<string, unknown> | undefined)?.title2,
        `the read after the failure: ${JSON.stringify(read)}`
      ).toBe("Hola");
    });

    /**
     * A translated Collection `name` holding one entry with an English and a Spanish heading, its
     * registry row as seeded.
     */
    async function seedTranslatedCollection(name: string) {
      const collections = t.getService("collectionsHandler") as unknown as {
        createCollection(data: Record<string, unknown>): Promise<{
          success: boolean;
        }>;
        getEntryService(): {
          createEntry(
            params: Record<string, unknown>,
            data: Record<string, unknown>
          ): Promise<{ success: boolean; data: unknown }>;
          updateEntry(
            params: Record<string, unknown>,
            data: Record<string, unknown>
          ): Promise<{ success: boolean }>;
        };
      };
      const created = await collections.createCollection({
        name,
        label: "Post",
        localized: true,
        fields: TRANSLATED,
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      const entries = collections.getEntryService();
      const entry = await entries.createEntry(
        { collectionName: name, overrideAccess: true, locale: "en" },
        { heading: "Hello", views: 7 }
      );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
      const spanish = await entries.updateEntry(
        {
          collectionName: name,
          entryId: String((entry.data as { id: unknown }).id),
          overrideAccess: true,
          locale: "es",
        },
        { heading: "Hola", _overwrite: true }
      );
      expect(spanish.success, JSON.stringify(spanish)).toBe(true);
      return recorded("dynamic_collections", name);
    }

    it("answers that a translated Collection was saved only in part when its translations step fails", async () => {
      const name = "trp_posts";
      const before = await seedTranslatedCollection(name);
      expect(before.fields, "the Collection as seeded").toEqual([
        "heading",
        "views",
      ]);
      expect(await provenancePaths(name), "the seeded provenance").toContain(
        "heading"
      );
      await refuseProvenanceRename(name);
      const logged = captureErrorLog();

      let message: string | undefined;
      try {
        const answer = await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: name },
          {
            fields: RENAMED,
            confirmed: true,
            localized: true,
            renameResolutions: [
              {
                tableName: `dc_${name}_locales`,
                fromColumn: "heading",
                toColumn: "title2",
                choice: "rename" as const,
              },
            ],
            schemaVersion: before.schemaVersion,
          }
        );
        message = `answered: ${JSON.stringify(answer)}`;
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      // The save runs its own migration file, which is recorded as it ran, so no step is left for
      // `nextly migrate` and the answer names only the records that stayed.
      expect(message).toBe(
        `Collection "${name}" was saved only in part: its change landed in the database, but its translations step failed, so the translation records of "heading" were not moved to "title2". Until they are, no language of title2 can be found out of date. A developer can move them with the statements in the server log.`
      );
      // The change landed in the database, and the registry row carries it.
      expect(
        await companionColumns(`dc_${name}`),
        "the translations columns"
      ).toContain("title2");
      expect(await provenancePaths(name), "the provenance").toContain(
        "heading"
      );
      // Its version moves on with its fields, as a Single's does.
      const after = await recorded("dynamic_collections", name);
      expect(after).toEqual({
        fields: ["title2", "views"],
        schemaVersion: before.schemaVersion + 1,
        localized: true,
      });
      const log = logged().join("\n");
      for (const statement of finishingStatements(
        dialect,
        "collection",
        name
      )) {
        expect(log, "the server log").toContain(statement);
      }

      // A client still holding the version from before the rename is refused, and the row
      // stays; one holding the version the rename moved it to saves.
      const saveAt = (schemaVersion: number) =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: name },
          {
            fields: [...RENAMED, { name: "note", type: "text" }],
            confirmed: true,
            localized: true,
            schemaVersion,
          }
        );
      await expect(saveAt(before.schemaVersion)).rejects.toThrow(
        expect.objectContaining({
          logContext: expect.objectContaining({
            expected: before.schemaVersion,
            actual: after.schemaVersion,
          }),
        })
      );
      expect(await recorded("dynamic_collections", name)).toEqual(after);
      await saveAt(after.schemaVersion);
      expect(await recorded("dynamic_collections", name)).toEqual({
        fields: ["title2", "views", "note"],
        schemaVersion: after.schemaVersion + 1,
        localized: true,
      });
    });

    it("records the fields as the save wrote them when a translated Collection's rename stops part way, an answer making a field optional included", async () => {
      const name = "trp_optional";
      const before = await seedTranslatedCollection(name);
      await refuseProvenanceRename(name);
      captureErrorLog();

      // `views` sent required, with the answer that keeps it optional: the save's file and its
      // definition hold it optional, and so does the registry row once the rename stops part way.
      await expect(
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: name },
          {
            fields: [
              { name: "title2", type: "text" },
              { name: "views", type: "number", required: true },
            ],
            confirmed: true,
            localized: true,
            renameResolutions: [
              {
                tableName: `dc_${name}_locales`,
                fromColumn: "heading",
                toColumn: "title2",
                choice: "rename" as const,
              },
            ],
            eventResolutions: [
              {
                kind: "make_optional",
                eventId: `add_not_null_with_nulls:dc_${name}.views`,
              },
            ],
            schemaVersion: before.schemaVersion,
          }
        )
      ).rejects.toThrow(
        expect.objectContaining({
          logContext: expect.objectContaining({
            reason: "translation-records-not-moved",
          }),
        })
      );

      clearRegistryRowCache();
      const [row] = await t.adapter.select<Record<string, unknown>>(
        "dynamic_collections",
        {
          columns: ["fields", "schemaVersion"],
          where: { and: [{ column: "slug", op: "=", value: name }] },
        }
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string; required?: boolean }[];
      expect(fields.map(f => f.name)).toEqual(["title2", "views"]);
      expect(
        fields.find(f => f.name === "views")?.required ?? false,
        "views, as the save's answer left it"
      ).toBe(false);
      expect(Number(row?.schemaVersion)).toBe(before.schemaVersion + 1);
    });

    it("gives statements that move the records as the move itself does, dropping a path that no longer fits", async () => {
      // One set of records under two Singles: one moved by the move, one by the statements.
      // From `hd` to `hd_renamed`, a row's path grows by 8 characters, so one of 247 still fits
      // the column's 255 and one of 248 does not. `hdx#…` is another field's.
      const paths = [
        "hd",
        "hd#r1",
        `hd#${"r".repeat(244)}`,
        `hd#${"s".repeat(245)}`,
        "hdx#r2",
      ];
      for (const slug of ["trp_by_move", "trp_by_statements"]) {
        for (const [index, fieldPath] of paths.entries()) {
          await t.adapter.insert(PROVENANCE, {
            id: `${slug}-${String(index)}`,
            scopeKind: "single",
            scopeSlug: slug,
            entryId: "e1",
            locale: "en",
            partState: "live",
            fieldPath,
            valueFingerprint: "f",
            origin: "person",
            writtenAt: new Date(),
          });
        }
      }
      const rename = {
        scopeKind: "single" as const,
        from: "hd",
        to: "hd_renamed",
      };

      await renameFieldProvenance(t.adapter, {
        ...rename,
        scopeSlug: "trp_by_move",
      });
      for (const statement of renameFieldProvenanceStatements(dialect, {
        ...rename,
        scopeSlug: "trp_by_statements",
      })) {
        await query(statement);
      }

      const byMove = await provenancePaths("trp_by_move");
      // Control: the move dropped the path that no longer fits and kept the one that does.
      expect(byMove, "the moved records").toEqual(
        [
          "hd_renamed",
          "hd_renamed#r1",
          `hd_renamed#${"r".repeat(244)}`,
          "hdx#r2",
        ].sort()
      );
      expect(await provenancePaths("trp_by_statements")).toEqual(byMove);
    });
  }
);
