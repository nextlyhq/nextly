import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

    // peerDependencies must never carry a dist-tag name (latest, alpha, …):
    // pnpm 11 rejects non-semver peer specs
    // (ERR_PNPM_INVALID_PEER_DEPENDENCY_SPECIFICATION) and then refuses to
    // run any script in the scaffold. This test runs with the registry
    // stubbed offline, so every version lookup exercises the fallback path —
    // exactly where a dist-tag used to leak in. The generator only ever
    // emits `^x.y.z(-prerelease)?` or the open `>=x.y.z` fallback, so the
    // anchored pattern validates the complete spec — partial matches would
    // wave through hybrids like `^latest` or `>=alpha`.
    for (const [peer, spec] of Object.entries(
      pkg.peerDependencies as Record<string, string>
    )) {
      expect(spec, `peerDependencies.${peer}`).toMatch(
        /^(?:\^|>=)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
      );
    }
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
    // Registry scaffolds resolve everything from npm — the yalc override
    // block must never leak into them.
    expect(workspaceYaml).not.toContain("overrides:");

    // The dev playground must boot with zero manual steps: without dev/.env
    // the dialect defaults to postgresql and `next dev` aborts in the
    // instrumentation hook asking for DATABASE_URL. The scaffold
    // materializes the committed example env into the real one.
    expect(await exists(path.join(target, "dev/.env"))).toBe(true);
    const devEnv = await readFile(path.join(target, "dev/.env"), "utf-8");
    expect(devEnv).toContain("DB_DIALECT=sqlite");

    // The ignore rules must land — the materialized dev/.env (dev
    // credentials) is only safe because .gitignore excludes it.
    expect(await exists(path.join(target, ".gitignore"))).toBe(true);

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
    // /admin visit dead-ends on the setup wizard despite devAutoLogin. The
    // seed must run twice: the runtime's background permission seeding races
    // the first pass, and the second pass (role-exists path) tops up any
    // permissions created in between so the role is complete either way.
    const instrumentation = await readFile(
      path.join(target, "dev/instrumentation.ts"),
      "utf-8"
    );
    expect(instrumentation).toContain("seedSuperAdmin");
    expect(instrumentation.match(/await seedDevUser\(\)/g)).toHaveLength(2);
    // Credential seeding must be locked to `next dev` — a broader guard
    // (e.g. !== "production") would also seed under NODE_ENV=test.
    expect(instrumentation).toContain('process.env.NODE_ENV === "development"');

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

  it("pins yalc scaffolds' nested resolutions to the local store", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-yalc-"));
    target = path.join(workdir, "my-plugin");

    await copyTemplate({
      projectName: "yalc-plugin",
      projectType: "plugin",
      targetDir: target,
      database: { type: "sqlite" } as unknown as DatabaseConfig,
      useYalc: true,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "plugin"),
      },
    });

    // Yalc rewrites workspace:* ranges to *, which semver treats as
    // stable-only — without an overrides pin, pnpm resolves the packages'
    // nested copies of each other from the registry's last stable release
    // and the mixed versions crash at runtime.
    const workspaceYaml = await readFile(
      path.join(target, "pnpm-workspace.yaml"),
      "utf-8"
    );
    expect(workspaceYaml).toContain("overrides:");
    expect(workspaceYaml).toContain('"nextly": "file:.yalc/nextly"');
    expect(workspaceYaml).toContain(
      '"@nextlyhq/plugin-sdk": "file:.yalc/@nextlyhq/plugin-sdk"'
    );
    expect(workspaceYaml).toContain(
      '"@nextlyhq/adapter-drizzle": "file:.yalc/@nextlyhq/adapter-drizzle"'
    );
  });

  it("restores .gitignore from the publish-safe bundled name", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-packed-"));
    target = path.join(workdir, "my-plugin");

    // Simulate the layout the PUBLISHED CLI carries: npm's packer strips
    // dotted .gitignore files from tarballs, so the build stores them as
    // `gitignore` (see tsup.config.ts) and the scaffolder renames them back.
    const packedTemplate = path.join(workdir, "packed-template");
    await cp(path.join(templatesRoot, "plugin"), packedTemplate, {
      recursive: true,
    });
    await rename(
      path.join(packedTemplate, ".gitignore"),
      path.join(packedTemplate, "gitignore")
    );

    await copyTemplate({
      projectName: "packed-plugin",
      projectType: "plugin",
      targetDir: target,
      database: { type: "sqlite" } as unknown as DatabaseConfig,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: packedTemplate,
      },
    });

    // The dotted file is restored with its rules intact, and the transport
    // name does not leak into the scaffold.
    const gitignore = await readFile(path.join(target, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules");
    expect(gitignore).toContain(".env");
    expect(await exists(path.join(target, "gitignore"))).toBe(false);
  });

  it("merges into a pre-existing .gitignore instead of replacing it", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-overlay-"));
    target = path.join(workdir, "my-plugin");

    const packedTemplate = path.join(workdir, "packed-template");
    await cp(path.join(templatesRoot, "plugin"), packedTemplate, {
      recursive: true,
    });
    await rename(
      path.join(packedTemplate, ".gitignore"),
      path.join(packedTemplate, "gitignore")
    );

    // Overlay scenario: the user chose "ignore" on a non-empty directory
    // that already carries their own ignore rules. Restoration must keep
    // them — a rename would silently un-ignore whatever they covered.
    await mkdir(target, { recursive: true });
    await writeFile(
      path.join(target, ".gitignore"),
      "# user rules\nmy-secret.txt\n",
      "utf-8"
    );

    await copyTemplate({
      projectName: "overlay-plugin",
      projectType: "plugin",
      targetDir: target,
      database: { type: "sqlite" } as unknown as DatabaseConfig,
      allowExistingTarget: true,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: packedTemplate,
      },
    });

    const gitignore = await readFile(path.join(target, ".gitignore"), "utf-8");
    // User rules survive AND the template's required rules (dev/.env!) land.
    expect(gitignore).toContain("my-secret.txt");
    expect(gitignore).toContain("node_modules");
    expect(gitignore).toContain(".env");
    expect(await exists(path.join(target, "gitignore"))).toBe(false);
  });
});
