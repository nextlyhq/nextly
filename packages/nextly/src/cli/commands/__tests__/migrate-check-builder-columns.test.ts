/**
 * `migrate:check` reports no drift right after `migrate:create`, for a project whose only entities
 * the Schema Builder made, on every dialect.
 *
 * A Builder collection's text field that states no width is unbounded on MySQL (the Builder's own
 * column rule) and 255 characters on a code-first table. `migrate:create` describes the Builder
 * table by the Builder's rule; a `migrate:check` that described it by the code-first rule reported
 * a type change on a column nobody touched, on MySQL only, where the two rules differ.
 *
 * The same holds for a Builder Single and field group: `migrate:create` describes each by the rule
 * of the Builder creator that builds it at runtime, as `nextly migrate` and the runtime do, so the
 * column it writes is the column the Builder would have made.
 *
 * The commands are driven themselves over a project directory, the config handed to the loader;
 * neither connects, so each needs only the dialect.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../../config";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
// `../program` imports every command, `migrate` with its whole graph among
// them; the commands under test need only its context factory, and are handed
// their context here anyway.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const URLS = {
  sqlite: (dir: string) => `file:${join(dir, "unused.db")}`,
  postgresql: () => "postgres://unused:unused@localhost:1/unused",
  mysql: () => "mysql://unused:unused@localhost:1/unused",
} as const;

/** A collection, a single and a field group, each with a text field that states no width. */
const MANIFEST = {
  collections: [{ slug: "cases", fields: [{ name: "summary", type: "text" }] }],
  singles: [{ slug: "about", fields: [{ name: "summary", type: "text" }] }],
  components: [{ slug: "teaser", fields: [{ name: "summary", type: "text" }] }],
};

