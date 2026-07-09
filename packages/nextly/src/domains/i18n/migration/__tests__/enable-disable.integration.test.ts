import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive/ddl";
import { getSchemaEventsDdl } from "../../../schema/events/schema-events-ddl";
import { writeLocalizationMigrationFile } from "../write-migration-file";
import type { CompanionMigrationSpec } from "../types";

let dir: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const logger = {
  debug: () => {},
  warn: () => {},
  success: () => {},
} as unknown as Parameters<typeof runFileMigrations>[0]["logger"];

function makeAdapter() {
  return {
    listTables: () =>
      Promise.resolve(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map(r => (r as { name: string }).name)
      ),
    executeQuery: (q: string) => {
      sqlite.exec(q);
      return Promise.resolve([]);
    },
    getDrizzle: () => db,
  } as unknown as Parameters<typeof runFileMigrations>[0]["adapter"];
}

const spec: CompanionMigrationSpec = {
  dialect: "sqlite",
  collection: "pages",
  mainTable: "dc_pages",
  companionTable: "dc_pages_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [
    { name: "title", kind: "text" },
    { name: "body", kind: "longText" },
  ],
};

async function apply() {
  return runFileMigrations({
    adapter: makeAdapter(),
    db,
    dialect: "sqlite",
    migrationsDir: dir,
    logger,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "i18n-e2e-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite);

  for (const s of getSchemaEventsDdl("sqlite")) sqlite.exec(s);
  for (const s of getI18nArchiveDdl("sqlite")) sqlite.exec(s);

  // A collection table with two soon-to-be-localized columns + a shared one.
  sqlite.exec(
    `CREATE TABLE "dc_pages" ("id" TEXT PRIMARY KEY, "title" TEXT, "body" TEXT, "price" INTEGER)`
  );
  sqlite.exec(`INSERT INTO "dc_pages" VALUES ('p1','Hello','World',99)`);
  sqlite.exec(`INSERT INTO "dc_pages" VALUES ('p2','Hi','There',5)`);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("i18n enable/disable migration (real sqlite)", () => {
  it("ENABLE copies values into the companion table and drops main columns", async () => {
    writeLocalizationMigrationFile(dir, spec, {
      direction: "enable",
      now: new Date("2026-07-08T00:00:00Z"),
    });
    const applied = await apply();
    expect(applied).toBe(1);

    // companion seeded with the default locale
    const rows = sqlite
      .prepare(
        `SELECT _parent, _locale, title, body FROM "dc_pages_locales" ORDER BY _parent`
      )
      .all();
    expect(rows).toEqual([
      { _parent: "p1", _locale: "en", title: "Hello", body: "World" },
      { _parent: "p2", _locale: "en", title: "Hi", body: "There" },
    ]);

    // main columns dropped, shared column retained
    const cols = sqlite
      .prepare(`PRAGMA table_info("dc_pages")`)
      .all()
      .map(r => (r as { name: string }).name);
    expect(cols).toEqual(["id", "price"]);
  });

  it("DISABLE restores the default locale and archives the rest", async () => {
    // enable first
    writeLocalizationMigrationFile(dir, spec, {
      direction: "enable",
      now: new Date("2026-07-08T00:00:00Z"),
    });
    await apply();

    // add a German translation, then remove the enable file so only disable is pending
    sqlite.exec(
      `INSERT INTO "dc_pages_locales" VALUES ('p1','de','Hallo','Welt')`
    );
    rmSync(join(dir, "20260708_000000_000_enable_localization_pages.sql"));

    writeLocalizationMigrationFile(dir, spec, {
      direction: "disable",
      now: new Date("2026-07-08T01:00:00Z"),
    });
    await apply();

    // English restored on the main table
    const main = sqlite
      .prepare(`SELECT id, title, body FROM "dc_pages" ORDER BY id`)
      .all();
    expect(main).toEqual([
      { id: "p1", title: "Hello", body: "World" },
      { id: "p2", title: "Hi", body: "There" },
    ]);

    // German archived
    const arch = sqlite
      .prepare(
        `SELECT collection, entry_id, locale, field, value FROM "nextly_i18n_archive" ORDER BY field`
      )
      .all();
    expect(arch).toEqual([
      {
        collection: "pages",
        entry_id: "p1",
        locale: "de",
        field: "body",
        value: "Welt",
      },
      {
        collection: "pages",
        entry_id: "p1",
        locale: "de",
        field: "title",
        value: "Hallo",
      },
    ]);

    // companion gone
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => (r as { name: string }).name);
    expect(tables).not.toContain("dc_pages_locales");
  });
});
