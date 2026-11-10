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
  command: (context: CommandContext) => Promise<void>
): Promise<{ code: number | undefined; said: string[] }> {
  loaded.config = project;
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
