// The other half of the guarded disable: disabling
// localization archives every non-default translation into `nextly_i18n_archive`, and this
// helper replays them back onto the companion so a mistaken disable is actually recoverable.
// Runs against a real SQLite database so the upsert SQL and the archive round-trip are
// exercised end to end, not mocked.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getI18nArchiveDdl } from "../../../../schemas/nextly-i18n-archive/ddl";
import { restoreI18nArchive } from "../restore-archive";

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

/** Adapter over better-sqlite3 that honors bound parameters (upsertCompanionRow uses them). */
function makeAdapter() {
  return {
    dialect: "sqlite" as const,
    executeQuery: (q: string, params?: unknown[]) => {
      const stmt = sqlite.prepare(q);
      if (/^\s*select/i.test(q)) {
        return Promise.resolve(stmt.all(...((params ?? []) as never[])));
      }
      stmt.run(...((params ?? []) as never[]));
      return Promise.resolve([]);
    },
    getDrizzle: () => db,
  };
}

/** Companion shape the enable migration would have recreated (composite PK drives the upsert). */
function createCompanion() {
  sqlite.exec(`CREATE TABLE "dc_pages_locales" (
    "_parent" TEXT NOT NULL,
    "_locale" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    PRIMARY KEY ("_parent", "_locale")
  )`);
}

function archive(rows: [string, string, string, string, string][]) {
  const stmt = sqlite.prepare(
    `INSERT INTO "nextly_i18n_archive" ("collection","entry_id","locale","field","value") VALUES (?,?,?,?,?)`
  );
  for (const r of rows) stmt.run(...r);
}

function companionRows() {
  return sqlite
    .prepare(`SELECT * FROM "dc_pages_locales" ORDER BY "_locale"`)
    .all() as {
    _parent: string;
    _locale: string;
    title: string | null;
    body: string | null;
  }[];
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle({ client: sqlite });
  for (const stmt of getI18nArchiveDdl("sqlite")) sqlite.exec(stmt);
  createCompanion();
});

afterEach(() => sqlite.close());

describe("restoreI18nArchive", () => {
  it("replays archived translations back onto the companion, one row per (entry, locale)", async () => {
    archive([
      ["pages", "p1", "de", "title", "Hallo"],
      ["pages", "p1", "de", "body", "Text DE"],
      ["pages", "p1", "fr", "title", "Bonjour"],
    ]);

    const result = await restoreI18nArchive({
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
    });

    expect(result.rowsRead).toBe(3);
    // 3 archive rows collapse into 2 companion rows (de has two fields).
    expect(result.rowsRestored).toBe(2);
    expect(result.locales).toEqual(["de", "fr"]);

    const rows = companionRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      _parent: "p1",
      _locale: "de",
      title: "Hallo",
      body: "Text DE",
    });
    expect(rows[1]).toMatchObject({ _locale: "fr", title: "Bonjour" });
  });

  it("restores only the requested language when `locale` is given", async () => {
    archive([
      ["pages", "p1", "de", "title", "Hallo"],
      ["pages", "p1", "fr", "title", "Bonjour"],
    ]);

    const result = await restoreI18nArchive({
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
      locale: "de",
    });

    expect(result.locales).toEqual(["de"]);
    const rows = companionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]._locale).toBe("de");
  });

  it("ignores other collections' archived rows", async () => {
    archive([
      ["pages", "p1", "de", "title", "Hallo"],
      ["posts", "x9", "de", "title", "Anderes"],
    ]);

    const result = await restoreI18nArchive({
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
    });

    expect(result.rowsRead).toBe(1);
    expect(companionRows()).toHaveLength(1);
    expect(companionRows()[0]._parent).toBe("p1");
  });

  it("is idempotent — replaying twice upserts the same rows, not duplicates", async () => {
    archive([["pages", "p1", "de", "title", "Hallo"]]);
    const args = {
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
    };
    await restoreI18nArchive(args);
    await restoreI18nArchive(args);
    expect(companionRows()).toHaveLength(1);
    expect(companionRows()[0].title).toBe("Hallo");
  });

  it("keeps the archive by default, and removes the replayed rows only with `purge`", async () => {
    archive([["pages", "p1", "de", "title", "Hallo"]]);
    const count = () =>
      (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM "nextly_i18n_archive"`)
          .get() as { n: number }
      ).n;

    await restoreI18nArchive({
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
    });
    expect(count()).toBe(1); // audit trail preserved, restore re-runnable

    await restoreI18nArchive({
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
      purge: true,
    });
    expect(count()).toBe(0);
  });

  it("purge deletes only the rows read, leaving archive rows added after the read", async () => {
    archive([["pages", "p1", "de", "title", "Hallo"]]);
    const count = () =>
      (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM "nextly_i18n_archive"`)
          .get() as { n: number }
      ).n;

    // Simulate a concurrent archive write landing between the restore's read and
    // its purge. The read runs through Drizzle; the companion upserts run through
    // executeQuery afterward, so injecting on the first executeQuery call adds a
    // fresh higher-id row for the same collection after the read but before the
    // delete.
    const raceAdapter = makeAdapter();
    const baseExec = raceAdapter.executeQuery;
    let injected = false;
    raceAdapter.executeQuery = (q: string, params?: unknown[]) => {
      if (!injected) {
        injected = true;
        archive([["pages", "p2", "fr", "title", "Bonjour"]]);
      }
      return baseExec(q, params);
    };

    await restoreI18nArchive({
      adapter: raceAdapter,
      collection: "pages",
      companionTableName: "dc_pages_locales",
      purge: true,
    });

    // The row that existed at read time is purged; the concurrently-added row
    // (higher autoincrement id) survives instead of being deleted unrestored.
    expect(count()).toBe(1);
    const survivor = sqlite
      .prepare(`SELECT entry_id FROM "nextly_i18n_archive"`)
      .get() as { entry_id: string };
    expect(survivor.entry_id).toBe("p2");
  });

  it("no-ops cleanly when nothing was archived for the collection", async () => {
    const result = await restoreI18nArchive({
      adapter: makeAdapter(),
      collection: "pages",
      companionTableName: "dc_pages_locales",
    });
    expect(result).toEqual({ rowsRead: 0, rowsRestored: 0, locales: [] });
    expect(companionRows()).toHaveLength(0);
  });
});
