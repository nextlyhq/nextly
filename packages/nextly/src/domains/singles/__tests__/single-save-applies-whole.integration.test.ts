/**
 * A Single's schema save applies whole or fails whole, and says why, as a collection's save does.
 *
 * The save used to run its migration statement by statement and record a refusal as a failed
 * migration status beside the new fields, so a change the database refused part-way was saved as
 * if it had been made. It now asks what the stored value can take before any statement runs, runs
 * the migration in one transaction where the dialect allows it, and on a refusal fails the save
 * with the reason and leaves the registry as it was.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { uniqueIndexNameForColumn } from "../../schema/services/index-name";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { SingleEntryService } from "../services/single-entry-service";
import type { SingleMetadataService } from "../services/single-metadata-service";
import type { SingleRegistryService } from "../services/single-registry-service";

/** A short text field, whose maximum length sets its column's width. */
function shortText(name: string, maxLength: number) {
  return {
    name,
    type: "text",
    options: { variant: "short" },
    validation: { maxLength },
  };
}

describeEachDialect("a Single's schema save that cannot apply", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The Builder's save runs its migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
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
    return rows.map(row => row.name);
  }

  /** The fields the registry records for the Single, as stored. */
  async function registeredFields(): Promise<Record<string, unknown>[]> {
    const [row] = await query<{ fields: unknown }>(
      `SELECT ${q("fields")} AS fields FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'hero'`
    );
    return (
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
    ) as Record<string, unknown>[];
  }

  /** A Single `hero` with the given fields, holding the given values. */
  async function heroWith(
    fields: Record<string, unknown>[],
    values: Record<string, unknown>
  ): Promise<void> {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "hero", label: "Hero", fields }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const written = await singles.update("hero", values, {
      overrideAccess: true,
    });
    expect(written.success, JSON.stringify(written)).toBe(true);
  }

  /** The Builder's schema save, as the dispatcher makes it. */
  function save(fields: Record<string, unknown>[]): Promise<unknown> {
    return dispatchSingles("updateSingleSchema", { slug: "hero" }, { fields });
  }

  /**
   * The same save made on the service the dispatcher calls. A short text field's width is set by
   * `options.variant`, which the Builder's fields payload does not carry for a Single, so a
   * bounded text field reaches the save only from here.
   */
  async function saveThroughService(
    fields: Record<string, unknown>[]
  ): Promise<unknown> {
    const registry: SingleRegistryService = current.getService(
      "singleRegistryService"
    );
    const metadata: SingleMetadataService = current.getService(
      "singleMetadataService"
    );
    const existing = await registry.getSingleBySlug("hero");
    if (!existing) throw new Error("the Single hero is missing");
    return metadata.updateSingleSchema({
      slug: "hero",
      existing,
      updateData: { fields },
      fields: fields as unknown as FieldDefinition[],
      isLocalized: false,
      wasLocalized: false,
      localizedRequested: false,
      hasStatus: false,
      wasStatus: false,
      statusRequested: false,
    });
  }

  /** The error a refused save throws, or undefined when the save went through. */
  function refusal(saved: Promise<unknown>): Promise<unknown> {
    return saved.then(
      () => undefined,
      (error: unknown) => error
    );
  }

  /** `hero` with a 20-character `heading` holding `value`. */
  async function boundedHero(value: string): Promise<void> {
    await heroWith([{ name: "heading", type: "text" }], {});
    await saveThroughService([shortText("heading", 20)]);
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const written = await singles.update(
      "hero",
      { heading: value },
      { overrideAccess: true }
    );
    expect(written.success, JSON.stringify(written)).toBe(true);
  }

  it("refuses a length shorter than the value the Single holds, naming the field, and changes nothing", async () => {
    await boundedHero("Long enough");
    const fieldsBefore = await registeredFields();

    const refused = await refusal(
      saveThroughService([shortText("heading", 5)])
    );

    expect(refused).toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({
            path: "fields.heading",
            message: expect.stringMatching(
              /^1 entry holds a heading longer than 5 characters, the new length\./
            ),
          }),
        ],
      },
    });
    expect(await registeredFields()).toEqual(fieldsBefore);
    const [row] = await query<{ heading: string }>(
      `SELECT ${q("heading")} AS heading FROM ${q("single_hero")}`
    );
    expect(row?.heading).toBe("Long enough");
  });

  it("saves a length the value the Single holds still fits", async () => {
    await boundedHero("Hi");

    await saveThroughService([shortText("heading", 5)]);

    expect(await registeredFields()).toEqual([
      expect.objectContaining({
        name: "heading",
        validation: { maxLength: 5 },
      }),
    ]);
  });

  // Not on SQLite, whose unique index is created `IF NOT EXISTS`: a name already taken is skipped
  // there rather than refused, so the save cannot be made to fail part-way the same way.
  it.skipIf(dialect === "sqlite")(
    "fails a save the database refuses part-way with the reason, and a later save finishes it",
    async () => {
      // Something no precondition foresees: an index already holding the name the new unique
      // index takes. PostgreSQL rolls the whole save back; MySQL has added the column by then,
      // since it commits each schema statement, and the next save has to finish from there.
      await heroWith([{ name: "heading", type: "text" }], { heading: "One" });
      const blocking = uniqueIndexNameForColumn("single_hero", "code");
      await query(
        `CREATE INDEX ${q(blocking)} ON ${q("single_hero")} (${q("id")})`
      );
      // A number, so MySQL can index it as the Builder sends it.
      const fields = [
        { name: "heading", type: "text" },
        { name: "code", type: "number", unique: true },
      ];

      const refused = await refusal(save(fields));

      expect(refused).toMatchObject({
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        publicMessage: expect.stringMatching(
          dialect === "mysql"
            ? /^The database refused statement \d+ of \d+ of this schema change\. The \d+ before it were applied/
            : /^The database refused this schema change, so nothing was changed\./
        ),
      });
      expect((await registeredFields()).map(f => f.name)).toEqual(["heading"]);
      if (dialect === "postgresql") {
        expect(await columnsOf("single_hero")).not.toContain("code");
      }

      await query(
        dialect === "mysql"
          ? `DROP INDEX ${q(blocking)} ON ${q("single_hero")}`
          : `DROP INDEX ${q(blocking)}`
      );
      await save(fields);

      expect(await columnsOf("single_hero")).toContain("code");
      expect((await registeredFields()).map(f => f.name)).toEqual([
        "heading",
        "code",
      ]);
    }
  );
  // MySQL only: it commits each schema statement, so a rename can land before a later statement
  // of the same save is refused. PostgreSQL rolls the whole save back, and SQLite skips the name.
  it.skipIf(dialect !== "mysql")(
    "finishes a save whose rename landed before a later statement was refused",
    async () => {
      await heroWith(
        [
          { name: "heading", type: "text" },
          { name: "views", type: "number" },
        ],
        { heading: "Hello", views: 7 }
      );
      const blocking = uniqueIndexNameForColumn("single_hero", "views");
      await query(
        `CREATE INDEX ${q(blocking)} ON ${q("single_hero")} (${q("id")})`
      );
      // `heading` renamed to `headline`, and `views` made unique: the rename runs first, and the
      // unique index is refused on the name another index holds.
      const fields = [
        { name: "headline", type: "text" },
        { name: "views", type: "number", unique: true },
      ];

      const refused = await refusal(save(fields));
      expect(refused).toMatchObject({ code: "NEXTLY_MIGRATION_APPLY_FAILED" });
      expect(await columnsOf("single_hero")).toContain("headline");

      await query(`DROP INDEX ${q(blocking)} ON ${q("single_hero")}`);
      await save(fields);

      expect((await registeredFields()).map(f => f.name)).toEqual([
        "headline",
        "views",
      ]);
      const [row] = await query<{ headline: string }>(
        `SELECT ${q("headline")} AS headline FROM ${q("single_hero")}`
      );
      expect(row?.headline).toBe("Hello");
    }
  );

  it("saves a field whose default holds the statement separator's text", async () => {
    // The separator is a line of its own between statements; the same text inside a quoted default
    // is part of the value, and a statement cut there is no longer valid SQL.
    await heroWith([{ name: "heading", type: "text" }], { heading: "Hello" });

    await saveThroughService([
      { name: "heading", type: "text" },
      // Short, so the column is a varchar: MySQL takes no default on a text column.
      { ...shortText("note", 64), default: "a --> statement-breakpoint b" },
    ]);

    expect(await columnsOf("single_hero")).toContain("note");
  });
});

