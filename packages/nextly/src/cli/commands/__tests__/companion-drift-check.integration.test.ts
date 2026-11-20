/**
 * `nextly migrate` checks an entity's translations table before it applies the companion files
 * `migrate:create` wrote for it.
 *
 * A translated collection's migration comes as a main file, checked against the database through
 * its snapshot, and companion files for its translations table, which have no snapshot. The main
 * files' snapshots name each table's translated columns, so the real table is compared with the
 * last applied and the newest pending one before any pending file applies: what both name and
 * the database lacks is drift. The commands themselves are driven, on each configured dialect.
 * What would separate a correct run from a broken one:
 *
 * - a translated column or the table dropped by hand, with the companion file applied over it;
 * - the drift found only once the main file, or an earlier companion file, has applied;
 * - a healthy table refused: a deleted field's left-behind column, a run stopped part-way, a
 *   collection removed and added again, a renamed field;
 * - a file the generator wrote still announced as applied "without drift checks";
 * - a file written by hand, which has nothing to be checked against, no longer said to be so.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { parseLocalizationIntent } from "../../../domains/i18n/migration/migration-intent";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { checkCompanionFiles } from "../../../domains/schema/migrate/companion-drift";
import { parseSnapshotFile } from "../../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import { createLogger } from "../../utils/logger";
import { findPendingFiles, runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

import { throwawayDatabase } from "./helpers/sync-target";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "cdcposts";
const COMPANION = `dc_${SLUG}_locales`;

/** The collection, with each of `translated` a translated text field. */
const configWith = (translated: readonly string[]) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: translated.map(name => ({
          name,
          type: "text" as const,
          localized: true,
        })),
      }),
    ],
  });

/** No collection at all: the translated one removed. */
const configWithout = () =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [],
  });

/**
 * A whole-number field `views`, translated or not, beside each of `translated`. Turning its
 * translation on moves it into the translations table with a file that may carry the main
 * column's type.
 */
const configWithViews = (
  viewsTranslated: boolean,
  translated: readonly string[]
) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          {
            name: "views",
            type: "number" as const,
            localized: viewsTranslated,
          },
          ...translated.map(name => ({
            name,
            type: "text" as const,
            localized: true,
          })),
        ],
      }),
    ],
  });

/** Two text fields, `kept` and `moved`, each translated or not. */
const configMoving = (keptTranslated: boolean, movedTranslated: boolean) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text" as const, localized: true },
          { name: "kept", type: "text" as const, localized: keptTranslated },
          { name: "moved", type: "text" as const, localized: movedTranslated },
        ],
      }),
    ],
  });

