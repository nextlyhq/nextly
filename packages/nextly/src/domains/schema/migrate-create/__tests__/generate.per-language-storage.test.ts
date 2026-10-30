/**
 * `migrate:create` on a site keeping every translatable field per language: a new collection that
 * is not marked translatable gets its companion, and its main table leaves its translatable
 * columns to it, as the site itself lays the collection out. With the setting off it is generated
 * as before.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPerLanguageStorage } from "../../../i18n/per-language-storage";
import { generateMigration, type MinimalConfigEntity } from "../generate";

const NOW = new Date("2026-10-30T12:00:00.000Z");

/** A collection that is not marked translatable, with one text field and one number. */
const notes: MinimalConfigEntity = {
  slug: "notes",
  tableName: "dc_notes",
  fields: [
    { name: "headline", type: "text" },
    { name: "views", type: "number" },
  ],
};

/** The main table's columns in the snapshot the migration recorded, and its companion's SQL. */
async function generated(dir: string) {
  await generateMigration({
    name: "create_notes",
    dialect: "sqlite",
    migrationsDir: dir,
    collections: [notes],
    singles: [],
    components: [],
    nonInteractive: true,
    now: NOW,
  });
  const metaDir = resolve(dir, "meta");
  const [snapshotFile] = (await readdir(metaDir)).filter(f =>
    f.endsWith(".snapshot.json")
  );
  const snap = JSON.parse(
    await readFile(resolve(metaDir, snapshotFile), "utf-8")
  );
  const main = snap.snapshot.tables.find(
    (t: { name: string }) => t.name === "dc_notes"
  ) as { columns: { name: string }[] };
  const sql = await Promise.all(
    (await readdir(dir))
      .filter(f => f.endsWith(".sql"))
      .map(f => readFile(resolve(dir, f), "utf-8"))
  );
  return { mainColumns: main.columns.map(c => c.name), sql: sql.join("\n") };
}

describe("generateMigration under per-language storage", () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-per-language-"));
  });

  afterEach(() => setPerLanguageStorage(false));

  it("gives a collection that is not marked translatable its companion, and leaves its translatable columns to it", async () => {
    setPerLanguageStorage(true);
    const { mainColumns, sql } = await generated(migrationsDir);
    expect(mainColumns).toContain("views");
    expect(mainColumns).not.toContain("headline");
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "dc_notes_locales"`);
  });

  it("generates it as before with the setting off", async () => {
    setPerLanguageStorage(false);
    const { mainColumns, sql } = await generated(migrationsDir);
    expect(mainColumns).toEqual(expect.arrayContaining(["headline", "views"]));
    expect(sql).not.toContain("dc_notes_locales");
  });
});
