import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Expression, Node, Program } from "oxc-parser";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { DatabaseConfig } from "../types";
import { PLUGIN_NODE_ENGINES } from "../utils/plugin-node";
import { copyTemplate } from "../utils/template";
// The plugin floor is read through the CLI's shared range test.
import { satisfiesRange } from "../utils/version-range";

const requireFromHere = createRequire(import.meta.url);

/** The `engines.node` an installed package declares. */
function enginesOf(name: string): string {
  return (
    requireFromHere(`${name}/package.json`) as { engines: { node: string } }
  ).engines.node;
}

/*
 * Scaffolded source is checked by its syntax tree rather than its text: a
 * substring stays present when the code around it no longer does what it
 * should, such as a provider that no longer wraps the component it names, or a
 * call that lost one of its arguments.
 */

/** One parsed file: its program, and the text its nodes' offsets point into. */
interface Parsed {
  readonly text: string;
  readonly program: Program;
}

function parseFile(file: string, text: string): Parsed {
  return { text, program: parseSource(text, file).program };
}

/** The source text of one node, as it is written. */
function textOf(source: Parsed, node: Node): string {
  return source.text.slice(node.start, node.end);
}

/** Every node in a file, depth first. */
function allNodes(root: Node): Node[] {
  const nodes: Node[] = [];
  walk(root, node => {
    nodes.push(node);
  });
  return nodes;
}

/** The names a file imports from one module. */
function namedImportsFrom(source: Parsed, from: string): string[] {
  return source.program.body.flatMap(statement =>
    statement.type === "ImportDeclaration" && statement.source.value === from
      ? statement.specifiers.flatMap(specifier =>
          specifier.type === "ImportSpecifier" ? [specifier.local.name] : []
        )
      : []
  );
}

/**
 * The element tree a JSX expression renders, as `Outer(Inner(Leaf))`: a
 * self-closing element is its name alone, an element with a body is its name
 * and the elements inside it.
 */
function jsxShape(source: Parsed, node: Node): string {
  if (node.type === "ParenthesizedExpression") {
    return jsxShape(source, node.expression);
  }
  if (node.type !== "JSXElement") return "";
  const name = textOf(source, node.openingElement.name);
  if (node.openingElement.selfClosing) return name;
  const children = node.children
    .filter(child => child.type === "JSXElement")
    .map(child => jsxShape(source, child));
  return `${name}(${children.join(",")})`;
}

/** What a file's default-exported function returns. */
function defaultExportReturns(source: Parsed): Expression[] {
  const [fn] = source.program.body.flatMap(statement =>
    statement.type === "ExportDefaultDeclaration" &&
    statement.declaration.type === "FunctionDeclaration"
      ? [statement.declaration]
      : []
  );
  return (fn?.body?.body ?? []).flatMap(statement =>
    statement.type === "ReturnStatement" && statement.argument
      ? [statement.argument]
      : []
  );
}

/**
 * Each call to `<anything>.<method>(...)` in a file, as the properties of its
 * one object argument: `{ collection: '"examples"', data: "{ ... }" }`. A call
 * whose argument is not a single object literal is returned as `null`. Only
 * `key: value` properties are listed; a shorthand, a method or a spread names
 * no value to compare.
 */
function objectCallsTo(
  source: Parsed,
  method: string
): Array<Record<string, string> | null> {
  return allNodes(source.program).flatMap(node => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "MemberExpression" ||
      node.callee.computed ||
      node.callee.property.type !== "Identifier" ||
      node.callee.property.name !== method
    ) {
      return [];
    }
    const [only, ...rest] = node.arguments;
    if (!only || rest.length > 0 || only.type !== "ObjectExpression") {
      return [null];
    }
    return [
      Object.fromEntries(
        only.properties.flatMap(property =>
          property.type === "Property" &&
          !property.shorthand &&
          !property.method
            ? [[textOf(source, property.key), textOf(source, property.value)]]
            : []
        )
      ),
    ];
  });
}

// Repo-root templates/ (this test exercises the real, bundled plugin template).
const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, "../../../../templates");

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false
  );

