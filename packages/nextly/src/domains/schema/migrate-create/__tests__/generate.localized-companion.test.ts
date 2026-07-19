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

import { generateMigration, type MinimalConfigEntity } from "../generate";
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

  // i18n H5 — the DISABLE transition (spec §5.3 / locked decision #6). Detection hangs on the
  // snapshot's `localized` marker, so these also pin the marker's round-trip.
  describe("DISABLE transition (localized true → false)", () => {
    const localizedPages: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      localized: true,
      fields: [
        { name: "body", type: "longText", localized: true },
        { name: "price", type: "number" },
      ],
    };
    /**
     * The same collection with the MASTER SWITCH flipped off — the realistic disable action
     * (spec §3.2: the entity-level flag is the master switch; per-field flags go inert rather
     * than being hand-removed). The companion's columns are reconstructed from the fields that
     * still classify as translatable, which is what lets the transition be planned offline.
     */
    const plainPages: MinimalConfigEntity = {
      slug: "pages",
      tableName: "dc_pages",
      fields: [
        { name: "body", type: "longText", localized: true },
        { name: "price", type: "number" },
      ],
    };

    /** Generate the "currently localized" state so its snapshot carries the marker. */
    async function seedLocalized() {
      await generateMigration({
        name: "create_pages_localized",
        dialect: "sqlite",
        migrationsDir,
        defaultLocale: "en",
        collections: [localizedPages],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date("2026-07-08T12:00:00.000Z"),
      });
    }

    async function latestSnapshotTable(name: string) {
      const metaDir = resolve(migrationsDir, "meta");
      const files = (await readdir(metaDir))
        .filter(f => f.endsWith(".snapshot.json"))
        .sort();
      const snap = JSON.parse(
        await readFile(resolve(metaDir, files[files.length - 1]), "utf-8")
      );
      return snap.snapshot.tables.find(
        (t: { name: string }) => t.name === name
      );
    }

    it("records the `localized` marker on a localized table, and omits it otherwise", async () => {
      await seedLocalized();
      expect((await latestSnapshotTable("dc_pages")).localized).toBe(true);

      // A non-localized collection must not gain the marker (keeps snapshots churn-free).
      const other = await mkdtemp(join(tmpdir(), "nextly-i18n-marker-"));
      await generateMigration({
        name: "create_plain",
        dialect: "sqlite",
        migrationsDir: other,
        collections: [plainPages],
        singles: [],
        components: [],
        nonInteractive: true,
        now: NOW,
      });
      const meta = resolve(other, "meta");
      const f = (await readdir(meta)).filter(x => x.endsWith(".snapshot.json"));
      const snap = JSON.parse(await readFile(resolve(meta, f[0]), "utf-8"));
      const t = snap.snapshot.tables.find(
        (x: { name: string }) => x.name === "dc_pages"
      );
      expect(t.localized).toBeUndefined();
    });

    it("emits a disable companion: restore default → archive others → drop", async () => {
      await seedLocalized();

      const result = await generateMigration({
        name: "disable_pages_localization",
        dialect: "sqlite",
        migrationsDir,
        defaultLocale: "en",
        collections: [plainPages],
        singles: [],
        components: [],
        nonInteractive: true,
        now: NOW,
      });
      expect(result).not.toBeNull();

      const files = await listSqlFiles(migrationsDir);
      const disableFile = files.find(f =>
        f.includes("disable_localization_pages")
      );
      expect(disableFile).toBeDefined();
      const sql = await readFile(resolve(migrationsDir, disableFile!), "utf-8");

      // The guarded, recoverable order from spec §5.3.
      expect(sql).toContain(`ALTER TABLE "dc_pages" ADD COLUMN "body"`);
      expect(sql).toContain(`UPDATE "dc_pages"`); // restore the default locale
      expect(sql).toContain("nextly_i18n_archive"); // archive the other languages
      expect(sql).toContain(`<> 'en'`); // ...only the non-default ones
      expect(sql).toContain(`DROP TABLE "dc_pages_locales"`);
      // Rollback re-enables.
      expect(sql).toContain("-- DOWN");

      // The main migration must NOT also add `body` — the disable SQL re-adds it itself.
      const mainSql = await readFile(result!.sqlPath, "utf-8");
      expect(mainSql).not.toContain(`ADD COLUMN "body"`);

      // The new snapshot drops the marker and puts `body` back on the main table.
      const pages = await latestSnapshotTable("dc_pages");
      expect(pages.localized).toBeUndefined();
      expect(pages.columns.map((c: { name: string }) => c.name)).toContain(
        "body"
      );
    });

    it("restores a field whose explicit `localized: true` was removed in the same edit", async () => {
      // The snapshot's recorded column list is authoritative, so a field that no longer
      // classifies as translatable (a number never does by default) is still brought home.
      await generateMigration({
        name: "create_localized_number",
        dialect: "sqlite",
        migrationsDir,
        defaultLocale: "en",
        collections: [
          {
            slug: "pages",
            tableName: "dc_pages",
            localized: true,
            fields: [{ name: "views", type: "number", localized: true }],
          },
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date("2026-07-08T12:00:00.000Z"),
      });

      await generateMigration({
        name: "disable_and_unflag",
        dialect: "sqlite",
        migrationsDir,
        defaultLocale: "en",
        // Master switch off AND the field's `localized: true` hand-removed.
        collections: [
          {
            slug: "pages",
            tableName: "dc_pages",
            fields: [{ name: "views", type: "number" }],
          },
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: NOW,
      });

      const files = await listSqlFiles(migrationsDir);
      const disableFile = files.find(f =>
        f.includes("disable_localization_pages")
      );
      expect(disableFile).toBeDefined();
      const sql = await readFile(resolve(migrationsDir, disableFile!), "utf-8");
      expect(sql).toContain(`"views"`); // still restored + archived
      expect(sql).toContain("nextly_i18n_archive");
    });

    it("does not try to restore a translatable field ADDED in the same edit", async () => {
      // `summary` never existed in the companion, so restoring it from there would emit SQL
      // that fails on apply. It must be left to the normal diff instead.
      await seedLocalized();

      const result = await generateMigration({
        name: "disable_and_add",
        dialect: "sqlite",
        migrationsDir,
        defaultLocale: "en",
        collections: [
          {
            ...plainPages,
            fields: [...plainPages.fields, { name: "summary", type: "text" }],
          },
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: NOW,
      });

      const files = await listSqlFiles(migrationsDir);
      const disableFile = files.find(f =>
        f.includes("disable_localization_pages")
      );
      expect(disableFile).toBeDefined();
      const sql = await readFile(resolve(migrationsDir, disableFile!), "utf-8");
      // `body` was in the companion → restored. `summary` was not → never read from it.
      expect(sql).toContain(`"body"`);
      expect(sql).not.toContain(`"summary"`);
      // The new column is added by the ordinary main migration instead.
      const mainSql = await readFile(result!.sqlPath, "utf-8");
      expect(mainSql).toContain(`ADD COLUMN "summary"`);
    });

    it("does NOT fire when fields are added to a never-localized collection", async () => {
      // The shape (main table gains columns) is identical to a disable — only the marker
      // distinguishes them. This is the false-positive the H5 note warned about.
      await generateMigration({
        name: "create_plain",
        dialect: "sqlite",
        migrationsDir,
        collections: [plainPages],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date("2026-07-08T12:00:00.000Z"),
      });

      await generateMigration({
        name: "add_field",
        dialect: "sqlite",
        migrationsDir,
        collections: [
          {
            ...plainPages,
            fields: [...plainPages.fields, { name: "summary", type: "text" }],
          },
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: NOW,
      });

      const files = await listSqlFiles(migrationsDir);
      expect(files.some(f => f.includes("disable_localization"))).toBe(false);
    });
  });
});
