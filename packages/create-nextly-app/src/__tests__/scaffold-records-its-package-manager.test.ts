/**
 * A project runs on the version of the package manager that made it.
 *
 * Corepack picks the package manager's version from `packageManager` in
 * `package.json`, and with none uses its own default, so `yarn dlx
 * create-nextly-app` on Yarn 4.9.2 installed the new project with Yarn
 * 1.22.22. The launching command's user agent names the version the person
 * chose, so for pnpm and Yarn it is recorded before the first install.
 * An existing app that already chooses one, through `packageManager` or
 * `devEngines.packageManager`, keeps its choice, and npm, Bun and a user
 * agent naming no version add nothing.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig, PackageManager, ProjectType } from "../types";

const execa = vi.hoisted(() => vi.fn(async () => ({ stdout: "" })));
vi.mock("execa", () => ({ execa }));

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

const templates = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates"
);

const UA = {
  yarn4: "yarn/4.9.2 npm/? node/v24.21.0 darwin arm64",
  pnpm10: "pnpm/10.18.0 npm/? node/v24.21.0 darwin arm64",
  npm: "npm/10.9.0 node/v24.21.0 darwin arm64",
  bun: "bun/1.1.30 npm/? node/v24.21.0 darwin arm64",
  pnpmNoVersion: "pnpm npm/? node/v24.21.0 darwin arm64",
};

let workdir: string;

beforeEach(async () => {
  vi.resetModules();
  execa.mockClear();
  workdir = await mkdtemp(path.join(tmpdir(), "nextly-pm-version-"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ latest: "0.0.2-alpha.40", alpha: "0.0.2-alpha.40" }),
    }))
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(workdir, { recursive: true, force: true });
});

async function scaffold(
  projectType: ProjectType,
  packageManager: PackageManager,
  userAgent: string
): Promise<Record<string, unknown>> {
  vi.stubEnv("npm_config_user_agent", userAgent);
  const { copyTemplate } = await import("../utils/template");
  const target = path.join(workdir, "app");
  await copyTemplate({
    projectName: "app",
    projectType,
    targetDir: target,
    database: sqlite,
    packageManager,
    templateSource: {
      basePath: path.join(templates, "base"),
      templatePath: path.join(templates, projectType),
    },
    nextlySource: { kind: "release", cliVersion: "0.0.2-alpha.40" },
  });
  return JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
}

describe("a new project", () => {
  it.each([
    ["blank", "yarn", UA.yarn4, "yarn@4.9.2"],
    ["blank", "pnpm", UA.pnpm10, "pnpm@10.18.0"],
    ["blog", "yarn", UA.yarn4, "yarn@4.9.2"],
    ["plugin", "pnpm", UA.pnpm10, "pnpm@10.18.0"],
  ] as const)(
    "a %s project launched by %s records the version that launched it",
    async (projectType, pm, userAgent, expected) => {
      const pkg = await scaffold(projectType, pm, userAgent);

      expect(pkg.packageManager).toBe(expected);
    }
  );

  it.each([
    ["npm", UA.npm],
    ["bun", UA.bun],
    ["pnpm", UA.pnpmNoVersion],
  ] as const)(
    "launched by %s with this user agent, records none",
    async (pm, userAgent) => {
      const pkg = await scaffold("blank", pm, userAgent);

      expect(pkg).not.toHaveProperty("packageManager");
    }
  );
});

/** An existing app's folder, with this package.json, and what each install saw. */
async function existingApp(manifest: Record<string, unknown>): Promise<{
  dir: string;
  seenAtInstall: () => Promise<Array<Record<string, unknown>>>;
}> {
  const dir = path.join(workdir, "existing");
  await rm(dir, { recursive: true, force: true });
  await import("node:fs/promises").then(fs => fs.mkdir(dir));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(manifest, null, 2)
  );
  const seen: Array<Record<string, unknown>> = [];
  // The package.json as each install command found it.
  execa.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] === "add" || args[0] === "install") {
      seen.push(
        JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
      );
    }
    return { stdout: "" };
  });
  return { dir, seenAtInstall: async () => seen };
}

async function addNextly(
  dir: string,
  pm: PackageManager,
  userAgent: string
): Promise<string[]> {
  vi.stubEnv("npm_config_user_agent", userAgent);
  const { installDependencies } = await import("../installers/dependencies");
  return installDependencies(
    dir,
    { packageManager: pm } as Parameters<typeof installDependencies>[1],
    sqlite,
    { kind: "release", cliVersion: "0.0.2-alpha.40" },
    false
  );
}