/**
 * What a freshly scaffolded suite must budget for a case and for a hook.
 *
 * A scaffolded project boots a real instance: `createTestNextly` builds a DI
 * container, registers the schema and runs auto-sync over a real SQLite
 * database. Vitest's defaults are sized for a unit test that touches none of
 * that, and the first `pnpm test` in a new project is the least warm moment
 * there is, so a timeout there reads as a broken scaffold rather than as a
 * tight budget.
 */
const BOOT_BUDGET_MS = 30_000;

type TestBudget = { testTimeout?: number; hookTimeout?: number };

/**
 * The `test` block vitest will actually apply, from a config file on disk.
 *
 * 🔴 The config is EVALUATED rather than parsed. Reading the source can only
 * ever recognise the shapes someone thought of - a wrapper, a spread, a merge,
 * an alias, a local helper of the same name - and each shape that is missed
 * reports an adequate budget for a suite that does not have one.
 *
 * A config may export the object, a function returning it, or an async function
 * returning it; vitest calls and awaits whichever it finds. `import()` hands
 * back the export itself and does neither, so a functional config read straight
 * off `default` has no `test` block at all, and an adequately budgeted project
 * would be reported as having no budget.
 */
async function resolvedConfigOf(
  configPath: string
): Promise<{ test?: TestBudget; plugins?: unknown[] }> {
  const module = (await import(/* @vite-ignore */ configPath)) as {
    default: unknown;
  };

  const exported = module.default;
  const resolved =
    typeof exported === "function"
      ? await (exported as (env: { mode: string; command: string }) => unknown)(
          {
            mode: "test",
            command: "serve",
          }
        )
      : await exported;

  return (resolved ?? {}) as { test?: TestBudget; plugins?: unknown[] };
}

/** The budget a config declares, or nothing. */
async function bootBudgetOf(
  configPath: string
): Promise<TestBudget | undefined> {
  return (await resolvedConfigOf(configPath)).test;
}

/**
 * Whether a directory contains any test file at all, ignoring installed
 * packages and dot directories.
 */
async function shipsTests(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await shipsTests(full)) return true;
      continue;
    }
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return true;
  }
  return false;
}

