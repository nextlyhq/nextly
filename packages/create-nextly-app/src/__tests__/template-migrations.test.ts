/**
 * Which migrations a blog scaffold receives, by approach. The template's
 * hand-written SQL describes the tables a visual blog registers its schema
 * from, and its visual config reads them from `./migrations`. A code-first
 * blog's schema is its config, so it receives none of that SQL: its first
 * migration is written from the config after the install
 * (`installers/initial-migration.ts`), into the folder its config reads.
 *
 * Tested through the real copy of the real template onto a temporary folder.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate } from "../utils/template";

const templates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates"
);

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "nextly-template-migrations-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function scaffold(approach: "code-first" | "visual"): Promise<string> {
  const target = join(workspace, approach);
  await copyTemplate({
    projectName: "app",
    projectType: "blog",
    targetDir: target,
    database: sqlite,
    approach,
    templateSource: {
      basePath: join(templates, "base"),
      templatePath: join(templates, "blog"),
    },
  });
  return target;
}

describe("a blog scaffold's migrations", () => {
  // The precondition: the template ships SQL, so "none copied" below is the
  // copy's choice and not an empty template.
  it("start from a template that ships hand-written SQL", async () => {
    const files = await readdir(join(templates, "blog", "migrations"));
    expect(files.filter(f => f.endsWith(".sql")).length).toBeGreaterThan(0);
  });

  it("are the template's SQL for a visual blog, in the folder its config reads", async () => {
    const target = await scaffold("visual");
    const config = await readFile(join(target, "nextly.config.ts"), "utf8");
    expect(config).toMatch(/migrationsDir:\s*["']\.\/migrations["']/);
    const copied = await readdir(join(target, "migrations"));
    expect(copied.filter(f => f.endsWith(".sql")).sort()).toEqual(
      (await readdir(join(templates, "blog", "migrations")))
        .filter(f => f.endsWith(".sql"))
        .sort()
    );
  }, 60_000);

  it("are none of the template's SQL for a code-first blog", async () => {
    const target = await scaffold("code-first");
    const config = await readFile(join(target, "nextly.config.ts"), "utf8");
    // Its config reads nextly's default folder, where its first migration is written.
    expect(config).not.toMatch(/migrationsDir/);
    expect(existsSync(join(target, "migrations"))).toBe(false);
    expect(existsSync(join(target, "src", "db", "migrations"))).toBe(false);
  }, 60_000);
});
