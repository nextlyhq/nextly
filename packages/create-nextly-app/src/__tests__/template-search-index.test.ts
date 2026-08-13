/**
 * Whether a scaffold gets the Pagefind step is READ from the template tree, not from its name.
 *
 * The unit tests around `generatePackageJson` pass no template directories, so they only ever see
 * the negative branch — a scaffold that receives no search-index builder. That is exactly half the
 * behaviour, and the half that cannot regress into shipping a broken script.
 *
 * So this reads the REAL templates. A test that constructed a fixture directory would be asserting
 * against a tree this repository does not ship, and would keep passing after `templates/blog` moved
 * or renamed the builder — which is the change most likely to break the derivation.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { DatabaseConfig } from "../types";
import {
  generatePackageJson,
  templateShipsSearchIndex,
} from "../utils/template";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);
const templates = join(repoRoot, "templates");
const baseDir = join(templates, "base");
const blogDir = join(templates, "blog");

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

describe("the search-index step is derived from the template tree", () => {
  // Before any assertion below means anything: these directories have to exist. A path that
  // resolved to nothing would make every "does not ship a builder" check below pass, and the
  // suite would report that the derivation works while reading an empty tree.
  it("is reading the real template directories", () => {
    expect(existsSync(baseDir)).toBe(true);
    expect(existsSync(blogDir)).toBe(true);
    expect(existsSync(join(blogDir, "scripts", "build-search-index.mjs"))).toBe(
      true
    );
  });

  it("sees the builder in blog and not in base alone", async () => {
    await expect(templateShipsSearchIndex([baseDir])).resolves.toBe(false);
    await expect(templateShipsSearchIndex([baseDir, blogDir])).resolves.toBe(
      true
    );
  });

  it("gives a blog scaffold the index step, and declares what runs it", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("app", sqlite, false, "blog", [
        baseDir,
        blogDir,
      ])
    );

    expect(pkg.scripts.build).toBe(
      "nextly migrate && next build && node scripts/build-search-index.mjs"
    );
    expect(pkg.scripts["search:index"]).toBe(
      "node scripts/build-search-index.mjs"
    );
    // Declared rather than left to be fetched on demand. `npx -y pagefind` would download it,
    // so a build can succeed with the dependency missing from the manifest — and then fail for
    // a user behind a proxy or an offline install.
    expect(pkg.devDependencies.pagefind).toBeDefined();
  }, 30_000);

  it("leaves a blank scaffold without the step or the dependency", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("app", sqlite, false, "blank", [baseDir])
    );

    expect(pkg.scripts.build).toBe("nextly migrate && next build");
    expect(pkg.scripts["search:index"]).toBeUndefined();
    expect(pkg.devDependencies.pagefind).toBeUndefined();
  }, 30_000);
});
