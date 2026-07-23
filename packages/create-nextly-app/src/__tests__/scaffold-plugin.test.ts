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
    // The native-build allowlist lives in pnpm-workspace.yaml, NOT the package.json
    // `pnpm` field (pnpm 11 ignores that field). Without this, `pnpm install` aborts
    // on better-sqlite3 (the dev playground's native dep) with ERR_PNPM_IGNORED_BUILDS.
    expect(pkg.pnpm).toBeUndefined();
    expect(await exists(path.join(target, "pnpm-workspace.yaml"))).toBe(true);
    const workspaceYaml = await readFile(
      path.join(target, "pnpm-workspace.yaml"),
      "utf-8"
    );
    expect(workspaceYaml).toContain("allowBuilds:");
    expect(workspaceYaml).toContain("better-sqlite3");

    // The dev playground must boot with zero manual steps: without dev/.env
    // the dialect defaults to postgresql and `next dev` aborts in the
    // instrumentation hook asking for DATABASE_URL. The scaffold
    // materializes the committed example env into the real one.
    expect(await exists(path.join(target, "dev/.env"))).toBe(true);
    const devEnv = await readFile(path.join(target, "dev/.env"), "utf-8");
    expect(devEnv).toContain("DB_DIALECT=sqlite");

    // /admin must render through QueryProvider — the admin's data hooks
    // resolve their QueryClient from it, and mounting RootLayout without it
    // crashes the page on first load ("No QueryClient set").
    const adminPage = await readFile(
      path.join(target, "dev/src/app/admin/[[...params]]/page.tsx"),
      "utf-8"
    );
    expect(adminPage).toContain("QueryProvider");
    expect(adminPage).toContain("ErrorBoundary");

    // The generated test must match the current harness + Direct API: the
    // harness applies plugin schema contributions itself (passing them again
    // via `collections` is a slug collision), and CRUD methods take a single
    // args object (`create({ collection, data })`, `findByID({ ... })`).
    const pluginTest = await readFile(
      path.join(target, "src/plugin.test.ts"),
      "utf-8"
    );
    expect(pluginTest).not.toContain("contributes?.collections");
    expect(pluginTest).toContain("findByID({");
    expect(pluginTest).toContain("create({");

    // The playground seeds the auto-login user at boot; without it the first
    // /admin visit dead-ends on the setup wizard despite devAutoLogin.
    const instrumentation = await readFile(
      path.join(target, "dev/instrumentation.ts"),
      "utf-8"
    );
    expect(instrumentation).toContain("seedSuperAdmin");

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
