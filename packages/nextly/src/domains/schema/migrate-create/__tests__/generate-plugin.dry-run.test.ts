/**
 * `migrate:create --plugin --dry-run`: the module generator builds the module and the barrel as a
 * real run does and writes neither. A real run on the same input then writes exactly the module
 * the dry run named, holding the text it returned, so a dry run that guessed at either would part
 * from it here.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { TableSpec } from "../../pipeline/diff/types";
import {
  generateBlankPluginMigration,
  generatePluginMigration,
} from "../generate-plugin";

const NOTES: TableSpec = {
  name: "fx__notes",
  columns: [
    { name: "id", type: "varchar(36)", nullable: false, primaryKey: true },
    { name: "label", type: "varchar(255)", nullable: false },
  ],
  indexes: [],
};

const FIRST = {
  pluginName: "fixture",
  schemaVersion: 1,
  name: "init",
  now: new Date("2026-11-03T10:45:00Z"),
  tablesByDialect: {
    postgresql: [NOTES],
    mysql: [NOTES],
    sqlite: [NOTES],
  } as Record<SupportedDialect, TableSpec[]>,
  existing: [],
};

let dir: string;
let migrationsDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-plugin-dry-run-"));
  migrationsDir = join(dir, "migrations");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("generatePluginMigration with dryRun", () => {
  it("names the module and the barrel, returns the module's text, and writes nothing", async () => {
    const dry = await generatePluginMigration({
      ...FIRST,
      migrationsDir,
      dryRun: true,
    });
    expect(dry).not.toBeNull();
    expect(await readdir(dir)).toEqual([]);

    const real = await generatePluginMigration({ ...FIRST, migrationsDir });
    expect(real!.modulePath).toBe(dry!.modulePath);
    expect(real!.indexPath).toBe(dry!.indexPath);
    expect(await readFile(real!.modulePath, "utf-8")).toBe(dry!.moduleContent);
    expect((await readdir(migrationsDir)).sort()).toEqual(
      [`${dry!.moduleName}.ts`, "index.ts"].sort()
    );
  });

  it("names a blank module and writes nothing", async () => {
    const dry = await generateBlankPluginMigration({
      ...FIRST,
      migrationsDir,
      dryRun: true,
    });
    expect(await readdir(dir)).toEqual([]);

    const real = await generateBlankPluginMigration({
      ...FIRST,
      migrationsDir,
    });
    expect(real.modulePath).toBe(dry.modulePath);
    expect(await readFile(real.modulePath, "utf-8")).toBe(dry.moduleContent);
  });
});
