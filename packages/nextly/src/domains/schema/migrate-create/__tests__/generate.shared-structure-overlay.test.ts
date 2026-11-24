// A repeater or group keeping one structure in every language has its structure on the main
// table and each language's text inside it in an overlay column of the same name on the
// translations table. `migrate:create` plans that column as the runtime builds it: created with
// the translations table, and added (empty: there is nothing to copy into it) when a container
// starts keeping text inside. Without it, a site run on migrations alone has no overlay column,
// every write of such a container fails, and a Builder save reads the runtime's column as drift.

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { generateMigration, type MinimalConfigEntity } from "../generate";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const LATER = new Date("2026-11-20T13:00:00.000Z");

/** The translations-table SQL written for `collection`, all files of it together. */
async function companionSql(dir: string, collection: string): Promise<string> {
  const files = (await readdir(dir)).filter(
    f => f.endsWith(".sql") && f.includes(`localization_${collection}`)
  );
  const texts = await Promise.all(
    files.map(f => readFile(resolve(dir, f), "utf-8"))
  );
  return texts.join("\n");
}

/** The columns the latest snapshot gives `table`. */
async function snapshotColumns(dir: string, table: string): Promise<string[]> {
  const meta = resolve(dir, "meta");
  const files = (await readdir(meta))
    .filter(f => f.endsWith(".snapshot.json"))
    .sort();
  const snap = JSON.parse(
    await readFile(resolve(meta, files[files.length - 1]!), "utf-8")
  );
  const found = snap.snapshot.tables.find(
    (t: { name: string }) => t.name === table
  );
  return (found?.columns ?? []).map((c: { name: string }) => c.name);
}

const SLIDES = {
  name: "slides",
  type: "repeater",
  fields: [
    { name: "caption", type: "text" },
    { name: "rank", type: "number" },
  ],
};

describe("generateMigration: overlay columns of containers keeping one structure", () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-overlay-"));
  });

  it("creates the translations table with a container's overlay column, its structure staying on the main table", async () => {
    const pages: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      localized: true,
      fields: [{ name: "title", type: "text" }, SLIDES],
    };

    await generateMigration({
      name: "create_pages",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [pages],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });

    const sql = await companionSql(migrationsDir, "pages");
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "dc_pages_locales"`);
    // The translated text field and the repeater's overlay, both on the translations table.
    expect(sql).toMatch(/"title"/);
    expect(sql).toMatch(/"slides"/);
    // The structure stays on the main table, for every language.
    expect(await snapshotColumns(migrationsDir, "dc_pages")).toContain(
      "slides"
    );
  });

  it("adds the overlay column, empty, when a translated collection gains a container keeping text inside", async () => {
    const before: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      localized: true,
      fields: [{ name: "title", type: "text" }],
    };
    await generateMigration({
      name: "create_pages",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [before],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    const first = await companionSql(migrationsDir, "pages");
    // The control: no overlay before the container exists.
    expect(first).not.toMatch(/"slides"/);

    await generateMigration({
      name: "add_slides",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [{ ...before, fields: [...before.fields, SLIDES] }],
      singles: [],
      components: [],
      nonInteractive: true,
      now: LATER,
    });

    const all = await companionSql(migrationsDir, "pages");
    const added = all.slice(first.length);
    expect(added).toMatch(/ADD COLUMN "slides"/);
    // Nothing is copied into it: no language has text there yet.
    expect(added).not.toMatch(/INSERT INTO|UPDATE "dc_pages_locales"/);
  });

  it("creates the translations table of an entity whose only text per language is inside a container", async () => {
    const shows: MinimalConfigEntity = {
      slug: "shows",
      tableName: "dc_shows",
      localized: true,
      fields: [{ name: "views", type: "number" }, SLIDES],
    };

    await generateMigration({
      name: "create_shows",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [shows],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });

    const sql = await companionSql(migrationsDir, "shows");
    // The table is made, with the overlay, never only altered.
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "dc_shows_locales"`);
    expect(sql).toMatch(/"slides"/);
    expect(await snapshotColumns(migrationsDir, "dc_shows")).toContain(
      "slides"
    );
  });

  it("keeps the column of a container translated whole before as its overlay, adding none and moving nothing", async () => {
    const before: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      localized: true,
      // As an earlier release allowed: the repeater translated whole, its column on the
      // translations table.
      fields: [
        { name: "title", type: "text" },
        { ...SLIDES, localized: true },
      ],
    };
    await generateMigration({
      name: "create_pages",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [before],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    const first = await companionSql(migrationsDir, "pages");
    // The control: the whole repeater's column was made on the translations table.
    expect(first).toMatch(/"slides"/);

    await generateMigration({
      name: "one_structure",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [
        { ...before, fields: [{ name: "title", type: "text" }, SLIDES] },
      ],
      singles: [],
      components: [],
      nonInteractive: true,
      now: LATER,
    });

    const added = (await companionSql(migrationsDir, "pages")).slice(
      first.length
    );
    // No second column of that name, and its values are not moved to the main table or dropped:
    // the upgrade converts them in place.
    expect(added).not.toMatch(/ADD COLUMN "slides"/);
    expect(added).not.toMatch(/DROP COLUMN "slides"/);
    // The structure's column on the main table, for every language.
    expect(await snapshotColumns(migrationsDir, "dc_pages")).toContain(
      "slides"
    );
  });
});