describe("scaffold --template plugin (D44/D45 smoke test)", () => {
  let workdir: string;
  let target: string;

  beforeAll(() => {
    // Offline: version resolution falls back; we assert structure, not versions.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  it("scaffolds a valid plugin package with an embedded /dev playground", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-smoke-"));
    target = path.join(workdir, "my-plugin");

    await copyTemplate({
      projectName: "@acme/nextly-plugin-test",
      projectType: "plugin",
      targetDir: target,
      database: { type: "sqlite" } as unknown as DatabaseConfig,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "plugin"),
      },
    });

    // Plugin source + embedded dev playground present.
    expect(await exists(path.join(target, "src/plugin.ts"))).toBe(true);
    expect(await exists(path.join(target, "src/index.ts"))).toBe(true);
    expect(await exists(path.join(target, "dev/next.config.ts"))).toBe(true);
    expect(await exists(path.join(target, "dev/nextly.config.ts"))).toBe(true);
    expect(await exists(path.join(target, "package.json"))).toBe(true);

    // NO app-only artifacts leaked into the plugin scaffold.
    expect(await exists(path.join(target, "next.config.ts"))).toBe(false);
    expect(await exists(path.join(target, "src/app/(frontend)"))).toBe(false);
    expect(await exists(path.join(target, "template.json"))).toBe(false);

    // package.json is a publishable library, placeholders filled.
    const pkg = JSON.parse(
      await readFile(path.join(target, "package.json"), "utf-8")
    );
    expect(pkg.name).toBe("@acme/nextly-plugin-test");
    expect(pkg.files).toEqual(["dist"]);
    expect(pkg.keywords).toContain("nextly-plugin");
    expect(pkg.scripts.dev).toContain("next dev dev");

    // The UI kit is a HOST peer, not a bundled dependency. tsdown externalises
    // peers automatically and bundles devDependencies, so declaring it only as
    // a devDependency ships a second copy of the whole kit inside every
    // published plugin.
    expect(pkg.peerDependencies["@nextlyhq/ui"]).toBeTruthy();

    const buildConfig = await readFile(
      path.join(target, "tsdown.config.ts"),
      "utf-8"
    );
    expect(buildConfig).toContain('"@nextlyhq/ui"');
    // The native-build allowlist lives in pnpm-workspace.yaml, NOT the package.json
    // `pnpm` field (pnpm 11 ignores that field). Without this, `pnpm install` aborts
    // on better-sqlite3 (the dev playground's native dep) with ERR_PNPM_IGNORED_BUILDS.
    expect(pkg.pnpm).toBeUndefined();

    // The Node it promises is the one its build and test tools both run on,
    // read from the installed tools so a bump that moves either fails here.
    expect(pkg.engines.node).toBe(PLUGIN_NODE_ENGINES);
    const tools = ["tsdown", "vitest"].map(enginesOf);
    // Every version where a comparator starts, a patch either side of it,
    // and the start of every major in between: where the answer can change.
    const starts = [PLUGIN_NODE_ENGINES, ...tools]
      .flatMap(range => [...range.matchAll(/(\d+)\.(\d+)\.(\d+)/g)])
      .map(([, major, minor, patch]) => [
        Number(major),
        Number(minor),
        Number(patch),
      ]);
    const samples = starts.flatMap(([major, minor, patch]) => [
      `${major}.${minor}.${patch}`,
      `${major}.${minor}.${patch + 1}`,
      patch > 0
        ? `${major}.${minor}.${patch - 1}`
        : `${major}.${Math.max(minor - 1, 0)}.99`,
      `${major}.0.0`,
      `${major + 1}.0.0`,
    ]);
    const disagreements = samples.filter(
      version =>
        satisfiesRange(version, PLUGIN_NODE_ENGINES) !==
        tools.every(range => satisfiesRange(version, range))
    );
    expect(disagreements, `tsdown: ${tools[0]}; vitest: ${tools[1]}`).toEqual(
      []
    );
    // The Vite it needs is Vitest's peer, which Yarn does not install on its
    // own. Read from the installed Vitest, so a Vitest upgrade that moves it
    // fails here rather than in a plugin author's first `yarn test`.
    const vitestManifest = requireFromHere("vitest/package.json") as {
      peerDependencies: { vite: string };
    };
    const viteMajor = /^\^(\d+)\./.exec(pkg.devDependencies.vite)?.[1];
    expect(
      vitestManifest.peerDependencies.vite
        .split("||")
        .map(range => range.trim())
    ).toContain(`^${viteMajor}.0.0`);

    /*
     * The scaffolded suite boots a real instance, so its budget is asserted
     * against what vitest will actually use rather than against the text of the
     * config.
     *
     * `plugin.test.ts` calls `createTestNextly` in `beforeEach`, which builds a
     * DI container, registers the plugin's schema and runs auto-sync over a real
     * SQLite database. Vitest's defaults are sized for a unit test that touches
     * none of that, and this is the first command a new plugin author runs, so a
     * timeout there reads as a broken scaffold rather than a tight budget.
     *
     * 🔴 The config is IMPORTED rather than parsed. Reading the source can only
     * ever recognise the shapes someone thought of - a wrapper, a spread, a
     * merge, an alias, a local helper of the same name - and each one that is
     * missed reports an adequate budget for a suite that does not have one.
     * Importing asks the runtime, which resolves all of them by construction,
     * and asserts the value the suite will really run under.
     */
    const budget = await bootBudgetOf(path.join(target, "vitest.config.ts"));

    // Both, because the boot is in a hook and the case body is not, and vitest
    // budgets the two separately.
    expect(budget?.testTimeout).toBeGreaterThanOrEqual(BOOT_BUDGET_MS);
    expect(budget?.hookTimeout).toBeGreaterThanOrEqual(BOOT_BUDGET_MS);
    expect(await exists(path.join(target, "pnpm-workspace.yaml"))).toBe(true);
    const workspaceYaml = await readFile(
      path.join(target, "pnpm-workspace.yaml"),
      "utf-8"
    );
    expect(workspaceYaml).toContain("allowBuilds:");
    expect(workspaceYaml).toContain("better-sqlite3");

    // Placeholders are replaced everywhere (no leftover {{ ... }} tokens).
    const pluginSrc = await readFile(
      path.join(target, "src/plugin.ts"),
      "utf-8"
    );
    expect(pluginSrc).toContain('name: "@acme/nextly-plugin-test"');
    expect(pluginSrc).not.toMatch(/\{\{\s*\w+\s*\}\}/);

    const devConfig = await readFile(
      path.join(target, "dev/next.config.ts"),
      "utf-8"
    );
    expect(devConfig).toContain('"@acme/nextly-plugin-test"');
    expect(devConfig).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it("keeps a dev/.env the developer already has", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-env-"));
    target = path.join(workdir, "my-plugin");
    await mkdir(path.join(target, "dev"), { recursive: true });
    await writeFile(path.join(target, "dev/.env"), "DATABASE_URL=mine\n");

    await copyTemplate({
      projectName: "my-plugin",
      projectType: "plugin",
      targetDir: target,
      database: { type: "sqlite" } as unknown as DatabaseConfig,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "plugin"),
      },
      allowExistingTarget: true,
    });

    expect(await readFile(path.join(target, "dev/.env"), "utf-8")).toBe(
      "DATABASE_URL=mine\n"
    );
  });
});

