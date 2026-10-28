/**
 * Which Builder registry rows a migration carries is decided per kind of
 * entity.
 *
 * A code-first collection shadows the Builder collection of the same slug, and
 * only that one: the manifest allows a collection, a Single and a field group
 * to share a slug. Here the code-first `dup` collection shadows the Builder
 * `dup` collection, and the Builder `dup` Single is shadowed by nothing, so a
 * settings-only change to it must carry its `dynamic_singles` row. The control
 * is the shadowed Builder collection, whose row must never be written: the
 * code-first collection owns that slug's registry row.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-builder-rows-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // `migrate:create` needs only the dialect; it never connects.
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "unused.db")}`;
  _resetEnvCache();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

const config = defineConfig({
  collections: [
    defineCollection({ slug: "dup", fields: [text({ name: "headline" })] }),
  ],
  db: { migrationsDir: "./migrations" },
});

/** The manifest the Builder leaves: a collection and a Single, both `dup`. */
async function manifest(singleDescription: string): Promise<void> {
  const parsed = uiSchemaManifest.parse({
    collections: [{ slug: "dup", fields: [{ name: "title", type: "text" }] }],
    singles: [
      {
        slug: "dup",
        description: singleDescription,
        fields: [{ name: "heading", type: "text" }],
      },
    ],
  });
  await writeFile(join(dir, "ui-schema.json"), JSON.stringify(parsed));
}

/** `migrate:create --name=<name>`; the code it exits with, if any. */
async function migrateCreate(name: string): Promise<number | undefined> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 28, 12, 0, 0, clock)));
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await runMigrateCreate(name, { cwd: dir, nonInteractive: true }, {
      logger: createLogger({ quiet: true }),
      options: {},
      cwd: dir,
    } as CommandContext);
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

async function migrationNamed(name: string): Promise<string> {
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}`).toBeDefined();
  return readFile(join(dir, "migrations", file!), "utf-8");
}

describe("a Builder entity's registry row is shadowed per kind", () => {
  it("a Single sharing a shadowed collection's slug still carries its row", async () => {
    await manifest("The home page");
    expect(await migrateCreate("create")).toBeUndefined();

    await manifest("The front page");
    expect(await migrateCreate("describe")).toBeUndefined();

    const sql = await migrationNamed("describe");
    expect(sql).toContain("-- Settings: dup (single): description");
    expect(sql).toMatch(/INSERT INTO "dynamic_singles"[^;]*'The front page'/);
    // The shadowed Builder collection's row is the code-first one's to write.
    expect(sql).not.toContain('INSERT INTO "dynamic_collections"');
  });
});
