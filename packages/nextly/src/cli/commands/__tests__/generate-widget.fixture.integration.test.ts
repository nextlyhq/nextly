/**
 * What `generate:widget` writes works as written, in projects made from the
 * real templates: every view kind generated into a site from the blank
 * template, a site from the blog template and a plugin from the plugin
 * template, then each project type-checked and its generated tests run. Those
 * tests boot the widget through `createTestNextly`, which runs the startup
 * checks (a description, labelled settings, `isEmpty` for a component, a
 * preview case JSON carries), answer its load through the dashboard's route,
 * and draw it in the admin's frame.
 *
 * Each project has the package.json its scaffold writes, and is installed
 * from it: every package it declares, and only those, is linked into its
 * `node_modules` from the workspace's built packages. The registry is the one
 * thing this stands in for, since the packages under test are this checkout's
 * and not yet published; what gets installed is still decided by the
 * manifest, so a site from the blank template, which declares no
 * `@nextlyhq/plugin-sdk`, has one only once the command adds it, and is
 * installed again after it as its next steps say. The run needs the packages
 * built: an integration test, run from the root after the build.
 */
import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { parseSync } from "oxc-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WIDGET_VIEW_KINDS } from "../generate-widget/files";
import { runGenerateWidget } from "../generate-widget/run";

const REPO = resolve(import.meta.dirname, "../../../../../..");
const TEMPLATES = join(REPO, "templates");
const fromAdmin = createRequire(join(REPO, "packages/admin/package.json"));

/** Where the install finds each package a fixture's manifest may declare. */
const SOURCES: Record<string, string> = {
  nextly: join(REPO, "packages/nextly"),
  "@nextlyhq/plugin-sdk": join(REPO, "packages/plugin-sdk"),
  "@nextlyhq/plugin-form-builder": join(REPO, "packages/plugin-form-builder"),
  "@nextlyhq/admin": join(REPO, "packages/admin"),
  "@nextlyhq/ui": join(REPO, "packages/ui"),
  react: dirname(fromAdmin.resolve("react/package.json")),
  "react-dom": dirname(fromAdmin.resolve("react-dom/package.json")),
  "@types/react": dirname(fromAdmin.resolve("@types/react/package.json")),
  "@types/react-dom": dirname(
    fromAdmin.resolve("@types/react-dom/package.json")
  ),
  vitest: dirname(
    createRequire(import.meta.url).resolve("vitest/package.json")
  ),
};

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    jsx: "react-jsx",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
  },
};

/** A workspace package's version, which every package of the family shares. */
const versionOf = async (name: string): Promise<string> =>
  (
    JSON.parse(
      await readFile(join(SOURCES[name]!, "package.json"), "utf8")
    ) as { version: string }
  ).version;

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  );

/**
 * Installs a project from its package.json: links every package its
 * dependencies and devDependencies declare that is not there yet, and
 * nothing it does not declare.
 */
async function install(root: string): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  ) as Record<string, Record<string, string> | undefined>;
  const declared = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  });
  for (const name of declared) {
    const source = SOURCES[name];
    if (source === undefined) throw new Error(`no source for ${name}`);
    const at = join(root, "node_modules", name);
    if (await exists(at)) continue;
    await mkdir(dirname(at), { recursive: true });
    await symlink(source, at, "dir");
  }
}

/**
 * The manifest each scaffold writes, as far as these files import from it: a
 * site's from create-nextly-app's generatePackageJson (the blog adds the form
 * builder and the SDK it needs), a plugin's from its generatePluginPackageJson.
 * Vitest is in each, as a project that runs the generated test has it.
 */
async function manifest(kind: "blank" | "blog" | "plugin"): Promise<object> {
  const version = await versionOf("nextly");
  const family = (names: string[]) =>
    Object.fromEntries(names.map(name => [name, version]));
  const react = { react: "^19", "react-dom": "^19" };
  const tooling = {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    vitest: "^5",
  };
  if (kind === "plugin") {
    return {
      name: "@acme/shop",
      keywords: ["nextly", "nextly-plugin"],
      type: "module",
      devDependencies: {
        ...family([
          "nextly",
          "@nextlyhq/admin",
          "@nextlyhq/ui",
          "@nextlyhq/plugin-sdk",
        ]),
        ...react,
        ...tooling,
      },
    };
  }
  const blog =
    kind === "blog"
      ? family(["@nextlyhq/plugin-form-builder", "@nextlyhq/plugin-sdk"])
      : {};
  return {
    name: kind,
    private: true,
    dependencies: {
      ...family(["nextly", "@nextlyhq/admin", "@nextlyhq/ui"]),
      ...blog,
      ...react,
    },
    devDependencies: tooling,
  };
}

/** A plugin's files with the scaffold's placeholders filled in. */
async function fillPlaceholders(path: string): Promise<void> {
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text
      .replaceAll("{{pluginName}}", "@acme/shop")
      .replaceAll("{{nextlyRange}}", "*")
  );
}

/** Every view kind is generated, half of them reading a collection. */
const isCollection = (index: number): boolean => index % 2 === 1;

interface Fixture {
  name: "blank" | "blog" | "plugin";
  root: string;
  /** What the project's own tsconfig includes. */
  include: string[];
  /** The file the generated widgets are listed in, checked for syntax. */
  listFile: string;
}