/*
 * What the first `pnpm dev` and `pnpm test` in a new plugin depend on. Each is
 * its own case so that every property is seen failing on its own: in one case
 * the first failed assertion would hide the rest.
 */
describe("a plugin scaffold runs as created", () => {
  let scaffoldRoot: string;
  let project: string;
  const read = (rel: string): Promise<string> =>
    readFile(path.join(project, rel), "utf-8");

  beforeAll(async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
    scaffoldRoot = await mkdtemp(path.join(tmpdir(), "nextly-plugin-runs-"));
    project = path.join(scaffoldRoot, "my-plugin");
    await copyTemplate({
      projectName: "my-plugin",
      projectType: "plugin",
      targetDir: project,
      database: { type: "sqlite" } as unknown as DatabaseConfig,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "plugin"),
      },
    });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await rm(scaffoldRoot, { recursive: true, force: true });
  });

  // Without dev/.env the playground has no DB_DIALECT, falls back to
  // PostgreSQL and stops asking for DATABASE_URL on the first `pnpm dev`.
  it("writes the playground's dev/.env from its example", async () => {
    expect(await read("dev/.env")).toBe(await read("dev/.env.example"));
  });

  // The admin's data hooks read their client from QueryProvider; a bare
  // RootLayout renders /admin as a 500 ("No QueryClient set").
  it("mounts the admin inside the providers its hooks need", async () => {
    const file = "dev/src/app/admin/[[...params]]/page.tsx";
    const page = parseFile(file, await read(file));

    // What the page renders, and that each name is the admin's own export.
    expect(
      defaultExportReturns(page).map(returned => jsxShape(page, returned))
    ).toEqual(["ErrorBoundary(QueryProvider(RootLayout))"]);
    expect(namedImportsFrom(page, "@nextlyhq/admin")).toEqual(
      expect.arrayContaining(["ErrorBoundary", "QueryProvider", "RootLayout"])
    );
  });

  // The Direct API takes one argument object and spells the lookup findByID;
  // the positional form fails before the first assertion runs.
  it("generates a test written against the current Direct API", async () => {
    const file = "src/plugin.test.ts";
    const suite = parseFile(file, await read(file));

    // One argument object per call, carrying what each call needs.
    const creates = objectCallsTo(suite, "create");
    const lookups = objectCallsTo(suite, "findByID");
    expect(creates).toHaveLength(1);
    expect(lookups).toHaveLength(1);
    expect(creates[0]).toMatchObject({ collection: '"examples"' });
    expect(creates[0]).toHaveProperty("data");
    expect(lookups[0]).toMatchObject({ collection: '"examples"' });
    expect(lookups[0]).toHaveProperty("id");
    // The removed spelling would compile in JavaScript and fail at run time.
    expect(objectCallsTo(suite, "findById")).toEqual([]);
  });

  // `pnpm dev` runs `next dev dev` from the plugin root and Next.js keeps that
  // working directory, so the SQLite adapter resolves DATABASE_URL from there.
  it("keeps the playground database in dev/ and out of git", async () => {
    const url = /^DATABASE_URL=file:(.+)$/m.exec(await read("dev/.env"))?.[1];
    expect(url).toBeDefined();
    const database = path.resolve(project, url ?? "");
    expect(path.relative(project, database).split(path.sep)[0]).toBe("dev");

    execFileSync("git", ["init", "-q"], { cwd: project });
    const ignored = (file: string): boolean => {
      try {
        execFileSync("git", ["check-ignore", "-q", file], { cwd: project });
        return true;
      } catch {
        return false;
      }
    };
    // The database with the files SQLite writes beside it, and the same name
    // at the root, where it lands if dev is started from elsewhere.
    for (const file of [
      path.relative(project, database),
      `${path.relative(project, database)}-journal`,
      `${path.relative(project, database)}-wal`,
      `${path.relative(project, database)}-shm`,
      path.basename(database),
    ]) {
      expect(ignored(file), file).toBe(true);
    }
  });

  // Next.js looks for the start-up hook beside app/, which is under src/ here;
  // anywhere else, `next build` never runs it.
  it("puts the start-up hook beside the playground's app directory", async () => {
    expect(await exists(path.join(project, "dev/src/app"))).toBe(true);
    expect(await exists(path.join(project, "dev/src/instrumentation.ts"))).toBe(
      true
    );
    expect(await exists(path.join(project, "dev/instrumentation.ts"))).toBe(
      false
    );
  });

  // The playground's start-up hook, which creates the auto-login user, is run
  // rather than read in plugin-playground-seed.test.ts.

  /*
   * The declaration in the new package's package.json, and the test that
   * keeps it in step with the plugin's code, run as the author runs them:
   * vitest in the project, importing the SDK and `nextly` the project would
   * install, linked from this checkout's built packages. Each edit an author
   * might make to one side alone fails that test, naming what to change.
   */
  describe("the plugin's declaration", () => {
    const linked = [
      ["nextly", path.resolve(templatesRoot, "../packages/nextly")],
      [
        "@nextlyhq/plugin-sdk",
        path.resolve(templatesRoot, "../packages/plugin-sdk"),
      ],
      ["vitest", path.dirname(requireFromHere.resolve("vitest/package.json"))],
    ] as const;
    let manifest = "";

    beforeAll(async () => {
      for (const [name, source] of linked) {
        const at = path.join(project, "node_modules", name);
        await mkdir(path.dirname(at), { recursive: true });
        await symlink(source, at, "junction");
      }
      manifest = await read("package.json");
    });
    afterEach(async () => {
      await writeFile(path.join(project, "package.json"), manifest);
    });
    // The links point into this checkout. Each is removed on its own, as a
    // link, before the scaffold's folder is deleted, so that deletion never
    // walks through one into the packages it points at.
    afterAll(async () => {
      for (const [name] of linked) {
        await rm(path.join(project, "node_modules", name), { force: true });
      }
    });

    /** The project's declaration test, run by vitest in the project: its status and output. */
    function runDeclarationTest(): { status: number | null; output: string } {
      const run = spawnSync(
        process.execPath,
        [
          path.join(project, "node_modules/vitest/vitest.mjs"),
          "run",
          "src/declaration.test.ts",
        ],
        {
          cwd: project,
          encoding: "utf8",
          env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
        }
      );
      return { status: run.status, output: `${run.stdout}${run.stderr}` };
    }

    /** Rewrites the project's declaration through `edit`. */
    async function editDeclaration(
      edit: (declared: Record<string, unknown>) => void
    ): Promise<void> {
      const pkg = JSON.parse(manifest) as { nextly: Record<string, unknown> };
      edit(pkg.nextly);
      await writeFile(path.join(project, "package.json"), JSON.stringify(pkg));
    }

    it("says what the plugin needs, in the format and range its code uses", async () => {
      const pkg = JSON.parse(manifest) as {
        peerDependencies: Record<string, string>;
        nextly: Record<string, unknown>;
      };
      const plugin = parseFile("src/plugin.ts", await read("src/plugin.ts"));
      // The range `definePlugin` was rendered with, read from the call.
      const range = /nextly: "([^"]+)"/.exec(plugin.text)?.[1];
      expect(pkg.nextly).toEqual({
        format: 1,
        core: range,
        databases: ["postgresql", "mysql", "sqlite"],
        plugin: { export: "myPlugin", call: true },
        collections: ["examples"],
      });
      expect(pkg.nextly.core).toBe(pkg.peerDependencies.nextly);
    });

    it("passes its own declaration test as created", () => {
      const run = runDeclarationTest();
      expect(run.status, run.output).toBe(0);
      expect(run.output).toMatch(/1 passed/);
    }, 120_000);

    it.each<[string, (declared: Record<string, unknown>) => void, RegExp]>([
      [
        "a table the plugin does not define",
        declared => {
          declared.tables = ["examples_log"];
        },
        // vitest prints the sentence quoted, escaping its own quotes.
        /table \\?"examples_log\\?", which the plugin's definition does not have/,
      ],
      [
        "SQLite left out of the databases its suite runs on",
        declared => {
          declared.databases = ["postgresql", "mysql"];
        },
        /runs the plugin on sqlite, and the declaration's databases do not list it/,
      ],
      [
        "a format newer than this Nextly reads",
        declared => {
          declared.format = 99;
        },
        /format 99.*this format needs a newer Nextly/,
      ],
      [
        "an export the entry does not have",
        declared => {
          declared.plugin = { export: "myPlugn", call: true };
        },
        /It names the export myPlugn, which its entry does not have/,
      ],
    ])(
      "fails its declaration test with %s, naming it",
      async (_, edit, named) => {
        await editDeclaration(edit);
        const run = runDeclarationTest();
        expect(run.status, run.output).not.toBe(0);
        expect(run.output).toMatch(named);
      },
      120_000
    );
  });
});

