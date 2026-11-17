/**
 * `migrate:check` passes on a project made from the blog template once its
 * first migration is written.
 *
 * The template ships its migration with a snapshot in an older format, which
 * lists entities and carries no hash of the migration, and a file per dialect
 * beside the one snapshot. Those files run as written and have no hash to be
 * held to, so the check passes over them rather than calling the template's
 * snapshot invalid; the project's own migration is still held to its hash.
 *
 * The commands are driven themselves over a copy of the template's migrations
 * folder, with the template's own collections and Singles.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConfig, text } from "../../../config";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

// The template imports nextly's package root for one name; its config surface
// is the real one.
vi.mock("../../../index", async () => ({
  NextlyError: (await import("../../../errors/nextly-error")).NextlyError,
}));

const TEMPLATE = new URL("../../../../../../templates/blog/", import.meta.url);

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
// `../program` imports every command, `migrate` with its whole graph among
// them; the command under test needs only its context factory, and is handed
// its context here anyway.
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

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-check-template-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Neither command connects; each needs only the dialect.
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "unused.db")}`;
  _resetEnvCache();
  cpSync(
    fileURLToPath(new URL("migrations", TEMPLATE)),
    join(dir, "migrations"),
    {
      recursive: true,
    }
  );
});

afterEach(() => {
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** Run a command over `config`; its exit code, if any, and what it said. */
async function run(
  config: unknown,
  command: (context: CommandContext) => Promise<void>
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

/** One export of a module in the blog template, loaded by a run-time path. */
async function templateExport(file: string, name: string): Promise<unknown> {
  const module: Record<string, unknown> = await import(
    fileURLToPath(new URL(file, TEMPLATE))
  );
  return module[name];
}

/** The template's configuration, with a field added to Posts. */
async function projectWithSubtitle() {
  const [Posts, Authors, Categories, Tags, SiteSettings, Navigation, Homepage] =
    (await Promise.all([
      templateExport("src/collections/Posts/index.ts", "Posts"),
      templateExport("src/collections/Authors.ts", "Authors"),
      templateExport("src/collections/Categories.ts", "Categories"),
      templateExport("src/collections/Tags.ts", "Tags"),
      templateExport("src/singles/SiteSettings/index.ts", "SiteSettings"),
      templateExport("src/singles/Navigation/index.ts", "Navigation"),
      templateExport("src/singles/Homepage/index.ts", "Homepage"),
    ])) as { fields: unknown[] }[];
  return defineConfig({
    collections: [
      { ...Posts, fields: [...Posts.fields, text({ name: "subtitle" })] },
      Authors,
      Categories,
      Tags,
    ],
    singles: [SiteSettings, Navigation, Homepage],
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);
}

const create = (config: unknown) =>
  run(config, context => {
    // As `--non-interactive` does: no rename is asked about.
    setNonInteractive(true);
    return runMigrateCreate("add_subtitle", { cwd: dir }, context).finally(() =>
      setNonInteractive(false)
    );
  });
const check = (config: unknown) =>
  run(config, context => runMigrateCheck({ cwd: dir }, context));

describe("migrate:check on a project made from the blog template", () => {
  it("passes once the project's first migration is written", async () => {
    const config = await projectWithSubtitle();
    const created = await create(config);
    expect(created.code, created.said.join("\n")).toBeUndefined();

    const { code, said } = await check(config);

    expect(code, said.join("\n")).toBeUndefined();
  });

  it("still fails when the project's own migration is edited", async () => {
    const config = await projectWithSubtitle();
    expect((await create(config)).code).toBeUndefined();
    const own = readdirSync(join(dir, "migrations")).find(name =>
      name.endsWith("_add_subtitle.sql")
    )!;
    const path = join(dir, "migrations", own);
    await writeFile(path, `${await readFile(path, "utf-8")}\n-- edited\n`);

    const { code, said } = await check(config);

    expect(code).toBe(1);
    expect(said.join("\n")).toContain(own);
  });
});
