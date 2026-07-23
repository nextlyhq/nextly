// The data-preserving runtime localization toggle: enabling i18n on an existing entity must
// SEED the companion from the current main-table values then drop those columns, and disabling
// must RESTORE the default locale onto main + archive the other languages before dropping the
// companion. Runs the generated statements against a real SQLite database so the seed/restore/
// archive round-trips are exercised end to end, not mocked. Shared by the collection, single,
// and component Schema-Builder toggle paths.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive/ddl";
import { ddlType } from "../ddl-types";
import { fieldToLocalizedColumnSpec } from "../field-to-column-spec";
import { buildCompanionTransitionStatements } from "../reconcile-companion";

let sqlite: Database.Database;

/** The camelCase translatable field exercised by the enable tests. */
const SUB_TITLE_FIELD = { name: "subTitle", type: "text" as const };

/** The field's physical column, resolved through the SAME descriptor + DDL helpers the
 *  migration generator uses, so the fixture tracks any change to the field-to-column
 *  mapping instead of hand-copying its current output. */
function subTitleColumn(): { name: string; ddl: string } {
  const col = fieldToLocalizedColumnSpec(SUB_TITLE_FIELD, "sqlite");
  if (!col) {
    // A text field must map to a physical column; the fixture cannot be built without one.
    throw NextlyError.internal({
      logContext: {
        field: SUB_TITLE_FIELD.name,
        reason: "no column descriptor",
      },
    });
  }
  return { name: col.name, ddl: ddlType(col, "sqlite") };
}

/** A non-localized single's main table with a translatable `heading` column, a shared
 *  `views`, and the descriptor-derived column for {@link SUB_TITLE_FIELD}. */
function createMainTable() {
  const sub = subTitleColumn();
  sqlite.exec(`CREATE TABLE "single_hero" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT,
    "heading" TEXT,
    "${sub.name}" ${sub.ddl},
    "views" INTEGER
  )`);
}

function mainColumns(): string[] {
  return (
    sqlite.prepare(`PRAGMA table_info("single_hero")`).all() as {
      name: string;
    }[]
  ).map(c => c.name);
}

function run(statements: string[]) {
  for (const stmt of statements) sqlite.exec(stmt);
}

const FIELDS = [
  { name: "heading", type: "text" as const },
  { name: "views", type: "number" as const },
];

beforeEach(() => {
  sqlite = new Database(":memory:");
  createMainTable();
  sqlite
    .prepare(
      `INSERT INTO "single_hero" ("id","title","heading","${subTitleColumn().name}","views") VALUES (?,?,?,?,?)`
    )
    .run("h1", "Hero", "Hello", "Sub", 42);
});

afterEach(() => sqlite.close());