/*
 * 🔴 The population is DISCOVERED, so a template added later is covered without
 * anyone remembering this file. The case above proves the scaffold pipeline
 * carries the plugin template's budget through to a real project; on its own it
 * says nothing about `base`, `blank`, `blog`, or whatever is added next, and
 * naming the one template that exists today is how the gap reopens.
 *
 * The rule turns on whether a template SHIPS TESTS, not on whether it ships a
 * config. Keying on the config leaves the worse case uncovered: a template that
 * adds a booting suite and no `vitest.config.ts` runs on vitest's 5s default,
 * which is the exact defect this guard exists for, and a config-keyed filter
 * would skip that directory silently while the one good template kept the
 * population non-empty.
 *
 * It is deliberately broader than "templates whose suite boots". Deciding which
 * suites boot means reading their source for a call, and a template that boots
 * through a helper would be missed. A generous timeout costs a passing suite
 * nothing, and every scaffold is a real project sooner or later.
 */
describe("every scaffold template budgets for a boot", () => {
  it("requires a budgeted vitest config in each template that ships tests", async () => {
    const entries = await readdir(templatesRoot, { withFileTypes: true });

    const withTests: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(templatesRoot, entry.name);
      if (await shipsTests(dir)) withTests.push(dir);
    }

    // An empty population would pass every assertion below without running one,
    // so it is refused rather than reported as a clean sweep.
    expect(withTests.length).toBeGreaterThan(0);

    for (const dir of withTests) {
      const name = path.basename(dir);
      const configPath = path.join(dir, "vitest.config.ts");

      expect(
        await exists(configPath),
        `templates/${name} ships tests but no vitest.config.ts, so its suite ` +
          "runs on vitest's defaults"
      ).toBe(true);

      const config = await resolvedConfigOf(configPath);

      /*
       * ⚠️ The precondition that makes the budget above authoritative. A Vite
       * plugin's `config` hook can contribute or override `test.testTimeout`,
       * and vitest merges that before running, so with a plugin present the
       * declared literal is no longer what the suite runs under. Resolving that
       * properly means vitest's own config loader, and `vite` is not resolvable
       * anywhere under this workspace's pnpm isolation. So the assertion states
       * its precondition instead of hoping for it: no plugins, therefore no
       * hook, therefore the declaration IS the resolved value. A template that
       * genuinely needs one has to revisit this.
       */
      expect(
        config.plugins ?? [],
        `templates/${name} declares vitest plugins, and a plugin's config hook ` +
          "can change the timeouts this asserts"
      ).toHaveLength(0);

      expect(
        config.test?.testTimeout,
        `templates/${name} has no testTimeout`
      ).toBeGreaterThanOrEqual(BOOT_BUDGET_MS);
      expect(
        config.test?.hookTimeout,
        `templates/${name} has no hookTimeout`
      ).toBeGreaterThanOrEqual(BOOT_BUDGET_MS);
    }
  });
});
