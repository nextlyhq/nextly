/**
 * The templates' configs, and the build script a project scaffolded from one
 * gets, for the tests that judge that script.
 */
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DatabaseConfig, ProjectType } from "../../types";
import { generatePackageJson } from "../../utils/template";

export const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../templates"
);

/** The search-index builder a template ships, relative to its folder. */
export const SEARCH_INDEX_SCRIPT = "scripts/build-search-index.mjs";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/**
 * Each config a template can copy into a project as its `nextly.config.ts`:
 * the template's own, and one per approach in its `configs/`. The plugin
 * template is a library whose build is `tsdown`, with no production boot.
 */
export async function templateConfigs(): Promise<
  { template: string; file: string }[]
> {
  const found: { template: string; file: string }[] = [];
  for (const template of await readdir(TEMPLATES)) {
    if (template === "plugin") continue;
    const dir = path.join(TEMPLATES, template);
    const names = await readdir(dir).catch(() => []);
    if (names.includes("nextly.config.ts")) {
      found.push({ template, file: path.join(dir, "nextly.config.ts") });
    }
    const configs = await readdir(path.join(dir, "configs")).catch(() => []);
    for (const name of configs.filter(name => name.endsWith(".config.ts"))) {
      found.push({ template, file: path.join(dir, "configs", name) });
    }
  }
  return found;
}

/** A template file's path under `templates/`, with `/` on every platform. */
export const relative = (file: string) =>
  path.relative(TEMPLATES, file).split(path.sep).join("/");

/** Every plugin package a config imports, the SDK aside. */
export const importedPlugins = (text: string) => [
  ...new Set(
    [...text.matchAll(/from\s+"(@nextlyhq\/plugin-[^"]+)"/g)]
      .map(found => found[1])
      .filter(pkg => pkg !== "@nextlyhq/plugin-sdk")
  ),
];

const scaffolds: string[] = [];

/** Removes every project `scaffoldBuild` made; for an `afterEach`. */
export async function removeScaffolds(): Promise<void> {
  for (const dir of scaffolds.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A SQLite project scaffolded from `template` with `config` as its
 * `nextly.config.ts`, and its build script. The project holds the
 * search-index builder when the template ships one, as a scaffold copies it,
 * because the generator decides that step from the files the project has.
 */
export async function scaffoldBuild(
  template: string,
  config: string
): Promise<{ dir: string; script: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "nextly-build-script-"));
  scaffolds.push(dir);
  await writeFile(path.join(dir, "nextly.config.ts"), config);
  const shipped = path.join(TEMPLATES, template, SEARCH_INDEX_SCRIPT);
  if (existsSync(shipped)) {
    await mkdir(path.join(dir, "scripts"), { recursive: true });
    await copyFile(shipped, path.join(dir, SEARCH_INDEX_SCRIPT));
  }
  const pkg = JSON.parse(
    await generatePackageJson(
      "app",
      sqlite,
      true,
      template as ProjectType,
      [],
      dir
    )
  );
  return { dir, script: String(pkg.scripts.build) };
}