describeEachDialect(
  "a translated Single's schema save that cannot apply",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
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

    it("refuses a length shorter than a translation the Single holds, naming the field", async () => {
      // A translated field's values are on the companion, one row per language: the narrower
      // length is checked against those, not only against what the main table holds.
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "hero",
          label: "Hero",
          localized: true,
          fields: [{ name: "heading", type: "text" }],
        }
      );
      const registry: SingleRegistryService = current.getService(
        "singleRegistryService"
      );
      const metadata: SingleMetadataService = current.getService(
        "singleMetadataService"
      );
      const saveThroughService = async (fields: Record<string, unknown>[]) => {
        const existing = await registry.getSingleBySlug("hero");
        if (!existing) throw new Error("the Single hero is missing");
        return metadata.updateSingleSchema({
          slug: "hero",
          existing,
          updateData: { fields },
          fields: fields as unknown as FieldDefinition[],
          isLocalized: true,
          wasLocalized: true,
          localizedRequested: false,
          hasStatus: false,
          wasStatus: false,
          statusRequested: false,
        });
      };
      await saveThroughService([shortText("heading", 40)]);
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      for (const [locale, heading] of [
        ["en", "Hi"],
        ["es", "Una frase bastante larga"],
      ]) {
        const written = await singles.update(
          "hero",
          { heading },
          { locale, overrideAccess: true }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }

      const refused = await saveThroughService([shortText("heading", 5)]).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.heading",
              message: expect.stringMatching(
                /^1 entry holds a heading longer than 5 characters, the new length\./
              ),
            }),
          ],
        },
      });
    });
  }
);
