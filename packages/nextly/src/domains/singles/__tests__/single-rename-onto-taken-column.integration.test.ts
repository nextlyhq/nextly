/**
 * A Single's schema save that renames a field onto a column the table already has is refused before
 * any statement runs, on every dialect, and a rename the database refuses as a duplicate is a
 * failure, never one already applied.
 *
 * A rename is a field renamed as its own action: the save's field list drops one field and adds one
 * of the same kind under a new name, which the save runs as `RENAME COLUMN`. When the table already
 * has a column of the new name (left by a hand edit, or by an earlier field), the rename cannot be
 * made without losing one of the two columns. The save is refused with `RENAME_TARGET_TAKEN`, naming
 * the table and both columns, and afterwards nothing has changed: the registry still records the
 * old field, both columns are there, and the value is read under the old name. On MySQL, where each
 * schema statement commits as it runs, nothing ahead of the rename ran either.
 *
 * The same holds for a translated field, whose values sit in the companion `_locales` table.
 *
 * Controls: a rename this database already made (the new column there, the old one gone, as a save
 * stopped part-way on MySQL leaves it) still saves; a rename onto another field's name is refused by
 * the sibling rule. And the save's own runner, handed a rename whose target exists, fails on every
 * dialect: on MySQL it used to pass over the database's "Duplicate column name" as a step an earlier
 * run had already applied, which recorded a rename while the values stayed in the old column.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { applyMigrationWhole } from "../../schema/services/apply-migration-statements";
import type { SingleEntryService } from "../services/single-entry-service";

/**
 * Stops one save between its main-table step and its companion step, as a process that dies
 * there would: the companion reconcile fails once when armed, and runs as it is otherwise.
 */
const companionStop = vi.hoisted(() => ({ armed: false }));
vi.mock("../services/reconcile-single-companion", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../services/reconcile-single-companion")
    >();
  return {
    ...actual,
    reconcileSingleCompanion: async (
      ...args: Parameters<typeof actual.reconcileSingleCompanion>
    ) => {
      if (companionStop.armed) {
        companionStop.armed = false;
        throw new Error("stopped between the main table and the companion");
      }
      return actual.reconcileSingleCompanion(...args);
    },
  };
});

const localization = { locales: ["en", "es"], defaultLocale: "en" };

