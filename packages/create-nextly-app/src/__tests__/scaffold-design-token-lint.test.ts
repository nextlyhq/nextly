/**
 * The scaffolded plugin must REJECT a design-token violation in its own repo.
 *
 * Everything else about this feature is arrangement — a dependency in a
 * manifest, a spread in a config — and each of those can be present while the
 * author's `pnpm lint` still passes on a fixed palette colour. This asserts the
 * outcome instead: take the template as a user receives it, put a violation in
 * it, and require the lint to fail.
 *
 * The lint runs as the author's does: the template's own `eslint.config.mjs`,
 * with the lint packages the scaffold's manifest declares, installed from npm
 * into the scaffold at the ranges it writes. `@nextlyhq/eslint-plugin` alone is
 * this repository's, packed from the workspace, so the rules under test are the
 * ones in this checkout rather than the registry's. ESLint and typescript-eslint
 * therefore stay out of this workspace: they are the template's dependencies,
 * not Nextly's.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, "../../../../templates");
const eslintPluginDir = path.resolve(here, "../../../eslint-plugin");

/** The lint packages the scaffold declares; `@nextlyhq/eslint-plugin` comes from the workspace instead. */
const LINT_PACKAGES = [
  "eslint",
  "@eslint/js",
  "typescript-eslint",
  "typescript",
];

/** One ESLint result as `--format json` prints it. */
type LintResult = {
  filePath: string;
  messages: { ruleId: string | null; message: string }[];
};

let workdir: string;
let target: string;
let manifest: { devDependencies: Record<string, string> };
const page = () => path.join(target, "src/admin/SettingsPage.tsx");
let pageSource: string;

/** The scaffold's own ESLint, run on its `src` with its own config. */
function lintScaffold(): LintResult[] {
  const run = spawnSync(
    process.execPath,
    [
      path.join(target, "node_modules/eslint/bin/eslint.js"),
      "--format",
      "json",
      "src",
    ],
    { cwd: target, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 }
  );
  // 0 is clean and 1 is "violations found"; anything else is ESLint failing to run.
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(`eslint exited ${run.status}: ${run.stderr}`);
  }
  return JSON.parse(run.stdout) as LintResult[];
}

describe("a scaffolded plugin enforces the design-token rules", () => {
  beforeAll(async () => {
    // Offline for the scaffold itself: version resolution falls back, and this
    // suite asserts behaviour rather than which version string was written.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-lint-"));
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
    vi.unstubAllGlobals();
    manifest = JSON.parse(
      await readFile(path.join(target, "package.json"), "utf8")
    );
    pageSource = await readFile(page(), "utf8");

    // The workspace plugin as npm would ship it.
    execFileSync("pnpm", ["pack", "--pack-destination", workdir], {
      cwd: eslintPluginDir,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    const tarball = (await readdir(workdir)).find(name =>
      name.endsWith(".tgz")
    );
    if (!tarball)
      throw new Error("pnpm pack wrote no tarball for @nextlyhq/eslint-plugin");

    // Only the lint packages, at the scaffold's own ranges. The full manifest
    // would install the plugin's runtime too, which this lint does not load.
    // The ranges go in the manifest rather than on npm's command line: on
    // Windows npm runs through cmd.exe, which reads `^` as its escape
    // character and drops it, so `typescript-eslint@^8.0.0` would install
    // 8.0.0 exactly, a release that cannot load its rules under ESLint 9.
    const devDependencies = Object.fromEntries([
      ...LINT_PACKAGES.map(name => [name, manifest.devDependencies[name]]),
      ["@nextlyhq/eslint-plugin", `file:${path.join(workdir, tarball)}`],
    ]);
    await writeFile(
      path.join(target, "package.json"),
      JSON.stringify({
        name: "lint-under-test",
        private: true,
        type: "module",
        devDependencies,
      })
    );
    execFileSync(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--no-package-lock",
      ],
      { cwd: target, stdio: "ignore", shell: process.platform === "win32" }
    );
  }, 300_000);

  afterEach(async () => {
    await writeFile(page(), pageSource);
  });
  afterAll(async () => {
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  it("declares every package its lint needs", () => {
    for (const name of [...LINT_PACKAGES, "@nextlyhq/eslint-plugin"]) {
      expect(manifest.devDependencies[name], name).toBeTruthy();
    }
  });

  it("the shipped eslint config actually mounts the three rules", () => {
    // What ESLint itself would apply to the file, rather than the config's
    // text: a string check passes on an import that is never spread into the
    // exported array, which is how one of these rules once shipped inert.
    const printed = execFileSync(
      process.execPath,
      [
        path.join(target, "node_modules/eslint/bin/eslint.js"),
        "--print-config",
        "src/admin/SettingsPage.tsx",
      ],
      { cwd: target, encoding: "utf8" }
    );
    const rules = (JSON.parse(printed) as { rules: Record<string, unknown> })
      .rules;
    for (const rule of [
      "@nextlyhq/no-palette-classes",
      "@nextlyhq/no-hardcoded-colors",
      "@nextlyhq/no-static-inline-style",
    ]) {
      expect(rules[rule], rule).toEqual([2]);
    }
  });

  it("passes on the template as shipped", () => {
    const results = lintScaffold();
    // Asserted before the verdict: zero violations over zero files is the same
    // output as a conforming template, so this separates them.
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.filePath.endsWith("SettingsPage.tsx"))).toBe(
      true
    );
    expect(results.flatMap(r => r.messages)).toEqual([]);
  });

  it("FAILS when the author writes a fixed palette colour", async () => {
    await writeFile(
      page(),
      pageSource.replace('className="w-full', 'className="bg-red-500 w-full')
    );
    const ruleIds = lintScaffold().flatMap(r => r.messages.map(m => m.ruleId));
    expect(ruleIds).toContain("@nextlyhq/no-palette-classes");
  });

  it("FAILS when the author writes an all-constant inline style", async () => {
    await writeFile(
      page(),
      pageSource.replace("<header ", "<header style={{ padding: 24 }} ")
    );
    const ruleIds = lintScaffold().flatMap(r => r.messages.map(m => m.ruleId));
    expect(ruleIds).toContain("@nextlyhq/no-static-inline-style");
  });
});
