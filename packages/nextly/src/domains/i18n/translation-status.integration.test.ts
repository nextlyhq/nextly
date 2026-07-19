// M7 Task: populateTranslationStatus against a real in-memory SQLite companion table.

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  populateTranslationStatus,
  type LocaleTranslationMeta,
} from "./companion-join";
import { generateCompanionRuntimeSchema } from "../schema/services/runtime-schema-generator";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const LOCALIZED_FIELDS = [
  { name: "title", column: "title" },
  { name: "body", column: "body" },
];

/** A companion with a `_status` column (per-locale draft/published, i18n M6). */
function makeStatusCompanion() {
  return generateCompanionRuntimeSchema(
    "dc_pages_locales",
    [
      { name: "title", kind: "text" },
      { name: "body", kind: "text" },
    ],
    "sqlite",
    { status: true }
  ).table;
}

/** A companion WITHOUT status (localization but no drafts). */
function makeNoStatusCompanion() {
  return generateCompanionRuntimeSchema(
    "dc_pages_locales",
    [
      { name: "title", kind: "text" },
      { name: "body", kind: "text" },
    ],
    "sqlite"
  ).table;
}

const tr = (row: Record<string, unknown>) =>
  row._translations as Record<string, LocaleTranslationMeta>;

describe("populateTranslationStatus (real SQLite)", () => {
  describe("with per-locale status", () => {
    beforeEach(() => {
      sqlite = new Database(":memory:");
      db = drizzle({ client: sqlite });
      sqlite.exec(
        'CREATE TABLE "dc_pages_locales" ("_parent" text, "_locale" text, "_status" text NOT NULL DEFAULT \'draft\', "title" text, "body" text, PRIMARY KEY ("_parent","_locale"))'
      );
    });
    afterEach(() => sqlite.close());

    it("reports translated + status per locale, marks missing locales untranslated", async () => {
      db.run(
        sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","title","body") VALUES
          ('p1','en','published','Hello','World'),
          ('p1','de','draft','Hallo','Welt')`
      );
      // p1 has en+de; fr has no row.
      const rows: Record<string, unknown>[] = [{ id: "p1" }];

      await populateTranslationStatus({
        db: db as never,
        companionTable: makeStatusCompanion(),
        localizedFields: LOCALIZED_FIELDS,
        rows,
        locales: ["en", "de", "fr"],
        defaultLocale: "en",
        hasStatus: true,
      });

      expect(tr(rows[0])).toEqual({
        en: { translated: true, status: "published" },
        de: { translated: true, status: "draft" },
        fr: { translated: false },
      });
    });

    it("treats a present-but-all-blank row as untranslated (blank = untranslated, spec §8)", async () => {
      db.run(
        sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","title","body") VALUES
          ('p1','en','published','Hello','World'),
          ('p1','de','draft','','')`
      );
      const rows: Record<string, unknown>[] = [{ id: "p1" }];

      await populateTranslationStatus({
        db: db as never,
        companionTable: makeStatusCompanion(),
        localizedFields: LOCALIZED_FIELDS,
        rows,
        locales: ["en", "de"],
        defaultLocale: "en",
        hasStatus: true,
      });

      // de row exists (so it carries a status) but is blank → not translated.
      expect(tr(rows[0]).de).toEqual({ translated: false, status: "draft" });
    });

    it("marks a partially-filled row translated (at least one non-blank field)", async () => {
      db.run(
        sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","_status","title","body") VALUES
          ('p1','de','draft','Hallo','')`
      );
      const rows: Record<string, unknown>[] = [{ id: "p1" }];

      await populateTranslationStatus({
        db: db as never,
        companionTable: makeStatusCompanion(),
        localizedFields: LOCALIZED_FIELDS,
        rows,
        locales: ["en", "de"],
        defaultLocale: "en",
        hasStatus: true,
      });

      expect(tr(rows[0]).de.translated).toBe(true);
    });

    it("always reports the default locale as translated (fallback source)", async () => {
      // No companion rows at all for p1.
      const rows: Record<string, unknown>[] = [{ id: "p1" }];

      await populateTranslationStatus({
        db: db as never,
        companionTable: makeStatusCompanion(),
        localizedFields: LOCALIZED_FIELDS,
        rows,
        locales: ["en", "de"],
        defaultLocale: "en",
        hasStatus: true,
      });

      expect(tr(rows[0]).en.translated).toBe(true);
      expect(tr(rows[0]).de.translated).toBe(false);
    });
  });

  describe("without status", () => {
    beforeEach(() => {
      sqlite = new Database(":memory:");
      db = drizzle({ client: sqlite });
      sqlite.exec(
        'CREATE TABLE "dc_pages_locales" ("_parent" text, "_locale" text, "title" text, "body" text, PRIMARY KEY ("_parent","_locale"))'
      );
    });
    afterEach(() => sqlite.close());

    it("omits status when the collection has no per-locale status", async () => {
      db.run(
        sql`INSERT INTO "dc_pages_locales" ("_parent","_locale","title","body") VALUES
          ('p1','de','Hallo','Welt')`
      );
      const rows: Record<string, unknown>[] = [{ id: "p1" }];

      await populateTranslationStatus({
        db: db as never,
        companionTable: makeNoStatusCompanion(),
        localizedFields: LOCALIZED_FIELDS,
        rows,
        locales: ["en", "de"],
        defaultLocale: "en",
        hasStatus: false,
      });

      expect(tr(rows[0])).toEqual({
        en: { translated: true },
        de: { translated: true },
      });
    });
  });

  describe("resilience", () => {
    beforeEach(() => {
      sqlite = new Database(":memory:");
      db = drizzle({ client: sqlite });
    });
    afterEach(() => sqlite.close());

    it("no-ops (leaves rows untouched) when the companion table is missing", async () => {
      const rows: Record<string, unknown>[] = [{ id: "p1" }];
      await expect(
        populateTranslationStatus({
          db: db as never,
          companionTable: makeStatusCompanion(),
          localizedFields: LOCALIZED_FIELDS,
          rows,
          locales: ["en", "de"],
          defaultLocale: "en",
          hasStatus: true,
        })
      ).resolves.toBeUndefined();
      expect(rows[0]._translations).toBeUndefined();
    });

    it("is a no-op for empty rows / no locales", async () => {
      const rows: Record<string, unknown>[] = [];
      await populateTranslationStatus({
        db: db as never,
        companionTable: makeStatusCompanion(),
        localizedFields: LOCALIZED_FIELDS,
        rows,
        locales: ["en"],
        defaultLocale: "en",
        hasStatus: true,
      });
      expect(rows).toEqual([]);
    });
  });
});
