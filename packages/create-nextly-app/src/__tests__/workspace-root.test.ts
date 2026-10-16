/**
 * Which package manager an app is installed with when it sits inside a
 * workspace, and where its build approvals go, against real directories.
 *
 * Only a workspace that lists the app speaks for it. A lockfile above an app
 * that is not a member belongs to some other project, and a workspace file
 * with no `packages` (the build allowlist a scaffold writes into a new
 * project) lists nothing; reading either as the app's switched the manager.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { approveNativeBuilds } from "../installers/native-build-approvals";
import { detectAppPackageManager, detectProject } from "../utils/detect";
import { NEXTLY_NATIVE_BUILD_DEPENDENCIES } from "../utils/template";

let repo: string;
const originalUserAgent = process.env.npm_config_user_agent;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "nextly-ws-"));
  // The repository's root bounds every walk, as in a real checkout.
  await mkdir(join(repo, ".git"));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
  else process.env.npm_config_user_agent = originalUserAgent;
});

const launchedBy = (manager: string) => {
  process.env.npm_config_user_agent = `${manager}/1.0.0 node/v24.21.0`;
};

async function file(relative: string, content: string): Promise<void> {
  const at = join(repo, relative);
  await mkdir(join(at, ".."), { recursive: true });
  await writeFile(at, content);
}

async function app(relative: string): Promise<string> {
  const dir = join(repo, relative);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("the package manager of an app inside a workspace", () => {
  it("is the workspace root's, from its lockfile", async () => {
    launchedBy("npm");
    await file("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    await file("pnpm-lock.yaml", "");

    expect(await detectAppPackageManager(await app("apps/web"))).toBe("pnpm");
  });

  it("is pnpm for a pnpm workspace listing it before its first install", async () => {
    launchedBy("npm");
    await file("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");

    expect(await detectAppPackageManager(await app("apps/web"))).toBe("pnpm");
  });

  it.each([
    ["npm", "package-lock.json", '{"workspaces":["apps/*"]}'],
    ["yarn", "yarn.lock", '{"workspaces":{"packages":["apps/*"]}}'],
    ["bun", "bun.lock", '{"workspaces":["apps/*"]}'],
  ])(
    "is %s for a package.json workspace with its lockfile",
    async (manager, lockfile, pkg) => {
      launchedBy("pnpm");
      await file("package.json", pkg);
      await file(lockfile, "");

      expect(await detectAppPackageManager(await app("apps/web"))).toBe(
        manager
      );
    }
  );

  it("follows ** across folders, and leaves out what a ! glob excludes", async () => {
    launchedBy("npm");
    await file(
      "pnpm-workspace.yaml",
      "packages:\n  - 'packages/**'\n  - '!packages/legacy/**'\n"
    );
    await file("pnpm-lock.yaml", "");

    expect(await detectAppPackageManager(await app("packages/a/web"))).toBe(
      "pnpm"
    );
    expect(
      await detectAppPackageManager(await app("packages/legacy/web"))
    ).toBe("npm");
  });
});

describe("the workspace globs", () => {
  // Package managers read these globs with a full matcher: braces, character
  // classes and extglobs list an app as surely as `*` does.
  it.each([
    ["apps/{web,admin}", "apps/admin"],
    ["apps/[wa]*", "apps/web"],
    ["apps/+(web|admin)", "apps/web"],
  ])("count %s as listing %s", async (glob, member) => {
    launchedBy("npm");
    await file("package.json", JSON.stringify({ workspaces: [glob] }));
    await file("bun.lock", "");

    expect(await detectAppPackageManager(await app(member))).toBe("bun");
    expect(await detectAppPackageManager(await app("apps/docs"))).toBe("npm");
  });
});

describe("an app no workspace lists", () => {
  it("keeps the launcher's manager under a project with a lockfile of its own", async () => {
    launchedBy("pnpm");
    await file("package.json", '{"name":"tools"}');
    await file("package-lock.json", "");

    expect(await detectAppPackageManager(await app("tools/web"))).toBe("pnpm");
  });

  it("keeps the launcher's manager under a workspace that lists other folders", async () => {
    launchedBy("npm");
    await file("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    await file("pnpm-lock.yaml", "");

    expect(await detectAppPackageManager(await app("apps/web"))).toBe("npm");
  });

  // A scaffold writes pnpm-workspace.yaml into every new project for its build
  // allowlist, whatever manager installs it. It lists no packages.
  it("keeps the launcher's manager beside a workspace file that lists nothing", async () => {
    launchedBy("npm");
    const web = await app("web");
    await writeFile(
      join(web, "pnpm-workspace.yaml"),
      "allowBuilds:\n  esbuild: true\n"
    );

    expect(await detectAppPackageManager(web)).toBe("npm");
  });

  it("never reads a workspace above the repository's root", async () => {
    launchedBy("npm");
    const outer = await mkdtemp(join(tmpdir(), "nextly-outer-"));
    try {
      await writeFile(
        join(outer, "pnpm-workspace.yaml"),
        "packages:\n  - '**'\n"
      );
      await writeFile(join(outer, "pnpm-lock.yaml"), "");
      const inner = join(outer, "repo");
      await mkdir(join(inner, ".git"), { recursive: true });
      await mkdir(join(inner, "apps", "web"), { recursive: true });

      expect(await detectAppPackageManager(join(inner, "apps", "web"))).toBe(
        "npm"
      );
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });
});

describe("detectProject", () => {
  // A new project's manager was chosen before its files were written, from
  // the command that launched the scaffold; reading the written files again
  // must not change it.
  it("keeps a manager already chosen", async () => {
    launchedBy("npm");
    await file("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    await file("pnpm-lock.yaml", "");
    const web = await app("apps/web");
    await writeFile(
      join(web, "package.json"),
      '{"dependencies":{"next":"16.0.0"}}'
    );
    await mkdir(join(web, "app"));

    expect((await detectProject(web, "npm")).packageManager).toBe("npm");
    expect((await detectProject(web)).packageManager).toBe("pnpm");
  });
});

describe("where an app's build approvals go", () => {
  it("stays in the app when the workspace above does not list it", async () => {
    await file("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    const web = await app("apps/web");

    await approveNativeBuilds(web, "pnpm", "12.5.1");

    expect(await readFile(join(repo, "pnpm-workspace.yaml"), "utf8")).toBe(
      "packages:\n  - packages/*\n"
    );
    // The app's own file must hold the approvals, or its install still stops.
    const local: unknown = parse(
      await readFile(join(web, "pnpm-workspace.yaml"), "utf8")
    );
    expect(local).toMatchObject({
      allowBuilds: Object.fromEntries(
        NEXTLY_NATIVE_BUILD_DEPENDENCIES.map(dep => [dep, true])
      ),
    });
  });
});
