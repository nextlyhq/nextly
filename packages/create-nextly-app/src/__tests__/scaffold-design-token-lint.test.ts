/**
 * The scaffolded plugin must REJECT a design-token violation in its own repo.
 *
 * Everything else about this feature is arrangement — a dependency in a
 * manifest, a spread in a config — and each of those can be present while the
 * author's `pnpm lint` still passes on a fixed palette colour. This asserts the
 * outcome instead: take the template as a user receives it, put a violation in
 * it, and require the lint to fail.
 *
 * ESLint is driven directly with the workspace plugin rather than through an
 * install, because a test that installed from npm would assert the registry's
 * current contents rather than this repository's. What it therefore does NOT
 * cover is dependency RESOLUTION — that the version the scaffold writes exists
 * and carries these rules. `scaffold-plugin.test.ts` pins the written range;
 * the registry is the remaining gap and is checked at release time.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import tsParser from "@typescript-eslint/parser";
import nextlyPlugin from "@nextlyhq/eslint-plugin";
import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate } from "../utils/template";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, "../../../../templates");

/** The rules as the scaffolded config mounts them, applied to a scaffolded tree. */
async function lintScaffold(dir: string) {
  const eslint = new ESLint({
    cwd: dir,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            ecmaFeatures: { jsx: true },
          },
        },
        plugins: { "@nextlyhq": nextlyPlugin },
        rules: {
          "@nextlyhq/no-palette-classes": "error",
          "@nextlyhq/no-hardcoded-colors": "error",
          "@nextlyhq/no-static-inline-style": "error",
        },
      },
    ],
  });
  return eslint.lintFiles(["src/**/*.{ts,tsx}"]);
}

describe("a scaffolded plugin enforces the design-token rules", () => {
  let workdir: string;
  let target: string;

  beforeAll(() => {
    // Offline: version resolution falls back, and this suite asserts behaviour
    // rather than which version string was written.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  afterEach(async () => {
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  async function scaffold() {
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
    return target;
  }

  it("wires the rules into the manifest it ships", async () => {
    const dir = await scaffold();
    const pkg = JSON.parse(
      await readFile(path.join(dir, "package.json"), "utf8")
    ) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies["@nextlyhq/eslint-plugin"]).toBeTruthy();
  });

  it("the shipped eslint config actually mounts the three rules", async () => {
    // The template's own config is EVALUATED rather than read as text. A string
    // check passes on an import that is never spread into the exported array —
    // which is precisely how one of these rules shipped inert in this repo
    // before. Evaluating it asks what ESLint would be given.
    const shipped = (await import(
      path.join(templatesRoot, "plugin/eslint.config.mjs")
    )) as { default: Array<{ rules?: Record<string, unknown> }> };

    const rules = Object.assign(
      {},
      ...shipped.default.map(entry => entry.rules ?? {})
    ) as Record<string, unknown>;

    expect(rules["@nextlyhq/no-palette-classes"]).toBe("error");
    expect(rules["@nextlyhq/no-hardcoded-colors"]).toBe("error");
    expect(rules["@nextlyhq/no-static-inline-style"]).toBe("error");
  });

  it("passes on the template as shipped", async () => {
    const dir = await scaffold();
    const results = await lintScaffold(dir);

    // Asserted before the verdict: zero violations over zero files is the same
    // output as a conforming template, so this separates them.
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.filePath.endsWith("SettingsPage.tsx"))).toBe(
      true
    );
    expect(results.flatMap(r => r.messages)).toEqual([]);
  });

  it("FAILS when the author writes a fixed palette colour", async () => {
    const dir = await scaffold();
    const page = path.join(dir, "src/admin/SettingsPage.tsx");
    const source = await readFile(page, "utf8");
    await writeFile(
      page,
      source.replace('className="w-full', 'className="bg-red-500 w-full')
    );

    const messages = (await lintScaffold(dir)).flatMap(r => r.messages);
    expect(messages.map(m => m.ruleId)).toContain(
      "@nextlyhq/no-palette-classes"
    );
  });

  it("FAILS when the author writes an all-constant inline style", async () => {
    const dir = await scaffold();
    const page = path.join(dir, "src/admin/SettingsPage.tsx");
    const source = await readFile(page, "utf8");
    await writeFile(
      page,
      source.replace("<header ", "<header style={{ padding: 24 }} ")
    );

    const messages = (await lintScaffold(dir)).flatMap(r => r.messages);
    expect(messages.map(m => m.ruleId)).toContain(
      "@nextlyhq/no-static-inline-style"
    );
  });
});
