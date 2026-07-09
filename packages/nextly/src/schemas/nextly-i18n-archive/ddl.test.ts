import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";

import { getI18nArchiveDdl } from "./ddl";

describe("getI18nArchiveDdl", () => {
  it("creates the archive table on sqlite with the expected columns", () => {
    const db = new Database(":memory:");
    for (const stmt of getI18nArchiveDdl("sqlite")) db.exec(stmt);
    const cols = db
      .prepare("PRAGMA table_info(nextly_i18n_archive)")
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    expect(cols).toEqual([
      "id",
      "collection",
      "entry_id",
      "locale",
      "field",
      "value",
      "archived_at",
    ]);
  });

  it("auto-generates id on insert (no id supplied)", () => {
    const db = new Database(":memory:");
    for (const stmt of getI18nArchiveDdl("sqlite")) db.exec(stmt);
    db.exec(
      "INSERT INTO nextly_i18n_archive (collection, entry_id, locale, field, value, archived_at) " +
        "VALUES ('pages','p1','de','title','Hallo', 0)"
    );
    const row = db.prepare("SELECT id FROM nextly_i18n_archive").get() as {
      id: number;
    };
    expect(typeof row.id).toBe("number");
  });

  it("returns statements for every dialect", () => {
    for (const d of ["postgresql", "mysql", "sqlite"] as const) {
      expect(getI18nArchiveDdl(d).length).toBeGreaterThan(0);
    }
  });
});
