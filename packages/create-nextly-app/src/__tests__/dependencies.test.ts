/**
 * Tests for dependency installation.
 *
 * The yalc paths link local `@nextlyhq/*` builds instead of installing them
 * from the registry, so they carry their own package list. Anything the
 * generated project needs from npm has to be installed separately there:
 * `@nextlyhq/ui` declares `lucide-react` as a peer and admin externalises
 * `@tanstack/react-query`, and neither can come from the yalc store, so a yalc
 * install that only runs `yalc add` leaves those peers unresolved.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installDependencies } from "../installers/dependencies";
import type { NextlySource } from "../lib/nextly-release";
import type { DatabaseConfig, ProjectInfo } from "../types";

const execa = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: "" }));
vi.mock("execa", () => ({ execa }));

// The approvals write real files; their behaviour has its own test. Here only
// whether, and when, the installer asks for them matters.
const approveNativeBuilds = vi.hoisted(() =>
  vi.fn().mockResolvedValue(["Approved the build scripts of esbuild."])
);
vi.mock("../installers/native-build-approvals", () => ({
  approveNativeBuilds,
}));

const projectInfo = { packageManager: "pnpm" } as ProjectInfo;
// Where the Nextly packages come from: linked local builds, or a release.
const YALC: NextlySource = { kind: "yalc", cliVersion: "0.0.2-alpha.40" };
const RELEASE: NextlySource = { kind: "release", cliVersion: "0.0.2-alpha.40" };
const database = { adapter: "@nextlyhq/adapter-postgres" } as DatabaseConfig;

/** Every package name passed to the package manager across all calls. */
function installedFromRegistry(): string[] {
  return execa.mock.calls
    .filter(([cmd]) => cmd === "pnpm")
    .flatMap(([, args]: [string, string[]]) => args)
    .filter(arg => arg !== "add" && arg !== "install");
}

/** Every package handed to `yalc add`. */
function linkedViaYalc(): string[] {
  return execa.mock.calls
    .filter(([cmd]) => cmd === "yalc")
    .map(([, args]: [string, string[]]) => args[1]);
}

describe("installDependencies (existing project)", () => {
  beforeEach(() => {
    execa.mockClear();
  });

  it("installs the registry-only packages when linking with yalc", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      YALC,
      /* isFreshProject */ false
    );

    // These cannot come from the yalc store; without them @nextlyhq/ui's peer
    // is unresolved and its icons fail to resolve.
    expect(installedFromRegistry()).toContain("lucide-react");
    expect(installedFromRegistry()).toContain("@tanstack/react-query");
  });

  it("does not try to yalc-link registry packages", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      YALC,
      false
    );

    expect(linkedViaYalc()).not.toContain("lucide-react");
    expect(linkedViaYalc()).not.toContain("@tanstack/react-query");
    // The local builds still come from yalc.
    expect(linkedViaYalc()).toContain("@nextlyhq/ui");
  });

  it("installs everything from the registry without yalc", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      RELEASE,
      false
    );

    // Nextly's packages at the release, recorded exactly (npm would record
    // `nextly@X` as `^X`); the others as before, at what the registry has.
    const adds = execa.mock.calls
      .filter(
        ([cmd, args]: [string, string[]]) => cmd === "pnpm" && args[0] === "add"
      )
      .map(([, args]: [string, string[]]) => args.slice(1));
    expect(adds).toContainEqual([
      "--save-exact",
      "nextly@0.0.2-alpha.40",
      "@nextlyhq/admin@0.0.2-alpha.40",
      "@nextlyhq/adapter-drizzle@0.0.2-alpha.40",
      "@nextlyhq/ui@0.0.2-alpha.40",
      "@nextlyhq/adapter-postgres@0.0.2-alpha.40",
    ]);
    expect(adds).toContainEqual(["@tanstack/react-query", "lucide-react"]);
    expect(execa.mock.calls.filter(([cmd]) => cmd === "yalc")).toHaveLength(0);
  });
});

describe("installDependencies (existing project, a source given on purpose)", () => {
  beforeEach(() => {
    execa.mockClear();
  });

  // --local-template on an existing app takes the active release line, by
  // its tag, recorded as the package manager records a tag.
  it("adds Nextly's packages from the alpha tag, not pinned", async () => {
    await installDependencies(
      "/tmp/project",
      projectInfo,
      database,
      { kind: "alpha", cliVersion: "0.0.2-alpha.40" },
      false
    );

    const adds = execa.mock.calls
      .filter(
        ([cmd, args]: [string, string[]]) => cmd === "pnpm" && args[0] === "add"
      )
      .map(([, args]: [string, string[]]) => args.slice(1));
    expect(adds).toContainEqual(expect.arrayContaining(["nextly@alpha"]));
    expect(adds.flat()).not.toContain("--save-exact");
  });
});

