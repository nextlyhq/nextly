import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
    const scaffoldedConfig = (await import(
      /* @vite-ignore */ path.join(target, "vitest.config.ts")
    )) as {
      default: { test?: { testTimeout?: number; hookTimeout?: number } };
    };
    const budget = scaffoldedConfig.default.test;

    // Both, because the boot is in a hook and the case body is not, and vitest
    // budgets the two separately.
    expect(budget?.testTimeout).toBeGreaterThanOrEqual(30_000);
    expect(budget?.hookTimeout).toBeGreaterThanOrEqual(30_000);
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
