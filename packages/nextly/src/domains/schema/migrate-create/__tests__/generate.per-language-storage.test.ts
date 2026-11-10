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

import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../../i18n/per-language-storage";
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

  afterEach(() => _resetPerLanguageStorage());

  it("gives a collection that is not marked translatable its companion, and leaves its translatable columns to it", async () => {
    setPerLanguageStorage(true);
    const { mainColumns, sql } = await generated(migrationsDir);
    expect(mainColumns).toContain("views");
    expect(mainColumns).not.toContain("headline");
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "dc_notes_locales"`);
  });

  // A Draft/Published collection that is not translated publishes as a document, so its
  // companion has no `_status`: a shared field moving into it must not write one.
  it("moves a shared field into the companion of an untranslated Draft/Published collection without a status", async () => {
    setPerLanguageStorage(true);
    const fields = (headline: Record<string, unknown>) => [
      headline,
      { name: "summary", type: "text" },
      { name: "views", type: "number" },
    ];
    const run = (name: string, at: string, headline: Record<string, unknown>) =>
      generateMigration({
        name,
        dialect: "sqlite",
        migrationsDir,
        // A move of existing values records their language, which the config declares.
        defaultLocale: "en",
        collections: [
          {
            slug: "notes",
            tableName: "dc_notes",
            status: true,
            fields: fields(headline),
          } as MinimalConfigEntity,
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date(at),
      });
    await run("create_notes", "2026-10-29T12:00:00.000Z", {
      name: "headline",
      type: "text",
      localized: false,
    });
    const before = new Set(
      (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"))
    );
    await run("headline_joins", "2026-10-30T12:00:00.000Z", {
      name: "headline",
      type: "text",
    });
    const added = (await readdir(migrationsDir)).filter(
      f => f.endsWith(".sql") && !before.has(f)
    );
    const sql = (
      await Promise.all(
        added.map(f => readFile(resolve(migrationsDir, f), "utf-8"))
      )
    ).join("\n");
    // The move is planned, so absence of `_status` below is not an empty file passing.
    expect(sql).toContain(`"dc_notes_locales"`);
    expect(sql).toContain(`"headline"`);
    expect(sql).not.toContain(`"_status"`);
  });

  // The mirror of a field joining: one leaving the companion of an untranslated Draft/Published
  // collection moves back to the main table, and the rollback recreates its per-language rows
  // without a `_status` the companion never had.
  it("moves a field out of the companion of an untranslated Draft/Published collection without a status", async () => {
    setPerLanguageStorage(true);
    const run = (name: string, at: string, headline: Record<string, unknown>) =>
      generateMigration({
        name,
        dialect: "sqlite",
        migrationsDir,
        // A move of existing values records their language, which the config declares.
        defaultLocale: "en",
        collections: [
          {
            slug: "notes",
            tableName: "dc_notes",
            status: true,
            fields: [
              headline,
              { name: "summary", type: "text" },
              { name: "views", type: "number" },
            ],
          } as MinimalConfigEntity,
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date(at),
      });
    await run("create_notes", "2026-10-29T12:00:00.000Z", {
      name: "headline",
      type: "text",
    });
    const before = new Set(
      (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"))
    );
    await run("headline_leaves", "2026-10-30T12:00:00.000Z", {
      name: "headline",
      type: "text",
      localized: false,
    });
    const added = (await readdir(migrationsDir)).filter(
      f => f.endsWith(".sql") && !before.has(f)
    );
    const sql = (
      await Promise.all(
        added.map(f => readFile(resolve(migrationsDir, f), "utf-8"))
      )
    ).join("\n");
    // The move is planned, so absence of `_status` below is not an empty file passing.
    expect(sql).toContain(`"dc_notes_locales"`);
    expect(sql).toContain(`"headline"`);
    expect(sql).not.toContain(`"_status"`);
  });

  // A file that seeds existing content records the language it is in, and a migration file must
  // not depend on whichever database the developer reached: with the setting on and no
  // `localization` block, the default is declared in the config or the file is refused.
  it("refuses to seed existing content under the setting until the config declares its default language", async () => {
    setPerLanguageStorage(false);
    await generated(migrationsDir);
    setPerLanguageStorage(true);
    const seed = (defaultLocale?: string) =>
      generateMigration({
        name: "store_per_language",
        dialect: "sqlite",
        migrationsDir,
        ...(defaultLocale === undefined ? {} : { defaultLocale }),
        collections: [notes],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date("2026-10-31T12:00:00.000Z"),
      });

    await expect(seed()).rejects.toThrow(/declare `localization`/i);

    await seed("fr");
    const sql = (
      await Promise.all(
        (await readdir(migrationsDir))
          .filter(f => f.endsWith(".sql"))
          .map(f => readFile(resolve(migrationsDir, f), "utf-8"))
      )
    ).join("\n");
    expect(sql).toContain(`'fr'`);
  });

  it("generates it as before with the setting off", async () => {
    setPerLanguageStorage(false);
    const { mainColumns, sql } = await generated(migrationsDir);
    expect(mainColumns).toEqual(expect.arrayContaining(["headline", "views"]));
    expect(sql).not.toContain("dc_notes_locales");
  });
});