async function blankSite(base: string): Promise<Fixture> {
  const root = join(base, "blank");
  await mkdir(root, { recursive: true });
  await cp(
    join(TEMPLATES, "blank/nextly.config.ts"),
    join(root, "nextly.config.ts")
  );
  return {
    name: "blank",
    root,
    include: ["nextly.config.ts", "src"],
    listFile: join(root, "nextly.config.ts"),
  };
}

async function blogSite(base: string): Promise<Fixture> {
  const root = join(base, "blog");
  await mkdir(root, { recursive: true });
  await cp(
    join(TEMPLATES, "blog/configs/codefirst.config.ts"),
    join(root, "nextly.config.ts")
  );
  // The blog's own collections and plugins are not this test's; its edited
  // config is checked for syntax, and the generated files for types.
  return {
    name: "blog",
    root,
    include: ["src/dashboard"],
    listFile: join(root, "nextly.config.ts"),
  };
}

async function pluginPackage(base: string): Promise<Fixture> {
  const root = join(base, "plugin");
  await cp(join(TEMPLATES, "plugin/src"), join(root, "src"), {
    recursive: true,
  });
  for (const file of ["src/plugin.ts", "src/admin/index.ts"]) {
    await fillPlaceholders(join(root, file));
  }
  return {
    name: "plugin",
    root,
    include: ["src"],
    listFile: join(root, "src/plugin.ts"),
  };
}

/** What a parser makes of a file: its syntax errors, if it has any. */
const syntaxErrors = (path: string, text: string): string[] =>
  parseSync(path, text).errors.map(error => error.message);

/**
 * A command's exit status and its output as plain text: a Vitest run under
 * this one inherits its colour setting, and the codes would split the summary
 * line the assertions read.
 */
function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 600_000,
  });
  return {
    status: result.status,
    output: stripVTControlCharacters(`${result.stdout}\n${result.stderr}`),
  };
}

describe("generate:widget in projects made from the templates", () => {
  let base: string;
  const fixtures: Fixture[] = [];

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "nextly-generate-widget-fixture-"));
    for (const make of [blankSite, blogSite, pluginPackage]) {
      const fixture = await make(base);
      await writeFile(
        join(fixture.root, "package.json"),
        `${JSON.stringify(await manifest(fixture.name), null, 2)}\n`
      );
      await install(fixture.root);
      await writeFile(
        join(fixture.root, "tsconfig.json"),
        JSON.stringify({ ...TSCONFIG, include: fixture.include })
      );
      // Every view kind, half of them reading a collection the reader chooses.
      for (const [index, view] of WIDGET_VIEW_KINDS.entries()) {
        const result = await runGenerateWidget(fixture.root, {
          id: `${view}-card`,
          view,
          collection: isCollection(index),
        });
        if (!result.ok)
          throw new Error(`${fixture.name} ${view}: ${result.reason}`);
        expect(result.manual).toEqual([]);
      }
      // As its next steps say once the command adds a dependency.
      await install(fixture.root);
      fixtures.push(fixture);
    }
  }, 120_000);

  afterAll(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  it("adds the SDK to the blank site, at the workspace's version, and to no other", async () => {
    const sdk = await versionOf("@nextlyhq/plugin-sdk");
    for (const fixture of fixtures) {
      const declared = JSON.parse(
        await readFile(join(fixture.root, "package.json"), "utf8")
      ) as Record<string, Record<string, string> | undefined>;
      const added = declared.devDependencies?.["@nextlyhq/plugin-sdk"];
      if (fixture.name === "blank") expect(added, fixture.name).toBe(sdk);
      else
        expect(JSON.stringify(declared), fixture.name).toBe(
          JSON.stringify(await manifest(fixture.name))
        );
    }
  });

  it("lists every widget in a file that still parses", async () => {
    for (const fixture of fixtures) {
      const text = await readFile(fixture.listFile, "utf8");
      for (const view of WIDGET_VIEW_KINDS) {
        expect(text).toContain(`${view}Card`);
      }
      expect(syntaxErrors(fixture.listFile, text), fixture.name).toEqual([]);
    }
  });

  it("type-checks what it wrote", () => {
    const tsc = join(REPO, "node_modules/.bin/tsc");
    for (const fixture of fixtures) {
      const result = run(tsc, ["-p", "tsconfig.json"], fixture.root);
      expect(result.output, fixture.name).not.toMatch(/error TS/);
      expect(result.status, fixture.name).toBe(0);
    }
  }, 600_000);

  it("passes the tests it wrote: booted, loaded and drawn", () => {
    const vitest = join(SOURCES.vitest!, "vitest.mjs");
    // Each file's tests: the load, the card, and for a widget reading a
    // collection, what it reads from a stored entry.
    const tests = [...WIDGET_VIEW_KINDS.keys()].reduce(
      (sum, index) => sum + (isCollection(index) ? 3 : 2),
      0
    );
    for (const fixture of fixtures) {
      // Only the generated tests, so the count is theirs: the plugin template
      // ships a test of its own.
      const result = run(
        process.execPath,
        [
          vitest,
          "run",
          ".widget.test.ts",
          "--root",
          fixture.root,
          "--maxWorkers=1",
          "--testTimeout=120000",
          "--hookTimeout=120000",
        ],
        fixture.root
      );
      expect(result.output, fixture.name).toMatch(
        new RegExp(`Tests\\s+${tests} passed`)
      );
      expect(result.status, fixture.name).toBe(0);
    }
  }, 900_000);
});