describe("installDependencies (existing project, what reading the config needs)", () => {
  beforeEach(() => {
    execa.mockReset();
    execa.mockResolvedValue({ stdout: "" });
    approveNativeBuilds.mockClear();
  });

  // A failing install below replaces execa's implementation; the next block
  // must start from a working one.
  afterEach(() => {
    execa.mockReset();
    execa.mockResolvedValue({ stdout: "" });
  });

  const run = (packageManager: ProjectInfo["packageManager"]) =>
    installDependencies(
      "/tmp/project",
      { packageManager } as ProjectInfo,
      database,
      RELEASE,
      false
    );

  // `nextly` takes esbuild as an optional peer, so nothing installs it for the
  // app. npm then left it nested under drizzle-kit, where Nextly cannot load
  // it, and `nextly.config.ts` was never read.
  it.each([
    ["npm", ["install", "--save-dev"]],
    ["pnpm", ["add", "--save-dev"]],
    ["yarn", ["add", "--dev"]],
    ["bun", ["add", "--dev"]],
  ] as const)(
    "installs esbuild as a dev dependency of the app with %s",
    async (pm, devArgs) => {
      await run(pm);

      const devInstall = execa.mock.calls.find(
        ([cmd, args]: [string, string[]]) =>
          cmd === pm && args.some(arg => arg.startsWith("esbuild"))
      );
      expect(devInstall?.[1].slice(0, devArgs.length)).toEqual([...devArgs]);
      expect(devInstall?.[1]).toContain("esbuild@^0.28.1");
    }
  );

  // An app may already require esbuild itself, in dependencies when production
  // runs migrations on boot. A --save-dev install would move it to
  // devDependencies, where a production install omits it.
  it("leaves an esbuild the app already declares as it is", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nextly-deps-"));
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { esbuild: "^0.25.0" } }) + "\n"
      );

      await installDependencies(
        dir,
        { packageManager: "npm" } as ProjectInfo,
        database,
        RELEASE,
        false
      );

      expect(
        execa.mock.calls.some(([, args]: [string, string[]]) =>
          args.some(arg => arg.startsWith("esbuild"))
        )
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["pnpm", "bun"] as const)(
    "approves %s's native builds before anything is installed",
    async pm => {
      await run(pm);

      // `pnpm --version` printed nothing here, so the version is unknown.
      expect(approveNativeBuilds).toHaveBeenCalledWith(
        "/tmp/project",
        pm,
        undefined
      );
      const approvedAt = approveNativeBuilds.mock.invocationCallOrder[0];
      const firstAddAt =
        execa.mock.invocationCallOrder[
          execa.mock.calls.findIndex(
            ([, args]: [string, string[]]) => args[0] === "add"
          )
        ];
      expect(approvedAt).toBeLessThan(firstAddAt);
    }
  );

  it("returns what the approvals changed, so the caller can say it", async () => {
    expect(await run("pnpm")).toEqual([
      "Approved the build scripts of esbuild.",
    ]);
  });

  it("asks pnpm for its version only on pnpm", async () => {
    await run("npm");

    expect(approveNativeBuilds).toHaveBeenCalledWith(
      "/tmp/project",
      "npm",
      undefined
    );
    expect(execa.mock.calls.some(([cmd]: [string]) => cmd === "pnpm")).toBe(
      false
    );
  });

  it("names the command to run when the install fails", async () => {
    execa.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "add") {
        throw Object.assign(new Error("Command failed with exit code 1"), {
          shortMessage: "Command failed with exit code 1: pnpm add nextly",
        });
      }
      return { stdout: "" };
    });

    await expect(run("pnpm")).rejects.toThrow(/pnpm add .*nextly/);
    await expect(run("pnpm")).rejects.toThrow(/run create-nextly-app again/i);
  });

  // What the approvals changed or kept is printed after a successful install;
  // a failed one must carry it, since a kept version-scoped rule is exactly
  // what makes pnpm stop.
  it("carries what the approvals said into a failed install's message", async () => {
    approveNativeBuilds.mockResolvedValueOnce([
      "Kept the app's own esbuild@0.28.1 rule.",
    ]);
    execa.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "add") throw new Error("ERR_PNPM_IGNORED_BUILDS");
      return { stdout: "" };
    });

    await expect(run("pnpm")).rejects.toThrow(
      /Kept the app's own esbuild@0\.28\.1 rule\./
    );
  });
});

describe("installDependencies (fresh plugin scaffold)", () => {
  beforeEach(() => {
    execa.mockClear();
  });

  // The plugin imports @nextlyhq/plugin-sdk directly. Linking the rest of the
  // family from yalc but not the SDK pairs local packages with the published
  // SDK, so an unpublished SDK change cannot be tried in the scaffold.
  it("links @nextlyhq/plugin-sdk from yalc", async () => {
    await installDependencies(
      "/tmp/plugin",
      projectInfo,
      database,
      YALC,
      /* isFreshProject */ true,
      "plugin"
    );

    expect(linkedViaYalc()).toContain("@nextlyhq/plugin-sdk");
    expect(linkedViaYalc()).toContain("nextly");
  });

  // The blog registers the form builder, whose peer @nextlyhq/plugin-sdk Yarn
  // never installs on its own. A yalc scaffold omits both from package.json
  // and relies on this install to link them, so both have to be linked here.
  it("links the form builder and its plugin-sdk peer for the blog", async () => {
    await installDependencies(
      "/tmp/blog",
      projectInfo,
      database,
      YALC,
      /* isFreshProject */ true,
      "blog"
    );

    expect(linkedViaYalc()).toContain("@nextlyhq/plugin-form-builder");
    expect(linkedViaYalc()).toContain("@nextlyhq/plugin-sdk");
  });

  it("leaves the app scaffold's yalc set unchanged", async () => {
    await installDependencies(
      "/tmp/app",
      projectInfo,
      database,
      YALC,
      true,
      "blank"
    );

    expect(linkedViaYalc()).not.toContain("@nextlyhq/plugin-sdk");
  });
});