const project = defineConfig({
  collections: [],
  db: { migrationsDir: "./migrations" },
});

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-check-builder-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(() => {
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** Run a command over the project; its exit code, if any, and what it said. */
async function run(
  command: (context: CommandContext) => Promise<void>,
  config: unknown = project
): Promise<{ code: number | undefined; said: string[] }> {
  loaded.config = config;
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      error: capture,
      info: capture,
      success: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  // The error a command ends with is printed on standard error, in the error shape.
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await command(context);
    return { code: undefined, said };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said };
    throw error;
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "migrate:check after migrate:create of Builder entities on %s",
  dialect => {
    /** `migrate:create` over the Builder-only project; the migration it wrote. */
    async function create(): Promise<string> {
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL = URLS[dialect](dir);
      _resetEnvCache();
      await writeFile(join(dir, "ui-schema.json"), JSON.stringify(MANIFEST));
      const created = await run(context => {
        // As `--non-interactive` does: no rename is asked about.
        setNonInteractive(true);
        return runMigrateCreate("builder", { cwd: dir }, context).finally(() =>
          setNonInteractive(false)
        );
      });
      expect(created.code).toBeUndefined();
      const migrations = join(dir, "migrations");
      const [file] = readdirSync(migrations).filter(name =>
        name.endsWith(".sql")
      );
      return readFile(join(migrations, file), "utf-8");
    }

    it("writes each table's unstated text width as its Builder creator builds it", async () => {
      const { upSql } = parseSqlSections(await create());
      // Each of the three tables has its `summary` column, and none is bounded: every Builder
      // creator builds a text field that states no width unbounded. Read from the column lines of
      // each CREATE TABLE, not the registry rows, whose field lists name `summary` too.
      const summaries = upSql
        .split("\n")
        .filter(line => /^\s+["`]summary["`] /.test(line));
      expect(summaries).toHaveLength(3);
      for (const line of summaries) expect(line).not.toMatch(/varchar/i);
    });

    it("reports no drift", async () => {
      await create();

      const checked = await run(context =>
        runMigrateCheck({ cwd: dir }, context)
      );
      expect(checked.said.join("\n")).not.toContain("change_column_type");
      expect(checked.code).toBeUndefined();
    });
  }
);

/** The three Builder tables, each with one text field that states no width. */
const TABLES = ["dc_cases", "single_about", "comp_teaser"] as const;

/** A collection, a Single and a field group, each with `field` added to it. */
function manifestWith(field: Record<string, unknown>) {
  return {
    collections: [{ slug: "cases", fields: [field] }],
    singles: [{ slug: "about", fields: [field] }],
    components: [{ slug: "teaser", fields: [field] }],
  };
}

/** The migration files in the project, oldest first. */
function sqlFiles(): string[] {
  return readdirSync(join(dir, "migrations"))
    .filter(name => name.endsWith(".sql"))
    .sort();
}

/**
 * The newest snapshot with `column` of each Builder table stated as `type`: the record an
 * earlier `migrate:create` left, which described these tables by the code-first rule.
 */
async function recordedAs(column: string, type: string): Promise<void> {
  const meta = join(dir, "migrations", "meta");
  const [newest] = readdirSync(meta)
    .filter(name => name.endsWith(".json"))
    .sort()
    .reverse();
  const file = JSON.parse(await readFile(join(meta, newest), "utf-8")) as {
    snapshot: {
      tables: { name: string; columns: { name: string; type: string }[] }[];
    };
  };
  for (const table of file.snapshot.tables) {
    if (!(TABLES as readonly string[]).includes(table.name)) continue;
    for (const spec of table.columns)
      if (spec.name === column) spec.type = type;
  }
  await writeFile(join(meta, newest), JSON.stringify(file));
}

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "a keyed Builder text field on %s",
  dialect => {
    /** `migrate:create` over a Builder-only project of `manifest`. */
    async function create(manifest: unknown) {
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL = URLS[dialect](dir);
      _resetEnvCache();
      await writeFile(join(dir, "ui-schema.json"), JSON.stringify(manifest));
      return run(context => {
        setNonInteractive(true);
        return runMigrateCreate("keyed", { cwd: dir }, context).finally(() =>
          setNonInteractive(false)
        );
      });
    }
    const check = () => run(context => runMigrateCheck({ cwd: dir }, context));

    it("keeps a unique one bounded where MySQL can key it, with no drift", async () => {
      const manifest = manifestWith({
        name: "code",
        type: "text",
        unique: true,
      });
      expect((await create(manifest)).code).toBeUndefined();

      // A unique key on MySQL needs a bounded column, so every Builder table's `code` is the
      // bounded default there, as an earlier migrate:create wrote it; the others keep text.
      const { upSql } = parseSqlSections(
        await readFile(join(dir, "migrations", sqlFiles()[0]), "utf-8")
      );
      const codes = upSql
        .split("\n")
        .filter(line => /^\s+["`]code["`] /.test(line));
      expect(codes).toHaveLength(3);
      for (const line of codes) {
        if (dialect === "mysql") expect(line).toMatch(/varchar\(255\)/);
        else expect(line).not.toMatch(/varchar/i);
      }
      const checked = await check();
      expect(checked.said.join("\n")).not.toContain("change_column_type");
      expect(checked.code).toBeUndefined();
    });

    it("writes nothing for an indexed one already stored as text", async () => {
      const manifest = manifestWith({ name: "tag", type: "text", index: true });
      expect((await create(manifest)).code).toBeUndefined();

      const again = await create(manifest);

      // Nothing to write ends the command with success.
      expect(again.code ?? 0).toBe(0);
      expect(sqlFiles()).toHaveLength(1);
    });

    it.runIf(dialect === "mysql")(
      "refuses to widen an indexed one an earlier file made varchar(255), writing nothing",
      async () => {
        const manifest = manifestWith({
          name: "tag",
          type: "text",
          index: true,
        });
        expect((await create(manifest)).code).toBeUndefined();
        await recordedAs("tag", "varchar(255)");

        const refused = await create(manifest);

        expect(refused.code).toBe(1);
        const said = refused.said.join("\n");
        for (const table of TABLES) expect(said).toContain(`${table}.tag`);
        expect(said).toContain("maxLength");
        expect(sqlFiles()).toHaveLength(1);
      }
    );

    it.runIf(dialect === "mysql")(
      "widens one whose unique key the same run drops, dropping the key first",
      async () => {
        const unique = manifestWith({
          name: "code",
          type: "text",
          unique: true,
        });
        expect((await create(unique)).code).toBeUndefined();

        // Unique turned off: the key goes, and the column widens to what the field states.
        const plain = manifestWith({ name: "code", type: "text" });
        const widened = await create(plain);

        expect(widened.code, widened.said.join("\n")).toBeUndefined();
        const files = sqlFiles();
        expect(files).toHaveLength(2);
        const { upSql } = parseSqlSections(
          await readFile(join(dir, "migrations", files[1]), "utf-8")
        );
        for (const table of TABLES) {
          const dropped = upSql.search(
            new RegExp(`DROP INDEX \`uq_${table}_code\``, "i")
          );
          const modified = upSql.search(
            new RegExp(
              `ALTER TABLE \`${table}\` MODIFY COLUMN \`code\` text`,
              "i"
            )
          );
          expect({
            table,
            dropped: dropped >= 0,
            modified: modified >= 0,
          }).toEqual({
            table,
            dropped: true,
            modified: true,
          });
          // MySQL refuses the MODIFY while the key stands, so the key goes first.
          expect(dropped).toBeLessThan(modified);
        }
      }
    );

    it.runIf(dialect === "mysql")(
      "still widens one no index keys",
      async () => {
        const manifest = manifestWith({ name: "summary", type: "text" });
        expect((await create(manifest)).code).toBeUndefined();
        await recordedAs("summary", "varchar(255)");

        expect((await create(manifest)).code).toBeUndefined();

        const files = sqlFiles();
        expect(files).toHaveLength(2);
        const { upSql } = parseSqlSections(
          await readFile(join(dir, "migrations", files[1]), "utf-8")
        );
        for (const table of TABLES) {
          expect(upSql).toMatch(
            new RegExp(
              `ALTER TABLE \`${table}\` MODIFY COLUMN \`summary\` text`,
              "i"
            )
          );
        }
      }
    );
  }
);

/** The project with app localization configured, which a translated Builder collection needs. */
const translatedProject = defineConfig({
  collections: [],
  localization: { locales: ["en", "es"], defaultLocale: "en" },
  db: { migrationsDir: "./migrations" },
});

describe("turning translation off for a Builder collection on MySQL", () => {
  const manifest = (localized: boolean) => ({
    collections: [
      {
        slug: "cases",
        localized,
        fields: [{ name: "code", type: "text", unique: true }],
      },
    ],
  });

  async function create(localized: boolean) {
    process.env.DB_DIALECT = "mysql";
    process.env.DATABASE_URL = URLS.mysql();
    _resetEnvCache();
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify(manifest(localized))
    );
    return run(context => {
      setNonInteractive(true);
      return runMigrateCreate("translation", { cwd: dir }, context).finally(
        () => setNonInteractive(false)
      );
    }, translatedProject);
  }

  it("refuses for a translated unique field that states no width, writing nothing", async () => {
    expect((await create(true)).code).toBeUndefined();
    const before = sqlFiles();

    const refused = await create(false);

    // Translated, `code` is TEXT keyed per language; shared, it is varchar(255) keyed whole, which
    // its values may not fit: the disable is refused before any file is written.
    expect(refused.code).toBe(1);
    expect(refused.said.join("\n")).toContain("states no width");
    expect(sqlFiles()).toEqual(before);
  });
});
