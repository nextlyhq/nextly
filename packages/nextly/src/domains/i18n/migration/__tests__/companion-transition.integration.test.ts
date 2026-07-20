// The data-preserving runtime localization toggle: enabling i18n on an existing entity must
// SEED the companion from the current main-table values then drop those columns, and disabling
// must RESTORE the default locale onto main + archive the other languages before dropping the
// companion. Runs the generated statements against a real SQLite database so the seed/restore/
// archive round-trips are exercised end to end, not mocked. Shared by the collection, single,
// and component Schema-Builder toggle paths.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive/ddl";
import { buildCompanionTransitionStatements } from "../reconcile-companion";

let sqlite: Database.Database;

/** A non-localized single's main table with a translatable `heading` column and a shared `views`. */
function createMainTable() {
  sqlite.exec(`CREATE TABLE "single_hero" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT,
    "heading" TEXT,
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
      `INSERT INTO "single_hero" ("id","title","heading","views") VALUES (?,?,?,?)`
    )
    .run("h1", "Hero", "Hello", 42);
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
