// M3b-2 Task 3: migrate:create must (a) omit localized columns from the main
// table snapshot and (b) emit a snapshot-less companion `_locales` migration.
//
// Two transitions, detected from the previous snapshot's main table:
//   - FRESH localized collection (main never had the columns) -> create-only
//     companion (CREATE, no seed, no drop).
//   - ENABLE on an existing collection (previous main HELD the columns) ->
//     create + seed + drop; the main migration must NOT also drop them
//     (the companion owns the relocation) — no double-drop.

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  generateMigration,
  type MinimalConfigEntity,
} from "../generate";
import { writeSnapshot } from "../snapshot-io";

const NOW = new Date("2026-07-09T12:00:00.000Z");

/** Read all files written under the migrations dir (flat — no meta). */
async function listSqlFiles(dir: string): Promise<string[]> {
  const all = await readdir(dir);
  return all.filter(f => f.endsWith(".sql"));
}

async function findCompanionFile(
  dir: string,
  collection: string
): Promise<string | undefined> {
  const files = await listSqlFiles(dir);
  return files.find(f => f.includes(`localization_${collection}`));
}

describe("generateMigration — localized companion emission", () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-i18n-companion-"));
  });

  it("FRESH localized collection: create-only companion + main snapshot omits localized cols", async () => {
    const docs: MinimalConfigEntity = {
      slug: "docs",
      tableName: "dc_docs",
      localized: true,
      fields: [
        { name: "body", type: "longText", localized: true },
        { name: "price", type: "number" },
      ],
    };

    const result = await generateMigration({
      name: "create_docs",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [docs],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });

    expect(result).not.toBeNull();

    // Main snapshot omits the localized `body` column.
    const metaDir = resolve(migrationsDir, "meta");
    const snapshotFiles = (await readdir(metaDir)).filter(f =>
      f.endsWith(".snapshot.json")
    );
    expect(snapshotFiles.length).toBe(1);
    const snap = JSON.parse(
      await readFile(resolve(metaDir, snapshotFiles[0]), "utf-8")
    );
    const docsTable = snap.snapshot.tables.find(
      (t: { name: string }) => t.name === "dc_docs"
    );
    expect(docsTable).toBeDefined();
    const colNames = docsTable.columns.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("body"); // localized → companion
    expect(colNames).toContain("price"); // shared → main

    // Companion file exists, is snapshot-less, and is create-only (no seed/drop).
    const companion = await findCompanionFile(migrationsDir, "docs");
    expect(companion).toBeDefined();
    const companionSql = await readFile(
      resolve(migrationsDir, companion!),
      "utf-8"
    );
    expect(companionSql).toContain(`CREATE TABLE "dc_docs_locales"`);
    expect(companionSql).not.toContain("INSERT INTO");
    expect(companionSql).not.toContain("DROP COLUMN");
    // No paired snapshot for the companion (runs verbatim).
    const companionBase = companion!.replace(/\.sql$/, "");
    expect(snapshotFiles).not.toContain(`${companionBase}.snapshot.json`);
  });

  it("ENABLE transition: companion seeds + drops; main migration does NOT drop the localized col", async () => {
    // Seed a previous snapshot where dc_pages is NOT yet localized: it holds
    // the `body` column on the main table.
    const metaDir = resolve(migrationsDir, "meta");
    const prevPages: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      fields: [
        { name: "body", type: "longText" },
        { name: "price", type: "number" },
      ],
    };
    // Build the prev snapshot via a non-localized generate (writes meta + sql).
    await generateMigration({
      name: "create_pages",
      dialect: "sqlite",
      migrationsDir,
      collections: [prevPages],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date("2026-07-08T12:00:00.000Z"),
    });

    // Now enable localization on `body`.
    const localizedPages: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      localized: true,
      fields: [
        { name: "body", type: "longText", localized: true },
        { name: "price", type: "number" },
      ],
    };
    const result = await generateMigration({
      name: "enable_pages_localization",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [localizedPages],
      singles: [],
      components: [],
      nonInteractive: true,
      now: NOW,
    });
    expect(result).not.toBeNull();

    // Companion file: create + seed (INSERT...SELECT) + drop from main.
    const companion = await findCompanionFile(migrationsDir, "pages");
    expect(companion).toBeDefined();
    const companionSql = await readFile(
      resolve(migrationsDir, companion!),
      "utf-8"
    );
    expect(companionSql).toContain(`CREATE TABLE "dc_pages_locales"`);
    expect(companionSql).toContain("INSERT INTO");
    expect(companionSql).toContain(`SELECT "id", 'en', "body"`);
    expect(companionSql).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "body"`);

    // The MAIN migration (result.sqlPath) must NOT drop the localized column —
    // the companion owns that relocation, so no double-drop.
    const mainSql = await readFile(result!.sqlPath, "utf-8");
    expect(mainSql).not.toContain(`DROP COLUMN "body"`);

    // The new main snapshot omits `body`.
    const snapshotFiles = (await readdir(metaDir))
      .filter(f => f.endsWith(".snapshot.json"))
      .sort();
    const latest = snapshotFiles[snapshotFiles.length - 1];
    const snap = JSON.parse(await readFile(resolve(metaDir, latest), "utf-8"));
    const pagesTable = snap.snapshot.tables.find(
      (t: { name: string }) => t.name === "dc_pages"
    );
    const colNames = pagesTable.columns.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("body");
    expect(colNames).toContain("price");
  });
});
