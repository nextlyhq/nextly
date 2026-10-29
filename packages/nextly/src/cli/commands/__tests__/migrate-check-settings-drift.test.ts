/**
 * `migrate:check` fails when settings changed with no migration written for
 * them, as it fails for a table change: "no drift" is the claim that
 * `migrate:create` has nothing to write.
 *
 * The commands are driven themselves over a project directory, the config
 * handed to the loader. Two controls: the same project with nothing changed
 * passes, and a project whose newest snapshot predates recording settings
 * passes too, because such a snapshot says nothing about settings and its
 * silence is never a difference.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

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

// `migrate` is the largest command module. `migrate:check` reads it only for
// `parseSqlSections`, to warn about statements a run would refuse, which this
// file does not test: every file it checks is one `migrate:create` wrote.
vi.mock("../migrate", () => ({
  parseSqlSections: () => ({ upSql: "", downSql: "" }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-check-settings-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Neither command connects; each needs only the dialect.
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "unused.db")}`;
  _resetEnvCache();
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
  }
}

const project = (description: string) =>
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

const create = (config: unknown) =>
  run(config, context =>
    runMigrateCreate("create", { cwd: dir, nonInteractive: true }, context)
  );
const check = (config: unknown) =>
  run(config, context => runMigrateCheck({ cwd: dir }, context));

describe("migrate:check and settings", () => {
  it("fails naming a settings change no migration records", async () => {
    expect((await create(project("Blog posts"))).code).toBeUndefined();

    const { code, said } = await check(project("Articles"));

    expect(code).toBe(1);
    expect(said.join("\n")).toContain("posts: description");
    expect(said.join("\n")).toContain("migrate:create");
  });

  it("passes when nothing changed", async () => {
    expect((await create(project("Blog posts"))).code).toBeUndefined();

    expect((await check(project("Blog posts"))).code).toBeUndefined();
  });

  it("passes over a snapshot that predates recording settings", async () => {
    expect((await create(project("Blog posts"))).code).toBeUndefined();
    // The same snapshot as an earlier release wrote it: no settings record.
    const meta = join(dir, "migrations", "meta");
    const [name] = readdirSync(meta);
    const file = JSON.parse(await readFile(join(meta, name), "utf-8"));
    delete file.entities;
    await rm(join(meta, name));
    await writeFile(join(meta, name), JSON.stringify(file));

    expect((await check(project("Articles"))).code).toBeUndefined();
  });
});
