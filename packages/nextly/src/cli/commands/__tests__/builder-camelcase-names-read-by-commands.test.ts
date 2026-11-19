/**
 * `migrate:create` and `migrate:check` read a Schema Builder definition file whose fields have
 * camelCase names, on every dialect.
 *
 * A collection, a Single or a field group made through the API or by a plugin keeps a camelCase
 * field name as it was given, and the definition file records it so. Both commands read that
 * file: `migrate:create` writes the field's column by the one rule every writer shares, the
 * name in snake case (`metaTitle` is the column `meta_title`), and records the field under its
 * own name; `migrate:check`, reading the same file again, finds nothing to report.
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

/** A collection, a Single and a field group, each with a camelCase field beside a plain one. */
const MANIFEST = {
  collections: [
    {
      slug: "cases",
      fields: [
        { name: "summary", type: "text" },
        { name: "metaTitle", type: "text" },
      ],
    },
  ],
  singles: [
    {
      slug: "about",
      fields: [
        { name: "summary", type: "text" },
        { name: "metaTitle", type: "text" },
      ],
    },
  ],
  components: [
    {
      slug: "teaser",
      fields: [
        { name: "summary", type: "text" },
        { name: "metaTitle", type: "text" },
      ],
    },
  ],
};

const project = defineConfig({
  collections: [],
  db: { migrationsDir: "./migrations" },
});

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-camelcase-names-"));
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
  "a definition file with camelCase field names, read by the commands on %s",
  dialect => {
    /** `migrate:create` over the Builder-only project; what it said and the migration it wrote. */
    async function create(): Promise<{ said: string[]; sql: string }> {
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
      // The file is read, not refused: the command ends without an exit code and writes a file.
      expect(created.said.join("\n")).not.toContain("NEXTLY_UI_SCHEMA_INVALID");
      expect(created.code).toBeUndefined();
      const migrations = join(dir, "migrations");
      const files = readdirSync(migrations).filter(name =>
        name.endsWith(".sql")
      );
      expect(files).toHaveLength(1);
      return {
        said: created.said,
        sql: await readFile(join(migrations, files[0]), "utf-8"),
      };
    }

    /** The lines of `sql` that declare a column named `column`, one per table that has it. */
    const columnLines = (sql: string, column: string): string[] =>
      sql
        .split("\n")
        .filter(line => new RegExp(`^\\s+["\`]${column}["\`] `).test(line));

    it("migrate:create names each table's column in snake case, and no column by the field's own spelling", async () => {
      const { upSql } = parseSqlSections((await create()).sql);

      // One `meta_title` column in each of the three tables, beside the plain field's.
      expect(columnLines(upSql, "meta_title")).toHaveLength(3);
      expect(columnLines(upSql, "summary")).toHaveLength(3);
      expect(columnLines(upSql, "metaTitle")).toEqual([]);
      expect(columnLines(upSql, "metatitle")).toEqual([]);
    });

    it("migrate:create records each field under its own name, and its column in snake case", async () => {
      await create();

      const meta = join(dir, "migrations", "meta");
      const [snapshotFile] = readdirSync(meta).filter(name =>
        name.endsWith(".json")
      );
      const recorded = JSON.parse(
        await readFile(join(meta, snapshotFile), "utf-8")
      ) as {
        snapshot: { tables: { name: string; columns: { name: string }[] }[] };
        entities: Record<
          "collections" | "singles" | "fieldGroups",
          Record<string, { settings: { fields: { name: string }[] } }>
        >;
      };
      // Each declaration as the snapshot records it: the field under its own name, as given.
      for (const [kind, slug] of [
        ["collections", "cases"],
        ["singles", "about"],
        ["fieldGroups", "teaser"],
      ] as const) {
        expect(
          recorded.entities[kind][slug]?.settings.fields.map(f => f.name),
          `${kind}.${slug}`
        ).toEqual(["summary", "metaTitle"]);
      }
      // The tables' columns, as the snapshot the next run diffs against holds them.
      for (const table of ["dc_cases", "single_about", "comp_teaser"]) {
        const columns = recorded.snapshot.tables
          .find(t => t.name === table)
          ?.columns.map(column => column.name);
        expect(columns, table).toContain("meta_title");
        expect(columns, table).not.toContain("metaTitle");
      }
    });

    it("migrate:check reads the same file and reports nothing", async () => {
      await create();

      const checked = await run(context =>
        runMigrateCheck({ cwd: dir }, context)
      );

      const said = checked.said.join("\n");
      expect(said).not.toContain("NEXTLY_UI_SCHEMA_INVALID");
      expect(said).not.toContain("meta_title");
      expect(said).not.toContain("metaTitle");
      expect(checked.code).toBeUndefined();
    });
  }
);