describeEachDialect(
  "nextly migrate checks a translations table before its companion files apply",
  dialect => {
    let dir: string;
    let instance: TestNextly | undefined;
    let drop: () => Promise<void> = async () => {};
    let previousDialect: string | undefined;
    let previousUrl: string | undefined;
    let clock = 0;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-companion-drift-"));
      mkdirSync(join(dir, "migrations"));
      previousDialect = process.env.DB_DIALECT;
      previousUrl = process.env.DATABASE_URL;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 12, 0, 0, 0)));
      // A database of the case's own: the commands reconcile the whole database against the config.
      const own =
        dialect === "sqlite"
          ? { url: `file:${join(dir, "test.db")}`, drop: async () => {} }
          : await throwawayDatabase(dialect);
      drop = own.drop;
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL = own.url;
      _resetEnvCache();
      const adapter = await createAdapter({
        type: dialect,
        url: own.url,
      } as Parameters<typeof createAdapter>[0]);
      instance = await createTestNextly({ adapter });
    });

    afterEach(async () => {
      vi.useRealTimers();
      await instance?.destroy();
      instance = undefined;
      await drop();
      if (previousDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previousDialect;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      _resetEnvCache();
      rmSync(dir, { recursive: true, force: true });
    });

    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
      };
      return {
        context: {
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: dir,
        } as CommandContext,
        said,
      };
    }

    async function exiting(
      fn: () => Promise<void>
    ): Promise<number | undefined> {
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await fn();
        return undefined;
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return Number(match[1]);
        throw error;
      } finally {
        exit.mockRestore();
      }
    }

    async function migrateCreate(
      config: unknown,
      name: string,
      options: { acceptRenames?: boolean; acceptDataLoss?: true } = {}
    ): Promise<void> {
      loaded.config = config;
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 12, 0, 0, clock)));
      const { context, said } = command();
      // As `--non-interactive` does: no rename is asked about.
      setNonInteractive(true);
      // A refusal goes to standard error in the CLI's error shape; it is kept for the failure.
      const stderr = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: dir, ...options }, context)
      ).finally(() => {
        setNonInteractive(false);
        stderr.mockRestore();
      });
      expect(code, said.join("\n")).toBeUndefined();
    }

    async function migrate(
      config: unknown,
      options: { acceptDataLoss?: true; dryRun?: true } = {}
    ) {
      loaded.config = config;
      const { context, said } = command();
      // A refusal ends in the CLI's error shape, which goes to standard error through
      // `console.error`, not through the logger.
      const stderr = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      try {
        const code = await exiting(() =>
          runMigrate({ cwd: dir, ...options }, context)
        );
        return { code, said: said.join("\n") };
      } finally {
        stderr.mockRestore();
      }
    }

    function adapter(): DrizzleAdapter {
      if (!instance) throw new Error("no instance");
      return instance.adapter as unknown as DrizzleAdapter;
    }

    /** The translations table's column names, or none where it is not there. */
    async function companionColumns(): Promise<string[]> {
      const snapshot = await introspectLiveSnapshot(
        adapter().getDrizzle(),
        dialect as TestDialect,
        [COMPANION]
      );
      return (
        snapshot.tables
          .find(table => table.name === COMPANION)
          ?.columns.map(column => column.name) ?? []
      );
    }

    /** The migration files the ledger does not hold yet. */
    async function pendingFiles() {
      return findPendingFiles(
        adapter() as unknown as CLIDatabaseAdapter,
        adapter().getDrizzle(),
        dialect,
        join(dir, "migrations"),
        createLogger({ quiet: true })
      );
    }

    const MISSING_SNAPSHOT = /No snapshot for|without drift checks/;

    it("a hand change to the companion table is reported as drift for the companion file before anything applies", async () => {
      await migrateCreate(configWith(["title"]), "posts");
      expect((await migrate(configWith(["title"]))).code).toBeUndefined();
      // The fixture's controls: the table holds the translated column, and a
      // second translated field is captured in files not yet applied.
      expect(await companionColumns()).toContain("title");
      await migrateCreate(configWith(["title", "summary"]), "summary");
      const pending = (await pendingFiles()).map(file => file.name);
      const companionFile = pending.find(name => name.includes("localization"));
      expect(companionFile, pending.join(", ")).toBeDefined();

      // Changed by hand, outside any migration.
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")}`
      );

      const run = await migrate(configWith(["title", "summary"]));

      // The exit a main file's drift ends with.
      expect(run.code, run.said).toBe(1);
      expect(run.said).toContain("(MIGRATION_DRIFT)");
      expect(run.said).toContain(String(companionFile).replace(/\.sql$/, ""));
      expect(run.said).toContain(COMPANION);
      expect(run.said).toMatch(/- .*title/);
      // Nothing applied: every file is still pending, and the new column is not there.
      expect((await pendingFiles()).map(file => file.name)).toEqual(pending);
      expect(await companionColumns()).not.toContain("summary");
    }, 240_000);

    /** One translated field applied, a second captured in files not yet applied. */
    async function secondFieldPending(): Promise<string[]> {
      await migrateCreate(configWith(["title"]), "posts");
      expect((await migrate(configWith(["title"]))).code).toBeUndefined();
      await migrateCreate(configWith(["title", "summary"]), "summary");
      return (await pendingFiles()).map(file => file.name);
    }

    it("a column no snapshot names is not drift, as a deleted field's column cannot be told from it", async () => {
      await secondFieldPending();
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("by_hand")} TEXT`
      );

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBeUndefined();
      expect(await pendingFiles()).toEqual([]);
      expect(await companionColumns()).toContain("summary");
    }, 240_000);

    it("a companion table dropped by hand is drift", async () => {
      const pending = await secondFieldPending();
      await adapter().executeQuery(`DROP TABLE ${q(COMPANION)}`);

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBe(1);
      expect(run.said).toMatch(new RegExp(`- table ${COMPANION}`));
      expect((await pendingFiles()).map(file => file.name)).toEqual(pending);
    }, 240_000);

    it("a table whose columns no applied file records is applied, saying why it was not checked", async () => {
      const pending = await secondFieldPending();
      const companionFile = pending.find(name => name.includes("localization"));
      // The applied snapshots as a release before the record wrote them: the table translated,
      // its translated columns not named.
      const meta = join(dir, "migrations", "meta");
      const applied = readdirSync(meta).filter(
        name => !pending.includes(name.replace(/\.snapshot\.json$/, ""))
      );
      let stripped = 0;
      for (const name of applied) {
        const file = JSON.parse(readFileSync(join(meta, name), "utf-8")) as {
          snapshot: { tables: { localizedColumns?: string[] }[] };
        };
        for (const table of file.snapshot.tables) {
          if (table.localizedColumns !== undefined) stripped += 1;
          delete table.localizedColumns;
        }
        writeFileSync(join(meta, name), JSON.stringify(file, null, 2));
      }
      expect(stripped).toBeGreaterThan(0);

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).toContain(
        `${String(companionFile)}.sql is applied without a drift check: the migration files do not record the columns of the translations table ${COMPANION}.`
      );
      expect(run.said).not.toMatch(MISSING_SNAPSHOT);
      expect(await companionColumns()).toContain("summary");
    }, 240_000);

    it("a translated field renamed by an applied file is not drift", async () => {
      const pending = await secondFieldPending();
      // The database and the record as an applied rename of `title` to `headline` leaves them:
      // the column renamed, the last applied snapshot naming it `headline`, and the companion
      // files' headers, which record no rename, still naming `title`.
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} RENAME COLUMN ${q("title")} TO ${q("headline")}`
      );
      const folder = join(dir, "migrations");
      const files = readdirSync(folder)
        .filter(name => name.endsWith(".sql"))
        .sort()
        .map(name => {
          const filePath = join(folder, name);
          return {
            name: name.replace(/\.sql$/, ""),
            filePath,
            localization:
              parseLocalizationIntent(readFileSync(filePath, "utf-8"), name) ??
              undefined,
          };
        });
      const applied = files.filter(file => !pending.includes(file.name));
      const snapshotOf = (name: string) => {
        const path = join(folder, "meta", `${name}.snapshot.json`);
        if (!existsSync(path)) return Promise.resolve(null);
        const file = parseSnapshotFile(readFileSync(path, "utf-8"), path);
        for (const table of file.snapshot.tables) {
          if (table.localizedColumns !== undefined) {
            table.localizedColumns = table.localizedColumns.map(column =>
              column === "title" ? "headline" : column
            );
          }
        }
        return Promise.resolve(file);
      };
      // The fixture's control: an applied snapshot does record the translated column.
      const recorded = await Promise.all(
        applied.map(file => snapshotOf(file.name))
      );
      expect(
        recorded.flatMap(file =>
          (file?.snapshot.tables ?? []).flatMap(t => t.localizedColumns ?? [])
        )
      ).toContain("headline");

      const check = await checkCompanionFiles({
        db: adapter().getDrizzle(),
        dialect: dialect as TestDialect,
        applied,
        pending: files.filter(file => pending.includes(file.name)),
        runs: new Set(pending),
        snapshotOf,
      });

      const companionFile = pending.find(name => name.includes("localization"));
      expect([...check.checked]).toEqual([companionFile]);
      expect([...check.unchecked.keys()]).toEqual([]);
    }, 240_000);

    it("a translated collection removed and added again is not drift", async () => {
      await migrateCreate(configWith(["title"]), "posts");
      expect((await migrate(configWith(["title"]))).code).toBeUndefined();
      await migrateCreate(configWithout(), "remove", { acceptDataLoss: true });
      const removed = await migrate(configWithout(), { acceptDataLoss: true });
      expect(removed.code, removed.said).toBeUndefined();
      // The control: the translations table went with its collection.
      expect(await companionColumns()).toEqual([]);

      await migrateCreate(configWith(["title"]), "again");
      const run = await migrate(configWith(["title"]));

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).not.toMatch(MISSING_SNAPSHOT);
      expect(await companionColumns()).toContain("title");
    }, 240_000);

    /** `column` of the translations table given `type`, by hand. */
    async function retype(column: string, type: string): Promise<void> {
      await adapter().executeQuery(
        dialect === "mysql"
          ? `ALTER TABLE ${q(COMPANION)} MODIFY COLUMN ${q(column)} ${type}`
          : `ALTER TABLE ${q(COMPANION)} ALTER COLUMN ${q(column)} TYPE ${type}`
      );
    }

    // SQLite cannot change a column's type in place, and enforces none.
    it.skipIf(dialect === "sqlite")(
      "a column a file moved into translation, standing wider than its field, is not drift",
      async () => {
        await migrateCreate(configWithViews(false, ["title"]), "posts");
        expect(
          (await migrate(configWithViews(false, ["title"]))).code
        ).toBeUndefined();
        await migrateCreate(configWithViews(true, ["title"]), "views", {
          acceptDataLoss: true,
        });
        const joined = await migrate(configWithViews(true, ["title"]), {
          acceptDataLoss: true,
        });
        expect(joined.code, joined.said).toBeUndefined();
        expect(await companionColumns()).toContain("views");
        // As a file that carried a wider main column leaves it: the header records the
        // field's own type, and the column stands wider.
        await retype("views", "BIGINT");

        await migrateCreate(
          configWithViews(true, ["title", "summary"]),
          "summary"
        );
        const run = await migrate(configWithViews(true, ["title", "summary"]));

        expect(run.code, run.said).toBeUndefined();
        expect(await companionColumns()).toContain("summary");
      },
      240_000
    );

    it.skipIf(dialect === "sqlite")(
      "a column's type is not judged, which no file records as the column has it",
      async () => {
        await secondFieldPending();
        await retype("title", "VARCHAR(10)");

        const run = await migrate(configWith(["title", "summary"]));

        expect(run.code, run.said).toBeUndefined();
        expect(await pendingFiles()).toEqual([]);
      },
      240_000
    );

    it("a column left by a translated field deleted from the config is not drift", async () => {
      await migrateCreate(configWith(["title", "summary"]), "posts");
      expect(
        (await migrate(configWith(["title", "summary"]))).code
      ).toBeUndefined();
      await migrateCreate(configWith(["title"]), "fewer", {
        acceptDataLoss: true,
      });
      const fewer = await migrate(configWith(["title"]), {
        acceptDataLoss: true,
      });
      expect(fewer.code, fewer.said).toBeUndefined();
      // The fixture's control: the deleted field's column is still there.
      expect(await companionColumns()).toContain("summary");

      await migrateCreate(configWith(["title", "subtitle"]), "subtitle");
      const run = await migrate(configWith(["title", "subtitle"]));

      expect(run.code, run.said).toBeUndefined();
      expect(await companionColumns()).toContain("subtitle");
    }, 240_000);

    it("a run stopped between a companion file and its main file goes on where it stopped", async () => {
      // `kept` leaves translation and `moved` joins it in one change: a file moves `moved`
      // into the translations table before the main file, and one drops `kept` from it after.
      await migrateCreate(configMoving(true, false), "posts");
      expect((await migrate(configMoving(true, false))).code).toBeUndefined();
      await migrateCreate(configMoving(false, true), "swap", {
        acceptDataLoss: true,
      });
      const all = (await pendingFiles()).map(file => file.name);
      // Stopped at the main file, which refuses a main table changed by hand, once the file
      // before it has moved `moved` into the translations table.
      const main = `dc_${SLUG}`;
      await adapter().executeQuery(
        `ALTER TABLE ${q(main)} ADD COLUMN ${q("by_hand")} TEXT`
      );
      const stopped = await migrate(configMoving(false, true), {
        acceptDataLoss: true,
      });
      expect(stopped.code, stopped.said).toBe(1);
      await adapter().executeQuery(
        `ALTER TABLE ${q(main)} DROP COLUMN ${q("by_hand")}`
      );
      const left = (await pendingFiles()).map(file => file.name);
      // The fixture's controls: the column is there, and files of the entity remain.
      expect(await companionColumns()).toContain("moved");
      expect(left.length, all.join(", ")).toBeGreaterThan(0);
      expect(left.length).toBeLessThan(all.length);

      const run = await migrate(configMoving(false, true), {
        acceptDataLoss: true,
      });

      expect(run.code, run.said).toBeUndefined();
      expect(await pendingFiles()).toEqual([]);
      expect(await companionColumns()).not.toContain("kept");
    }, 240_000);

    it("a hand-written file not yet applied may be the table's repair, so no drift is asserted", async () => {
      const pending = await secondFieldPending();
      const companionFile = pending.find(name => name.includes("localization"));
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")}`
      );
      // The operator's repair, written as a migration, which runs after the companion file.
      writeFileSync(
        join(dir, "migrations", "20261029_130000_000_put_title_back.sql"),
        `-- UP\nALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("title")} TEXT;\n\n-- DOWN\nALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")};\n`
      );

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).toContain(
        `${String(companionFile)}.sql is applied without a drift check: 20261029_130000_000_put_title_back.sql, a migration written by hand, may change the translations table ${COMPANION}.`
      );
      expect(await companionColumns()).toEqual(
        expect.arrayContaining(["title", "summary"])
      );
    }, 240_000);

    it("a pending hand-written file about another table does not excuse the drift", async () => {
      const pending = await secondFieldPending();
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")}`
      );
      writeFileSync(
        join(dir, "migrations", "20261029_130000_000_by_hand.sql"),
        `-- UP\nCREATE TABLE ${q("cdc_by_hand")} (${q("id")} INTEGER PRIMARY KEY);\n\n-- DOWN\nDROP TABLE ${q("cdc_by_hand")};\n`
      );

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBe(1);
      expect(run.said).toMatch(/- .*title/);
      expect((await pendingFiles()).map(file => file.name)).toEqual([
        ...pending,
        "20261029_130000_000_by_hand",
      ]);
    }, 240_000);

    it("a hand-written file that only mentions the table, without changing it, does not excuse the drift", async () => {
      const pending = await secondFieldPending();
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")}`
      );
      // The table's name in a comment, in a string, in the DOWN part and inside a longer
      // name: none of them a statement that changes the table when the file applies.
      const backup = `${COMPANION}_backup`;
      writeFileSync(
        join(dir, "migrations", "20261029_130000_000_by_hand.sql"),
        `-- UP\n-- keeps a copy of ${COMPANION}\nCREATE TABLE ${q(backup)} (${q("id")} INTEGER PRIMARY KEY, ${q("note")} TEXT DEFAULT '${COMPANION}');\n\n-- DOWN\nDROP TABLE ${q(backup)};\nALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("title")} TEXT;\n`
      );

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBe(1);
      expect(run.said).toMatch(/- .*title/);
      expect((await pendingFiles()).map(file => file.name)).toEqual([
        ...pending,
        "20261029_130000_000_by_hand",
      ]);
    }, 240_000);

    it("a key column of the translations table gone by hand is drift", async () => {
      const pending = await secondFieldPending();
      // Renamed away, which every dialect allows of a column its key is made of.
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} RENAME COLUMN ${q("_locale")} TO ${q("_locale_was")}`
      );
      expect(await companionColumns()).not.toContain("_locale");

      const run = await migrate(configWith(["title", "summary"]));

      expect(run.code, run.said).toBe(1);
      expect(run.said).toContain(`- column ${COMPANION}._locale`);
      expect((await pendingFiles()).map(file => file.name)).toEqual(pending);
    }, 240_000);

    it("a dry run names the companion file a real run would refuse", async () => {
      const pending = await secondFieldPending();
      const companionFile = pending.find(name => name.includes("localization"));
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")}`
      );

      const run = await migrate(configWith(["title", "summary"]), {
        dryRun: true,
      });

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).toContain(
        `a real run would refuse ${String(companionFile)}.sql`
      );
      expect(run.said).toContain(`- column ${COMPANION}.title`);
      // Nothing applied, as a dry run applies nothing.
      expect((await pendingFiles()).map(file => file.name)).toEqual(pending);
    }, 240_000);

    it("a dry run over a table that matches names no refusal", async () => {
      await secondFieldPending();

      const run = await migrate(configWith(["title", "summary"]), {
        dryRun: true,
      });

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).not.toContain("a real run would refuse");
    }, 240_000);

    /** The migration files as the run lists them, each with its header's intent. */
    function filesInRunOrder() {
      const folder = join(dir, "migrations");
      return readdirSync(folder)
        .filter(name => name.endsWith(".sql"))
        .sort()
        .map(name => {
          const filePath = join(folder, name);
          return {
            name: name.replace(/\.sql$/, ""),
            filePath,
            localization:
              parseLocalizationIntent(readFileSync(filePath, "utf-8"), name) ??
              undefined,
          };
        });
    }

    /** A migration's own snapshot, as the run loads it. */
    function ownSnapshot(name: string) {
      const path = join(dir, "migrations", "meta", `${name}.snapshot.json`);
      return Promise.resolve(
        existsSync(path)
          ? parseSnapshotFile(readFileSync(path, "utf-8"), path)
          : null
      );
    }

    it("a pending file that renames a column leaves its table unjudged, saying why", async () => {
      const pending = await secondFieldPending();
      const companionFile = pending.find(name => name.includes("localization"));
      // What would be drift, were the table judged.
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} DROP COLUMN ${q("title")}`
      );
      const files = filesInRunOrder();

      const check = await checkCompanionFiles({
        db: adapter().getDrizzle(),
        dialect: dialect as TestDialect,
        applied: files.filter(file => !pending.includes(file.name)),
        // The companion file as one that also renames a column: its header names none it renames.
        pending: files
          .filter(file => pending.includes(file.name))
          .map(file =>
            file.name === companionFile
              ? {
                  ...file,
                  upSql: `ALTER TABLE ${q(COMPANION)} RENAME COLUMN ${q("title")} TO ${q("headline")}`,
                }
              : file
          ),
        runs: new Set(pending),
        snapshotOf: ownSnapshot,
      });

      expect([...check.checked]).toEqual([]);
      expect(check.unchecked.get(String(companionFile))).toContain(
        `renames a column of the translations table ${COMPANION}`
      );
    }, 240_000);

    it("a table no applied file records as translated is applied, saying why it was not checked", async () => {
      const pending = await secondFieldPending();
      const companionFile = pending.find(name => name.includes("localization"));
      const files = filesInRunOrder();

      const check = await checkCompanionFiles({
        db: adapter().getDrizzle(),
        dialect: dialect as TestDialect,
        applied: files.filter(file => !pending.includes(file.name)),
        pending: files.filter(file => pending.includes(file.name)),
        runs: new Set(pending),
        // The applied snapshots as a project whose table a development sync made has them:
        // the collection not translated yet.
        snapshotOf: async name => {
          const file = await ownSnapshot(name);
          if (file === null || pending.includes(name)) return file;
          for (const table of file.snapshot.tables) {
            delete table.localized;
            delete table.localizedColumns;
          }
          return file;
        },
      });

      expect(check.unchecked.get(String(companionFile))).toBe(
        `the translations table ${COMPANION} is already there, and no applied migration file records it`
      );
    }, 240_000);

    it("applying a localized collection's generated files prints no missing-snapshot warning", async () => {
      await migrateCreate(configWith(["title"]), "posts");
      const first = await migrate(configWith(["title"]));
      expect(first.code, first.said).toBeUndefined();
      expect(first.said).not.toMatch(MISSING_SNAPSHOT);

      await migrateCreate(configWith(["title", "summary"]), "summary");
      const second = await migrate(configWith(["title", "summary"]));
      expect(second.code, second.said).toBeUndefined();
      expect(second.said).not.toMatch(MISSING_SNAPSHOT);
      // The control: the companion files did apply.
      expect(await companionColumns()).toEqual(
        expect.arrayContaining(["title", "summary"])
      );
      expect(await pendingFiles()).toEqual([]);
    }, 240_000);

    it("still says so of a file written by hand, which has nothing to be checked against", async () => {
      await migrateCreate(configWith(["title"]), "posts");
      expect((await migrate(configWith(["title"]))).code).toBeUndefined();
      writeFileSync(
        join(dir, "migrations", "20261029_130000_000_by_hand.sql"),
        `-- UP\nCREATE TABLE ${q("cdc_by_hand")} (${q("id")} INTEGER PRIMARY KEY);\n\n-- DOWN\nDROP TABLE ${q("cdc_by_hand")};\n`
      );

      const run = await migrate(configWith(["title"]));

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).toMatch(
        /No snapshot for 20261029_130000_000_by_hand\.sql; applying verbatim without drift checks/
      );
    }, 240_000);
  }
);
