/**
 * A deploy builds with the project's `build` script, often with `NODE_ENV`
 * unset while it runs. The CLI picks its environment files from `--mode`, or
 * from `NODE_ENV` when no mode is given, so a CLI step without the flag would
 * read `.env.development` and migrate the development database, while the
 * `next build` after it reads `.env.production`. Every `nextly` step a
 * scaffold's build runs therefore carries `--mode production`: the migration
 * and each plugin install alike.
 *
 * Every config a template can give a project is checked, including any added
 * later, so a template whose build gains a CLI step without the flag fails
 * here.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseConfig, ProjectType } from "../types";
import { generatePackageJson } from "../utils/template";

const TEMPLATES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

const MODE = "--mode production";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/** Each config a site template can copy into a project as its config. */
async function siteTemplateConfigs(): Promise<
  { template: string; file: string }[]
> {
  const found: { template: string; file: string }[] = [];
  for (const template of await readdir(TEMPLATES)) {
    // The plugin template is a library; its build is checked below.
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

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** The build script's steps for a project scaffolded with `config`. */
async function buildSteps(template: string, config: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "nextly-build-mode-"));
  dirs.push(dir);
  await writeFile(path.join(dir, "nextly.config.ts"), config);
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
  return String(pkg.scripts.build).split(" && ");
}

/** The steps that run the Nextly CLI, however the script spells them. */
const cliSteps = (steps: string[]) =>
  steps.filter(step => /^(?:\S+\s+)*nextly\s/.test(step));

describe("a scaffold's build runs every CLI step in production mode", () => {
  it("gives each step of every site template's build --mode production, plugin installs included", async () => {
    const configs = await siteTemplateConfigs();
    expect(configs.length).toBeGreaterThan(1);

    let pluginSteps = 0;
    for (const { template, file } of configs) {
      const steps = await buildSteps(template, await readFile(file, "utf8"));
      const where = path.relative(TEMPLATES, file).split(path.sep).join("/");
      const cli = cliSteps(steps);
      // Every build migrates, so there is always at least one step to check.
      expect(cli[0], where).toBe(`nextly migrate ${MODE}`);
      for (const step of cli) {
        expect(step.endsWith(` ${MODE}`), `${where}: ${step}`).toBe(true);
        // Once each: a mode given twice is refused by the CLI's parser.
        expect(step.split(MODE).length - 1, `${where}: ${step}`).toBe(1);
      }
      pluginSteps += cli.filter(step => step.includes(" plugins ")).length;
      // The app is built after the CLI has prepared its database.
      expect(steps.indexOf("next build"), where).toBeGreaterThan(
        steps.indexOf(cli.at(-1) ?? "")
      );
    }
    // A template that registers a plugin exists, so the install step's flag
    // was checked, not only the migration's.
    expect(pluginSteps).toBeGreaterThan(0);
  });

  it("writes the plain build for a project with no template directory", async () => {
    const pkg = JSON.parse(await generatePackageJson("app", sqlite));
    expect(pkg.scripts.build).toBe(`nextly migrate ${MODE} && next build`);
  });

  it("leaves the commands run by hand to follow NODE_ENV, as they do today", async () => {
    const pkg = JSON.parse(await generatePackageJson("app", sqlite));
    expect(pkg.scripts["db:migrate"]).toBe("nextly migrate");
    expect(pkg.scripts.dev).toBe("next dev --turbopack");
  });

  it("gives a Plugin's build no CLI step: a plugin is a library, built with tsdown and never deployed", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", sqlite, true, "plugin")
    );
    expect(pkg.scripts.build).toBe("tsdown");
  });
});
