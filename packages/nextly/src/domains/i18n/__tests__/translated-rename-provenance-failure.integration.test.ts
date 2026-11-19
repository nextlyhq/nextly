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
 * as the renamed translations column shows, and the provenance kept the old name.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { getLoggerFromDI } from "../../../dispatcher/helpers/di";
import { renameFieldProvenance } from "../provenance/record-provenance";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
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
 * The statements the server log gives for moving the Single's records of `heading` to `title2` by
 * hand: the field's own records, then each row's record under `heading#`.
 */
function finishingStatements(dialect: TestDialect): string[] {
  if (dialect === "mysql") {
    return [
      "UPDATE `nextly_translation_provenance` SET `field_path` = 'title2' WHERE `scope_kind` = 'single' AND `scope_slug` = 'trp_hero' AND `field_path` = 'heading';",
      "UPDATE `nextly_translation_provenance` SET `field_path` = CONCAT('title2#', SUBSTRING(`field_path`, 9)) WHERE `scope_kind` = 'single' AND `scope_slug` = 'trp_hero' AND SUBSTRING(`field_path`, 1, 8) = 'heading#';",
    ];
  }
  return [
    `UPDATE "nextly_translation_provenance" SET "field_path" = 'title2' WHERE "scope_kind" = 'single' AND "scope_slug" = 'trp_hero' AND "field_path" = 'heading';`,
    `UPDATE "nextly_translation_provenance" SET "field_path" = 'title2#' || SUBSTR("field_path", 9) WHERE "scope_kind" = 'single' AND "scope_slug" = 'trp_hero' AND SUBSTR("field_path", 1, 8) = 'heading#';`,
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

    /** The registry row's fields, schema version and translation switch, as stored. */
    async function recorded() {
      clearRegistryRowCache();
      const [row] = await t.adapter.select<Record<string, unknown>>(
        "dynamic_singles",
        {
          columns: ["fields", "schemaVersion", "localized"],
          where: { and: [{ column: "slug", op: "=", value: SLUG }] },
        }
      );
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

    /** The field paths the Single's provenance records, sorted. */
    async function provenancePaths(): Promise<string[]> {
      const rows = await query<{ path: string }>(
        `SELECT ${quote(dialect, "field_path")} AS path FROM ${quote(dialect, PROVENANCE)} WHERE ${quote(dialect, "scope_slug")} = '${SLUG}'`
      );
      return [...new Set(rows.map(row => String(row.path)))].sort();
    }

    async function companionColumns(): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${TABLE}_locales')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}_locales'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${TABLE}_locales'`
      );
      return rows.map(row => String(row.name));
    }

    /** A trigger refusing any change of the Single's provenance records of `heading`. */
    async function refuseProvenanceRename(): Promise<void> {
      const when = `OLD.${quote(dialect, "scope_slug")} = '${SLUG}' AND OLD.${quote(dialect, "field_path")} = 'heading'`;
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

    async function dropTrigger(): Promise<void> {
      if (t === undefined) return;
      await query(
        dialect === "postgresql"
          ? `DROP TRIGGER IF EXISTS trp_refuse ON ${PROVENANCE}`
          : "DROP TRIGGER IF EXISTS trp_refuse"
      );
      if (dialect === "postgresql") {
        await query("DROP FUNCTION IF EXISTS trp_refuse()");
      }
    }

    /** The schema dialog applying the rename, as what it threw or what it answered. */
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
        return {
          failed: true,
          said: String(error),
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
  }
);
