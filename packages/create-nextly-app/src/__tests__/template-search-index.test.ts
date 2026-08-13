/**
 * The build step that runs the Pagefind indexer must name a file the project actually has.
 *
 * This is tested by SCAFFOLDING — the real templates, through the real copy, onto a real
 * temporary directory — rather than by asking the template tree what it contains. The difference
 * is not incidental: the template ships `scripts/build-search-index.mjs`, and for as long as the
 * copy did not carry that directory across, every source-tree answer was "yes, it has one" while
 * every scaffolded project did not. The generated build then named a file that was never there.
 *
 * The old script hid that. It invoked the builder behind `(test -f … || true)`, so the miss was
 * swallowed and every blog scaffold shipped a search page with no index behind it.
 *
 * So the only assertion worth making here is one that reads the finished project.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate, projectHasSearchIndexScript } from "../utils/template";

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
  workspace = await mkdtemp(join(tmpdir(), "nextly-scaffold-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function scaffold(projectType: "blank" | "blog"): Promise<{
  target: string;
  pkg: {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
}> {
  const target = join(workspace, projectType);
  await copyTemplate({
    projectName: "app",
    projectType,
    targetDir: target,
    database: sqlite,
    templateSource: {
      basePath: join(templates, "base"),
      templatePath: join(templates, projectType),
    },
  });
  const { readFile } = await import("node:fs/promises");
  return {
    target,
    pkg: JSON.parse(await readFile(join(target, "package.json"), "utf8")),
  };
}

describe("a blog scaffold", () => {
  // The precondition. If the template stopped shipping the builder, every assertion below would
  // pass by describing a project that correctly has no search step — while the blog silently lost
  // its search. This separates "correctly absent" from "the template changed underneath us".
  it("starts from a template that ships the builder", () => {
    expect(
      existsSync(join(templates, "blog", "scripts", "build-search-index.mjs"))
    ).toBe(true);
  });

  it("receives the builder, and gets a build step that names it", async () => {
    const { target, pkg } = await scaffold("blog");

    // The file the build step will resolve. Asserted on the PROJECT, which is the only place
    // the answer matters.
    await expect(projectHasSearchIndexScript(target)).resolves.toBe(true);
    expect(existsSync(join(target, "scripts", "build-search-index.mjs"))).toBe(
      true
    );

    expect(pkg.scripts.build).toBe(
      "nextly migrate && next build && node scripts/build-search-index.mjs"
    );
    expect(pkg.scripts["search:index"]).toBe(
      "node scripts/build-search-index.mjs"
    );
    // Declared rather than fetched on demand: `npx -y pagefind` downloads it, so a build can
    // succeed with the dependency missing and fail for a user installing offline.
    expect(pkg.devDependencies.pagefind).toBeDefined();
  }, 60_000);
});

describe("a blank scaffold", () => {
  it("gets neither the step nor the dependency", async () => {
    const { target, pkg } = await scaffold("blank");

    await expect(projectHasSearchIndexScript(target)).resolves.toBe(false);
    expect(pkg.scripts.build).toBe("nextly migrate && next build");
    // A script pointing at a file that does not exist reads as a supported command.
    expect(pkg.scripts["search:index"]).toBeUndefined();
    expect(pkg.devDependencies.pagefind).toBeUndefined();
  }, 60_000);
});