describeEachDialect(
  "a Single's rename onto a column the table already has",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The Builder's save runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization,
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name).sort();
    }

    /** The names of the fields the registry records for `hero`, in order. */
    async function registeredFieldNames(): Promise<string[]> {
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'hero'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return fields.map(field => field.name);
    }

    /** A Single `hero` with `heading` and `body`, holding a heading, translated when `localized`. */
    async function hero(localized: boolean): Promise<void> {
      const heading = localized
        ? { name: "heading", type: "text", localized: true }
        : { name: "heading", type: "text" };
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "hero",
          label: "Hero",
          fields: [heading, { name: "body", type: "text" }],
          ...(localized ? { localized: true } : {}),
        }
      );
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      const written = await singles.update(
        "hero",
        { heading: "Kept", _overwrite: true },
        { overrideAccess: true, ...(localized ? { locale: "en" } : {}) }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);
      if (localized) {
        // A second language's value: the one a field leaving translation would archive.
        const spanish = await singles.update(
          "hero",
          { heading: "Guardado", _overwrite: true },
          { overrideAccess: true, locale: "es" }
        );
        expect(spanish.success, JSON.stringify(spanish)).toBe(true);
      }
    }

    /**
     * Every value archived for `hero`, by field and language. A table that is not there holds
     * none: the archive is created by the first write to it.
     */
    async function archived(): Promise<string[]> {
      if (!(await current.adapter.tableExists("nextly_i18n_archive")))
        return [];
      const rows = await query<{ field: string; locale: string }>(
        `SELECT ${q("field")} AS field, ${q("locale")} AS locale FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = 'hero' ORDER BY ${q("field")}, ${q("locale")}`
      );
      return rows.map(row => `${row.field}/${row.locale}`);
    }

    /** `heading`'s value on the main table and in each language of the companion. */
    async function storedHeadings(): Promise<{
      main: unknown[];
      companion: { locale: string; heading: unknown }[];
    }> {
      const main = await query<{ heading: unknown }>(
        `SELECT ${q("heading")} AS heading FROM ${q("single_hero")}`
      ).catch(() => []);
      const companion = await query<{ locale: string; heading: unknown }>(
        `SELECT ${q("_locale")} AS locale, ${q("heading")} AS heading FROM ${q("single_hero_locales")} ORDER BY ${q("_locale")}`
      );
      return { main: main.map(row => row.heading), companion };
    }

    /** The Builder's schema save, as the dispatcher makes it. */
    function save(
      fields: Record<string, unknown>[],
      extra: Record<string, unknown> = {}
    ): Promise<unknown> {
      return dispatchSingles(
        "updateSingleSchema",
        { slug: "hero" },
        { fields, ...extra }
      );
    }

    /** The error a refused save throws, or undefined when the save went through. */
    function refusal(saved: Promise<unknown>): Promise<unknown> {
      return saved.then(
        () => undefined,
        (error: unknown) => error
      );
    }

    /** `heading` read back from `hero`'s document. */
    async function headingRead(localized: boolean): Promise<unknown> {
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      const read = await singles.get("hero", {
        overrideAccess: true,
        ...(localized ? { locale: "en" } : {}),
      });
      return (read.data as { heading?: unknown } | undefined)?.heading;
    }

    it("refuses the rename, naming the table and both columns, and changes nothing", async () => {
      await hero(false);
      await query(
        `ALTER TABLE ${q("single_hero")} ADD COLUMN ${q("headline")} TEXT`
      );
      const columnsBefore = await columnsOf("single_hero");

      const refused = await refusal(
        save([
          { name: "headline", type: "text" },
          { name: "body", type: "text" },
        ])
      );

      expect(refused).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "RENAME_TARGET_TAKEN",
              message: expect.stringMatching(
                /'heading'.*'headline'.*'single_hero'|'single_hero'.*'heading'.*'headline'/
              ),
            }),
          ],
        },
      });
      expect(await registeredFieldNames()).toEqual(["heading", "body"]);
      expect(await columnsOf("single_hero")).toEqual(columnsBefore);
      expect(await headingRead(false)).toBe("Kept");
    });

    it("refuses a translated field's rename onto a column its companion already has", async () => {
      await hero(true);
      await query(
        `ALTER TABLE ${q("single_hero_locales")} ADD COLUMN ${q("headline")} TEXT`
      );
      const companionBefore = await columnsOf("single_hero_locales");

      const refused = await refusal(
        save(
          [
            { name: "headline", type: "text", localized: true },
            { name: "body", type: "text" },
          ],
          { localized: true }
        )
      );

      expect(refused).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "RENAME_TARGET_TAKEN",
              message: expect.stringContaining("single_hero_locales"),
            }),
          ],
        },
      });
      expect(await registeredFieldNames()).toEqual(["heading", "body"]);
      expect(await columnsOf("single_hero_locales")).toEqual(companionBefore);
      expect(await headingRead(true)).toBe("Kept");
    });

    // The rename a save stopped part-way already made on this database: the new column is there and
    // the old one is gone. Saving again finishes recording it; the check must not refuse it.
    // A translated field renamed as it leaves translation moves storage: its values go to a new
    // column of the main table. A column of that name already on the main table is in the way of
    // the move as much as of a RENAME, and the save is refused before anything is written: no
    // value archived under the new name, none copied into the column in the way.
    it("refuses a translated field renamed as it leaves translation, onto a column the main table has", async () => {
      await hero(true);
      await query(
        `ALTER TABLE ${q("single_hero")} ADD COLUMN ${q("headline")} TEXT`
      );
      const companionBefore = (await storedHeadings()).companion;

      const refused = await refusal(
        save(
          [
            { name: "headline", type: "text", localized: false },
            { name: "body", type: "text" },
          ],
          { localized: true }
        )
      );

      expect(refused).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "RENAME_TARGET_TAKEN",
              message: expect.stringContaining("table 'single_hero' already"),
            }),
          ],
        },
      });
      expect(await registeredFieldNames()).toEqual(["heading", "body"]);
      expect(await archived()).toEqual([]);
      const [leftover] = await query<{ headline: unknown }>(
        `SELECT ${q("headline")} AS headline FROM ${q("single_hero")}`
      );
      expect(leftover?.headline ?? null).toBeNull();
      expect((await storedHeadings()).companion).toEqual(companionBefore);
    });

    // The positive control for the archive readings above: with nothing in the way, the same save
    // goes through and archives the second language's value, so an empty archive after a refused
    // save is the refusal's doing and not a reading that finds nothing.
    it("archives the other languages of a translated field renamed as it leaves translation, with nothing in the way", async () => {
      await hero(true);

      await save(
        [
          { name: "headline", type: "text", localized: false },
          { name: "body", type: "text" },
        ],
        { localized: true }
      );

      expect(await registeredFieldNames()).toEqual(["headline", "body"]);
      expect(await archived()).toEqual(
        expect.arrayContaining([expect.stringMatching(/\/es$/)])
      );
    });

    // A rename that leaves translation runs in steps that each commit: the companion column is
    // renamed first, then the main table gains the new column, then the companion's values are
    // copied over and its column dropped. A save stopped after the main-table step leaves the new
    // column on both tables and the old one on neither, so saving again is not a move onto a
    // taken column: the check passes it, as it passes any move whose old column is gone.
    //
    // What the finished retry reads back is the companion reconcile's to answer, not this check's,
    // and is not asserted here.
    it("does not refuse saving again a rename leaving translation that stopped after its main-table step", async () => {
      await hero(true);
      const leaving = [
        { name: "headline", type: "text", localized: false },
        { name: "body", type: "text" },
      ];

      companionStop.armed = true;
      await refusal(save(leaving, { localized: true }));
      expect(companionStop.armed, "the stop was reached").toBe(false);
      // Past its main-table step a save records the fields it made (reported as a failed
      // migration), so saving again renames nothing and the check is not asked.
      expect(await registeredFieldNames()).toEqual(["headline", "body"]);
      // Where the stop left the columns: the new one on both tables, the old one on neither.
      expect(await columnsOf("single_hero")).toContain("headline");
      const companion = await columnsOf("single_hero_locales");
      expect(companion).toContain("headline");
      expect(companion).not.toContain("heading");

      const again = await refusal(save(leaving, { localized: true }));

      expect(again).toBeUndefined();
      expect(await registeredFieldNames()).toEqual(["headline", "body"]);
    });

    it("refuses a translated field renamed as it leaves translation, onto a column its companion has, before archiving", async () => {
      await hero(true);
      await query(
        `ALTER TABLE ${q("single_hero_locales")} ADD COLUMN ${q("headline")} TEXT`
      );

      const refused = await refusal(
        save(
          [
            { name: "headline", type: "text", localized: false },
            { name: "body", type: "text" },
          ],
          { localized: true }
        )
      );

      expect(refused).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "RENAME_TARGET_TAKEN",
              message: expect.stringContaining("single_hero_locales"),
            }),
          ],
        },
      });
      expect(await registeredFieldNames()).toEqual(["heading", "body"]);
      expect(await archived()).toEqual([]);
      expect(await headingRead(true)).toBe("Kept");
    });

    // MySQL and SQLite compare column names without regard to case, so a column spelled
    // `HEADLINE` is the column a rename to `headline` would collide with. PostgreSQL keeps the two
    // apart, and the rename goes through there.
    it("judges a column in the way by the database's rule for the case of a name", async () => {
      await hero(false);
      await query(
        `ALTER TABLE ${q("single_hero")} ADD COLUMN ${q("HEADLINE")} TEXT`
      );

      const refused = await refusal(
        save([
          { name: "headline", type: "text" },
          { name: "body", type: "text" },
        ])
      );

      if (dialect === "postgresql") {
        expect(refused).toBeUndefined();
        expect(await registeredFieldNames()).toEqual(["headline", "body"]);
        return;
      }
      expect(refused).toMatchObject({
        publicData: {
          errors: [expect.objectContaining({ code: "RENAME_TARGET_TAKEN" })],
        },
      });
      expect(await registeredFieldNames()).toEqual(["heading", "body"]);
      expect(await headingRead(false)).toBe("Kept");
    });

    it("saves a rename this database already made", async () => {
      await hero(false);
      await query(
        `ALTER TABLE ${q("single_hero")} RENAME COLUMN ${q("heading")} TO ${q("headline")}`
      );

      await save([
        { name: "headline", type: "text" },
        { name: "body", type: "text" },
      ]);

      expect(await registeredFieldNames()).toEqual(["headline", "body"]);
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      const read = await singles.get("hero", { overrideAccess: true });
      expect(read).toMatchObject({ data: { headline: "Kept" } });
    });

    it("refuses a rename onto another field's name by the sibling rule", async () => {
      await hero(false);

      const refused = await refusal(
        save([
          { name: "body", type: "text" },
          { name: "body", type: "text" },
        ])
      );

      expect(refused).toMatchObject({
        publicData: {
          errors: [expect.objectContaining({ code: "FIELD_NAME_DUPLICATE" })],
        },
      });
      expect(await registeredFieldNames()).toEqual(["heading", "body"]);
    });

    // The runner the save applies its migration with, handed a rename whose target exists, as it is
    // when nothing ahead of it refused the save: the database's refusal is a failure, never a step
    // an earlier run already applied, and the columns stay as they were.
    it("fails a rename the database refuses because its target exists", async () => {
      await query(
        `CREATE TABLE ${q("srotc_rename_probe")} (${q("id")} INTEGER PRIMARY KEY, ${q("heading")} TEXT, ${q("headline")} TEXT)`
      );
      await query(
        `INSERT INTO ${q("srotc_rename_probe")} (${q("id")}, ${q("heading")}) VALUES (1, 'Kept')`
      );

      const refused = await refusal(
        applyMigrationWhole({
          db: current.adapter.getDrizzle(),
          dialect,
          migrationSQL: `ALTER TABLE ${q("srotc_rename_probe")} RENAME COLUMN ${q("heading")} TO ${q("headline")};`,
          entity: "single",
          tolerateApplied: true,
        })
      );

      expect(refused).toBeDefined();
      expect(await columnsOf("srotc_rename_probe")).toEqual([
        "heading",
        "headline",
        "id",
      ]);
      const [row] = await query<{ heading: string }>(
        `SELECT ${q("heading")} AS heading FROM ${q("srotc_rename_probe")}`
      );
      expect(row?.heading).toBe("Kept");
    });
  }
);
