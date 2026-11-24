/**
 * `migrate:check` reports the changes `migrate:create` would write, from what the project commits.
 *
 * - A Schema Builder definition file git ignores is not committed, so a check over it would pass
 *   on the machine that holds it and fail in CI: `migrate:check` refuses it, naming the file, and
 *   `migrate:create` writes from it and warns, naming it. A committed file, or one outside any git
 *   repository, is read as before.
 * - Over a snapshot written before snapshots recorded settings and permissions, both commands say
 *   so: the check passes, and `migrate:create` records them, after which neither says it.
 *
 * The commands are driven themselves over a project directory, the configuration handed to the
 * loader. What would separate a correct run from a broken one: an ignored file read in silence, a
 * committed one refused, a file outside git refused because git cannot be asked; the notice
 * missing from either command, the check failing on it, or the notice given again once recorded.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, number, text } from "../../../config";
import { definePlugin } from "../../../plugins/plugin-context";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import { isNextlyOwnedDocumentColumn } from "../../../lib/system-columns";
import { _resetEnvCache } from "../../../shared/lib/env";

import { pendingProject } from "./helpers/pending-project";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

// `../program` imports every command; the commands under test are handed their context.
vi.mock("../../program", () => ({
  createContext: () => ({ logger: {} }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
const { create, check } = pendingProject(loaded, () => dir);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pending-"));
  vi.stubEnv("CI", "");
  // Neither command connects: the URL names a file never opened, so these cases need nothing of
  // a run without one (`migrate-check-no-database.test.ts`).
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", `file:${join(dir, "unused.db")}`);
  // git looks no further up than the test's own directory, so a temporary folder inside some
  // other repository is still outside one.
  vi.stubEnv("GIT_CEILING_DIRECTORIES", dirname(dir));
  _resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** Every line a run said, as one text. */
const saidBy = (ran: { said: string[] }) => ran.said.join("\n");

/** The migration files in the folder. */
const sqlFiles = () =>
  readdirSync(join(dir, "migrations")).filter(file => file.endsWith(".sql"));

describe("a Schema Builder definition file", () => {
  const builderProject = defineConfig({
    collections: [],
    db: { migrationsDir: "./migrations" },
  });

  /** The definition file holding the Builder collections `slugs`. */
  const define = (...slugs: string[]) =>
    writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        collections: slugs.map(slug => ({
          slug,
          fields: [{ name: "summary", type: "text" }],
        })),
      })
    );

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });

  it("that git ignores is refused by migrate:check and warned about by migrate:create, naming it", async () => {
    git("init", "-q");
    await writeFile(join(dir, ".gitignore"), "ui-schema.json\n");
    await define("cases");

    const created = await create(builderProject);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).toMatch(
      /ui-schema\.json, is ignored by git[\s\S]*Commit \S*ui-schema\.json/
    );
    // Written from the file all the same.
    expect(sqlFiles()).toHaveLength(1);

    const checked = await check(builderProject);
    expect(checked.code).toBe(1);
    expect(saidBy(checked)).toContain("(BUILDER_DEFINITION_IGNORED)");
    expect(saidBy(checked)).toMatch(/`\S*ui-schema\.json`, is ignored by git/);
  });

  it("that git does not ignore is read as before", async () => {
    git("init", "-q");
    await define("cases");

    const created = await create(builderProject);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).not.toContain("ignored by git");
    expect((await check(builderProject)).code).toBeUndefined();

    // Read: an entity added to it is pending.
    await define("cases", "notes");
    const pending = await check(builderProject);
    expect(pending.code).toBe(1);
    expect(saidBy(pending)).toContain("dc_notes");
  });

  it("that git ignores is refused by migrate:check where the checkout does not hold it", async () => {
    git("init", "-q");
    await writeFile(join(dir, ".gitignore"), "ui-schema.json\n");

    // A CI checkout of a project that ignores the file never holds it.
    const checked = await check(builderProject);
    expect(checked.code).toBe(1);
    expect(saidBy(checked)).toContain("(BUILDER_DEFINITION_IGNORED)");
    // migrate:create writes from no such file, so it names none.
    expect(saidBy(await create(builderProject))).not.toContain(
      "ignored by git"
    );
  });

  it("that git ignores is not named by migrate:create --blank, which reads no definition", async () => {
    git("init", "-q");
    await writeFile(join(dir, ".gitignore"), "ui-schema.json\n");
    await define("cases");

    const blank = await create(builderProject, { blank: true });
    expect(blank.code).toBeUndefined();
    expect(saidBy(blank)).not.toContain("ignored by git");
    expect(sqlFiles()).toHaveLength(1);
  });

  it("whose entry a code-first entity shadows is warned about once by migrate:check", async () => {
    const shadowing = defineConfig({
      collections: [
        defineCollection({
          slug: "cases",
          fields: [text({ name: "summary" })],
        }),
      ],
      db: { migrationsDir: "./migrations" },
    });
    await define("cases");
    expect((await create(shadowing)).code).toBeUndefined();

    const checked = await check(shadowing);
    expect(checked.code).toBeUndefined();
    const warnings = checked.said.filter(line =>
      line.includes("that a code-first collection of the same slug shadows")
    );
    expect(warnings).toHaveLength(1);
  });

  it("outside any git repository is read as before", async () => {
    await define("cases");

    const created = await create(builderProject);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).not.toContain("ignored by git");
    expect((await check(builderProject)).code).toBeUndefined();
  });
});