describe("an existing app", () => {
  it("that chooses no package manager gets the launching one's version before the first install, and is told", async () => {
    const app = await existingApp({
      name: "app",
      dependencies: { next: "16.0.0" },
    });

    const notes = await addNextly(app.dir, "yarn", UA.yarn4);

    const seen = await app.seenAtInstall();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.packageManager).toBe("yarn@4.9.2");
    expect(notes.join("\n")).toContain("yarn@4.9.2");
  });

  // The app's own formatting is kept: Windows line endings, an inline array,
  // a trailing blank line. Only the one line is added.
  it("gets exactly one line added, its formatting otherwise untouched", async () => {
    const app = await existingApp({});
    const before =
      '{\r\n    "name": "app",\r\n    "files": ["dist", "src"],\r\n    "dependencies": { "next": "16.0.0" }\r\n}\r\n\r\n';
    await writeFile(path.join(app.dir, "package.json"), before);

    await addNextly(app.dir, "yarn", UA.yarn4);

    await expect(
      readFile(path.join(app.dir, "package.json"), "utf8")
    ).resolves.toBe(
      '{\r\n    "name": "app",\r\n    "files": ["dist", "src"],\r\n    "dependencies": { "next": "16.0.0" },\r\n    "packageManager": "yarn@4.9.2"\r\n}\r\n\r\n'
    );
  });

  it("that sets packageManager keeps it", async () => {
    const manifest = {
      name: "app",
      packageManager: "yarn@3.8.0",
      dependencies: { next: "16.0.0" },
    };
    const app = await existingApp(manifest);

    await addNextly(app.dir, "yarn", UA.yarn4);

    const after = JSON.parse(
      await readFile(path.join(app.dir, "package.json"), "utf8")
    );
    expect(after.packageManager).toBe("yarn@3.8.0");
  });

  it("that chooses one only through devEngines.packageManager keeps it, and gets no packageManager", async () => {
    const devEngines = {
      packageManager: { name: "yarn", version: "4.5.0" },
    };
    const app = await existingApp({
      name: "app",
      devEngines,
      dependencies: { next: "16.0.0" },
    });

    await addNextly(app.dir, "yarn", UA.yarn4);

    const after = JSON.parse(
      await readFile(path.join(app.dir, "package.json"), "utf8")
    );
    expect(after.devEngines).toEqual(devEngines);
    expect(after).not.toHaveProperty("packageManager");
  });

  // Corepack reads the closest package.json, so a field in a member would
  // override the workspace's own choice, or make one for it.
  it("that is a member of a workspace gets nothing written: the workspace root decides", async () => {
    const app = await existingApp({
      name: "app",
      dependencies: { next: "16.0.0" },
    });
    await import("node:fs/promises").then(fs =>
      fs.mkdir(path.join(workdir, ".git"))
    );
    await writeFile(
      path.join(workdir, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["existing"] })
    );

    await addNextly(app.dir, "yarn", UA.yarn4);

    const member = JSON.parse(
      await readFile(path.join(app.dir, "package.json"), "utf8")
    );
    expect(member).not.toHaveProperty("packageManager");
    const root = JSON.parse(
      await readFile(path.join(workdir, "package.json"), "utf8")
    );
    expect(root).not.toHaveProperty("packageManager");
  });

  // The user agent names an exact Yarn version, but pnpm installs this app:
  // recording Yarn would make Corepack refuse the pnpm that runs next.
  it("installed by pnpm but launched by Yarn gets nothing written", async () => {
    const app = await existingApp({
      name: "app",
      dependencies: { next: "16.0.0" },
    });

    await addNextly(app.dir, "pnpm", UA.yarn4);

    const after = JSON.parse(
      await readFile(path.join(app.dir, "package.json"), "utf8")
    );
    expect(after).not.toHaveProperty("packageManager");
  });

  it("installed by pnpm but reached through npx gets nothing written", async () => {
    // npm's user agent, while the app's lockfile makes pnpm the installer.
    const app = await existingApp({
      name: "app",
      dependencies: { next: "16.0.0" },
    });

    await addNextly(app.dir, "pnpm", UA.npm);

    const after = JSON.parse(
      await readFile(path.join(app.dir, "package.json"), "utf8")
    );
    expect(after).not.toHaveProperty("packageManager");
  });
});
