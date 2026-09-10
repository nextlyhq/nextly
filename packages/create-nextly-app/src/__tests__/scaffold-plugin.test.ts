import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import { copyTemplate } from "../utils/template";

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

    // The UI kit is a HOST peer, not a bundled dependency. tsup externalises
    // peers automatically and bundles devDependencies, so declaring it only as
    // a devDependency ships a second copy of the whole kit inside every
    // published plugin.
    expect(pkg.peerDependencies["@nextlyhq/ui"]).toBeTruthy();

    const tsup = await readFile(path.join(target, "tsup.config.ts"), "utf-8");
    expect(tsup).toContain('"@nextlyhq/ui"');
    // The native-build allowlist lives in pnpm-workspace.yaml, NOT the package.json
    // `pnpm` field (pnpm 11 ignores that field). Without this, `pnpm install` aborts
    // on better-sqlite3 (the dev playground's native dep) with ERR_PNPM_IGNORED_BUILDS.
    expect(pkg.pnpm).toBeUndefined();

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