describe("buildCompanionTransitionStatements — enable", () => {
  it("seeds the companion default locale from main, then drops the translatable column", () => {
    const plan = buildCompanionTransitionStatements({
      slug: "hero",
      tableName: "single_hero",
      dialect: "sqlite",
      defaultLocale: "en",
      status: false,
      wasLocalized: false,
      isLocalized: true,
      oldFields: FIELDS,
      newFields: FIELDS,
      companionExists: false,
    });

    expect(plan.needsArchive).toBe(false);
    expect(plan.companionDropped).toBe(false);
    run(plan.statements);

    // The default-locale value was copied into the companion.
    const companionRow = sqlite
      .prepare(`SELECT * FROM "single_hero_locales"`)
      .get() as { _parent: string; _locale: string; heading: string };
    expect(companionRow).toMatchObject({
      _parent: "h1",
      _locale: "en",
      heading: "Hello",
    });

    // The translatable column was removed from main; the shared column stayed.
    const cols = mainColumns();
    expect(cols).not.toContain("heading");
    expect(cols).toContain("views");
  });

  it("enables localization while a translatable field is added in the same save", () => {
    // `description` is added AND localized in this save, so it was never on the main table.
    // The seed must not read it from main (there is nothing to copy), and the drop must not
    // target a column that is not there; the companion still gets the column.
    const plan = buildCompanionTransitionStatements({
      slug: "hero",
      tableName: "single_hero",
      dialect: "sqlite",
      defaultLocale: "en",
      status: false,
      wasLocalized: false,
      isLocalized: true,
      oldFields: FIELDS,
      newFields: [...FIELDS, { name: "description", type: "text" as const }],
      companionExists: false,
    });

    // Runs clean: the seed reads only columns that exist on main, so the added-and-localized
    // `description` is never selected from a table it was never on.
    run(plan.statements);

    // The companion carries both translatable columns.
    const companionCols = (
      sqlite.prepare(`PRAGMA table_info("single_hero_locales")`).all() as {
        name: string;
      }[]
    ).map(c => c.name);
    expect(companionCols).toContain("heading");
    expect(companionCols).toContain("description");

    // The pre-existing value seeded; the brand-new field seeds as null (no source data).
    const companionRow = sqlite
      .prepare(`SELECT * FROM "single_hero_locales"`)
      .get() as { heading: string; description: string | null };
    expect(companionRow.heading).toBe("Hello");
    expect(companionRow.description).toBeNull();

    // Only the pre-existing translatable column left main; the new one was never there.
    const cols = mainColumns();
    expect(cols).not.toContain("heading");
    expect(cols).toContain("views");
  });

  it("seeds and drops a camelCase-named field via its physical column", () => {
    // The field is NAMED `subTitle` but stored under the descriptor-derived column name.
    // The seed's SELECT and the main-table DROP must address the physical column, not the
    // raw field name, or the value is stranded on main.
    const sub = subTitleColumn();
    const plan = buildCompanionTransitionStatements({
      slug: "hero",
      tableName: "single_hero",
      dialect: "sqlite",
      defaultLocale: "en",
      status: false,
      wasLocalized: false,
      isLocalized: true,
      oldFields: [...FIELDS, SUB_TITLE_FIELD],
      newFields: [...FIELDS, SUB_TITLE_FIELD],
      companionExists: false,
    });
    run(plan.statements);

    // The pre-existing value was copied into the companion under the physical column name.
    const companionRow = sqlite
      .prepare(`SELECT * FROM "single_hero_locales"`)
      .get() as Record<string, unknown>;
    expect(companionRow.heading).toBe("Hello");
    expect(companionRow[sub.name]).toBe("Sub");

    // The physical column was relocated off main.
    expect(mainColumns()).not.toContain(sub.name);
  });

  it("ignores a field whose previous type had no main column", () => {
    // `gallery` used to be a `component` field (layout-only, no physical column) and becomes
    // a localized text field in the same save that enables localization. It matches by field
    // name in the old set, but the main table never carried a `gallery` column, so the seed
    // and drop must skip it; only its companion column is created.
    const plan = buildCompanionTransitionStatements({
      slug: "hero",
      tableName: "single_hero",
      dialect: "sqlite",
      defaultLocale: "en",
      status: false,
      wasLocalized: false,
      isLocalized: true,
      oldFields: [...FIELDS, { name: "gallery", type: "component" as const }],
      newFields: [...FIELDS, { name: "gallery", type: "text" as const }],
      companionExists: false,
    });
    run(plan.statements);

    // The companion has the column with no seeded data; the pre-existing field still seeded.
    const companionRow = sqlite
      .prepare(`SELECT * FROM "single_hero_locales"`)
      .get() as { heading: string; gallery: string | null };
    expect(companionRow.heading).toBe("Hello");
    expect(companionRow.gallery).toBeNull();
    expect(mainColumns()).not.toContain("heading");
  });
});

describe("buildCompanionTransitionStatements — disable", () => {
  beforeEach(() => {
    // Bring the entity to the enabled state first, then add a non-default translation.
    const enable = buildCompanionTransitionStatements({
      slug: "hero",
      tableName: "single_hero",
      dialect: "sqlite",
      defaultLocale: "en",
      status: false,
      wasLocalized: false,
      isLocalized: true,
      oldFields: FIELDS,
      newFields: FIELDS,
      companionExists: false,
    });
    run(enable.statements);
    sqlite
      .prepare(
        `INSERT INTO "single_hero_locales" ("_parent","_locale","heading") VALUES (?,?,?)`
      )
      .run("h1", "de", "Hallo");
  });

  it("restores the default locale onto main, archives the rest, and drops the companion", () => {
    const plan = buildCompanionTransitionStatements({
      slug: "hero",
      tableName: "single_hero",
      dialect: "sqlite",
      defaultLocale: "en",
      status: false,
      wasLocalized: true,
      isLocalized: false,
      oldFields: FIELDS,
      newFields: FIELDS,
      companionExists: true,
    });

    expect(plan.needsArchive).toBe(true);
    expect(plan.companionDropped).toBe(true);

    // The disable archives, so the caller ensures the archive table exists first.
    run(getI18nArchiveDdl("sqlite"));
    run(plan.statements);

    // The default-locale value is back on the main table.
    const mainRow = sqlite
      .prepare(`SELECT "heading" FROM "single_hero" WHERE "id" = 'h1'`)
      .get() as { heading: string };
    expect(mainRow.heading).toBe("Hello");
    expect(mainColumns()).toContain("heading");

    // The non-default translation was archived (recoverable via `nextly i18n:restore`).
    const archived = sqlite
      .prepare(
        `SELECT "collection","entry_id","locale","field","value" FROM "nextly_i18n_archive"`
      )
      .all() as {
      collection: string;
      entry_id: string;
      locale: string;
      field: string;
      value: string;
    }[];
    expect(archived).toEqual([
      {
        collection: "hero",
        entry_id: "h1",
        locale: "de",
        field: "heading",
        value: "Hallo",
      },
    ]);

    // The companion table is gone.
    const companionStillThere = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='single_hero_locales'`
      )
      .get();
    expect(companionStillThere).toBeUndefined();
  });
});