describe("an app with no migration yet whose plugin declares permissions", () => {
  const appWith = (actions: string[]) =>
    defineConfig({
      collections: [],
      plugins: [
        definePlugin({
          name: "@acme/reports",
          version: "1.0.0",
          nextly: ">=0.0.1",
          contributes: {
            permissions: actions.map(action => ({
              action,
              resource: "reports",
            })),
          },
        }),
      ],
      db: { migrationsDir: "./migrations" },
    });

  it("fails migrate:check on the permissions migrate:create writes as the first migration, and passes once written", async () => {
    const checked = await check(appWith(["export"]));
    expect(checked.code).toBe(1);
    expect(saidBy(checked)).toContain("export-reports");
    expect(saidBy(checked)).toContain("1 pending permission change detected.");
    // The check reads no database, so it says nothing of one.
    expect(saidBy(checked)).not.toContain("The database is not reported");

    expect((await create(appWith(["export"]))).code).toBeUndefined();
    expect(sqlFiles()).toHaveLength(1);
    expect((await check(appWith(["export"]))).code).toBeUndefined();
  });
});

describe("one list", () => {
  const site = (edited: boolean) =>
    defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "posts",
          localized: true,
          description: edited ? "Articles" : "Blog posts",
          fields: [
            text({ name: "headline", localized: true }),
            edited
              ? number({ name: "price", localized: true })
              : text({ name: "price", localized: true }),
            ...(edited ? [number({ name: "views" })] : []),
          ],
        }),
      ],
      db: { migrationsDir: "./migrations" },
    });

  /** The lines a failing check lists its changes in. */
  const listed = (ran: { said: string[] }) =>
    [...saidBy(ran).matchAll(/^\s*(?:Why:\s+)?([+~-] .+)$/gm)].map(
      ([, line]) => line
    );

  it("migrate:check and migrate:create report the same list", async () => {
    expect((await create(site(false))).code).toBeUndefined();
    const before = sqlFiles();

    const lines = listed(await check(site(true)));
    const settings = lines.filter(line => line.startsWith("~ settings "));
    const beside = lines.filter(line => line.startsWith("~ translations "));
    const tables = lines.length - settings.length - beside.length;
    // Each kind is in the list, so none of the comparisons below is over nothing.
    expect([tables, settings.length, beside.length]).not.toContain(0);

    const written = await create(site(true), { acceptDataLoss: true });
    expect(written.code, saidBy(written)).toBeUndefined();
    // What `migrate:create` says it wrote, and what its files hold: the operation in the main file,
    // by its column, the settings by name, and a file of its own, on the translations table, for
    // the change that goes beside it.
    expect(lines).toEqual([
      expect.stringMatching(/^\+ add_column dc_posts\.views\b/),
      "~ translations column types dc_posts",
      "~ settings posts: description, fields.price.type, fields.views (added)",
    ]);
    const added = await Promise.all(
      sqlFiles()
        .filter(file => !before.includes(file))
        .map(file => readFile(join(dir, "migrations", file), "utf-8"))
    );
    // Read as `nextly migrate` reads a file: its UP section, statement by statement, so nothing in a
    // header or a DOWN section counts.
    const [besideUp, mainUp] = added
      .map(sql =>
        parseSqlSections(sql)
          .upSql.split(";")
          .map(statement => statement.trim())
          .filter(statement => statement !== "" && !statement.startsWith("--"))
      )
      .sort((a, b) => b.length - a.length);
    expect(mainUp).toEqual([
      'ALTER TABLE "dc_posts" ADD COLUMN "views" integer',
    ]);
    expect(besideUp).toEqual([
      'ALTER TABLE "dc_posts_locales" ADD COLUMN "__retype_price" INTEGER',
      'UPDATE "dc_posts_locales" SET "__retype_price" = CAST("price" AS INTEGER)',
      'ALTER TABLE "dc_posts_locales" DROP COLUMN "price"',
      'ALTER TABLE "dc_posts_locales" RENAME COLUMN "__retype_price" TO "price"',
    ]);
    expect(written.said).toContain(`Operations: ${String(tables)}`);
    expect(written.said.filter(line => line.startsWith("Settings: "))).toEqual(
      settings.map(line => line.replace("~ settings ", "Settings: "))
    );
    expect(added).toHaveLength(1 + beside.length);

    expect((await check(site(true))).code).toBeUndefined();
  });

  it("a description change with no column change is pending", async () => {
    const described = (description: string) =>
      defineConfig({
        collections: [
          defineCollection({
            slug: "posts",
            description,
            fields: [text({ name: "headline" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
    expect((await create(described("Blog posts"))).code).toBeUndefined();

    const checked = await check(described("Articles"));
    expect(checked.code).toBe(1);
    expect(saidBy(checked)).toContain("(SETTINGS_CHANGE_WITHOUT_MIGRATION)");
    expect(listed(checked)).toEqual(["~ posts: description"]);

    expect((await create(described("Articles"))).code).toBeUndefined();
    expect(sqlFiles()).toHaveLength(2);
    expect((await check(described("Articles"))).code).toBeUndefined();
  });
});

describe("a snapshot written before the per-document columns", () => {
  // `nextly migrate` adds them to existing tables itself, so an upgrade never fails the check.
  it.each(["sqlite", "postgresql", "mysql"] as const)(
    "that lacks them leaves nothing pending for migrate:check and migrate:create on %s",
    async dialect => {
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", "");
      _resetEnvCache();
      const config = defineConfig({
        collections: [
          defineCollection({
            slug: "posts",
            fields: [text({ name: "headline" })],
          }),
        ],
        db: { migrationsDir: "./migrations" },
      });
      expect((await create(config)).code).toBeUndefined();

      const meta = join(dir, "migrations", "meta");
      const [name] = readdirSync(meta);
      const file = JSON.parse(await readFile(join(meta, name), "utf-8")) as {
        snapshot: { tables: { columns: { name: string }[] }[] };
      };
      let removed = 0;
      for (const table of file.snapshot.tables) {
        const kept = table.columns.filter(
          column => !isNextlyOwnedDocumentColumn(column.name)
        );
        removed += table.columns.length - kept.length;
        table.columns = kept;
      }
      // The case is about columns the snapshot held: stripping none would prove nothing.
      expect(removed).toBeGreaterThan(0);
      await rm(join(meta, name));
      await writeFile(join(meta, name), JSON.stringify(file));

      const checked = await check(config);
      expect(checked.code, saidBy(checked)).toBeUndefined();
      await create(config);
      expect(sqlFiles()).toHaveLength(1);
    }
  );
});

describe("a snapshot written before snapshots recorded settings", () => {
  const NOTICE = "Settings not yet recorded in a migration";

  const project = defineConfig({
    collections: [
      defineCollection({
        slug: "posts",
        description: "Blog posts",
        fields: [text({ name: "headline" })],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

  it("is named by both commands, passes the check, and is recorded by migrate:create", async () => {
    expect((await create(project)).code).toBeUndefined();
    // The same snapshot as an earlier release wrote it: no record of settings or permissions.
    const meta = join(dir, "migrations", "meta");
    const [name] = readdirSync(meta);
    const file = JSON.parse(await readFile(join(meta, name), "utf-8"));
    delete file.entities;
    delete file.permissions;
    await rm(join(meta, name));
    await writeFile(join(meta, name), JSON.stringify(file));

    const checked = await check(project);
    expect(checked.code).toBeUndefined();
    expect(saidBy(checked)).toContain(NOTICE);

    const created = await create(project);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).toContain(NOTICE);
    expect(sqlFiles()).toHaveLength(2);

    const after = await check(project);
    expect(after.code).toBeUndefined();
    expect(saidBy(after)).not.toContain(NOTICE);
  });
});
