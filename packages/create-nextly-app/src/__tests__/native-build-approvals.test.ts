/**
 * Adding Nextly to an existing pnpm app must approve the build scripts of the
 * native packages Nextly installs, in the place the app's pnpm reads them,
 * BEFORE the install runs: pnpm 11 and later refuse the install outright while
 * one is unapproved, so the generator stopped with no config or routes written.
 *
 * Each case runs against a real temporary directory, because what matters is
 * the file the project ends up with: its own settings, choices and comments
 * must survive, and only Nextly's packages may change.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { approveNativeBuilds } from "../installers/native-build-approvals";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-pnpm-builds-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const workspaceFile = () => join(dir, "pnpm-workspace.yaml");
const readWorkspace = async () =>
  parse(await readFile(workspaceFile(), "utf8")) as Record<string, unknown>;

// The file create-next-app 16.4.2 writes for a pnpm app (seen 2026-10-16),
// with a comment of the project's own added so its survival is observable.
const CREATE_NEXT_APP_WORKSPACE = `# project note: keep this
allowBuilds:
  sharp: false
  unrs-resolver: false
minimumReleaseAgeExclude:
  - '@next/env@16.4.2'
  - next@16.4.2
`;

describe("approveNativeBuilds on pnpm 11 and later", () => {
  it("adds Nextly's packages to the app's existing allowBuilds map, keeping everything else", async () => {
    await writeFile(workspaceFile(), CREATE_NEXT_APP_WORKSPACE);

    const notes = await approveNativeBuilds(dir, "pnpm", "12.5.1");

    const written = await readFile(workspaceFile(), "utf8");
    const yaml = await readWorkspace();
    expect(yaml.allowBuilds).toEqual({
      sharp: false,
      "unrs-resolver": false,
      "better-sqlite3": true,
      esbuild: true,
    });
    // The project's own settings and comment are untouched.
    expect(yaml.minimumReleaseAgeExclude).toEqual([
      "@next/env@16.4.2",
      "next@16.4.2",
    ]);
    expect(written).toContain("# project note: keep this");
    // Only the packages it approved are listed for pnpm 10.6+, never one the
    // app set to false.
    expect(yaml.onlyBuiltDependencies).toEqual(["better-sqlite3", "esbuild"]);
    // It says what it changed, and what it left.
    expect(notes.join("\n")).toMatch(/better-sqlite3.*esbuild/);
    expect(notes.join("\n")).toMatch(/sharp/);
  });

  it("replaces pnpm's placeholder for Nextly's packages only", async () => {
    await writeFile(
      workspaceFile(),
      "allowBuilds:\n  better-sqlite3: set this to true or false\n  unrs-resolver: set this to true or false\n"
    );

    await approveNativeBuilds(dir, "pnpm", "11.0.0");

    const yaml = await readWorkspace();
    expect(yaml.allowBuilds).toMatchObject({
      "better-sqlite3": true,
      esbuild: true,
      sharp: true,
      // Not Nextly's: the app decides.
      "unrs-resolver": "set this to true or false",
    });
  });

  it("creates the file when the app has none", async () => {
    await approveNativeBuilds(dir, "pnpm", "11.2.0");

    const yaml = await readWorkspace();
    expect(yaml.allowBuilds).toEqual({
      "better-sqlite3": true,
      esbuild: true,
      sharp: true,
    });
  });

  it("changes nothing and says nothing on a second run", async () => {
    await writeFile(workspaceFile(), CREATE_NEXT_APP_WORKSPACE);
    await approveNativeBuilds(dir, "pnpm", "12.5.1");
    const first = await readFile(workspaceFile(), "utf8");

    const notes = await approveNativeBuilds(dir, "pnpm", "12.5.1");

    expect(await readFile(workspaceFile(), "utf8")).toBe(first);
    expect(notes.filter(note => note.startsWith("Approved"))).toEqual([]);
  });
});

describe("approveNativeBuilds on pnpm 10", () => {
  it("lists them in pnpm-workspace.yaml for pnpm 10.6 and later", async () => {
    await writeFile(
      workspaceFile(),
      "onlyBuiltDependencies:\n  - some-app-native-dep\n"
    );

    await approveNativeBuilds(dir, "pnpm", "10.18.3");

    const yaml = await readWorkspace();
    expect(yaml.onlyBuiltDependencies).toEqual([
      "some-app-native-dep",
      "better-sqlite3",
      "esbuild",
      "sharp",
    ]);
  });

  it("lists them in package.json for pnpm 10.0 to 10.5, which read only that", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "app",
          pnpm: { onlyBuiltDependencies: ["some-app-native-dep"] },
        },
        null,
        2
      ) + "\n"
    );

    await approveNativeBuilds(dir, "pnpm", "10.5.2");

    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.pnpm.onlyBuiltDependencies).toEqual([
      "some-app-native-dep",
      "better-sqlite3",
      "esbuild",
      "sharp",
    ]);
    expect(pkg.name).toBe("app");
    expect(existsSync(workspaceFile())).toBe(false);
  });
});

describe("approveNativeBuilds on pnpm 9", () => {
  it("writes nothing, because pnpm 9 runs build scripts by default", async () => {
    const notes = await approveNativeBuilds(dir, "pnpm", "9.15.9");

    expect(existsSync(workspaceFile())).toBe(false);
    expect(notes).toEqual([]);
  });
});

describe("approveNativeBuilds with an unknown pnpm version", () => {
  it("writes the forms pnpm 10.6 and later read", async () => {
    await approveNativeBuilds(dir, "pnpm", undefined);

    const yaml = await readWorkspace();
    expect(yaml.allowBuilds).toMatchObject({ esbuild: true });
    expect(yaml.onlyBuiltDependencies).toContain("esbuild");
  });
});

// Bun runs a dependency's install script only when the package is in
// `trustedDependencies`. create-next-app 16.4.2 writes that list with sharp and
// unrs-resolver only, so better-sqlite3 never got its compiled binding and the
// admin's API answered 500 (seen 2026-10-16, Bun 1.3.0).
describe("approveNativeBuilds on Bun", () => {
  const writePackageJson = (pkg: object) =>
    writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  const readPackageJson = async () =>
    JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name: string;
      trustedDependencies?: string[];
    };

  it("adds Nextly's packages to the app's trustedDependencies, keeping its own", async () => {
    await writePackageJson({
      name: "app",
      trustedDependencies: ["sharp", "unrs-resolver"],
    });

    const notes = await approveNativeBuilds(dir, "bun", undefined);

    const pkg = await readPackageJson();
    expect(pkg.trustedDependencies).toEqual([
      "sharp",
      "unrs-resolver",
      "better-sqlite3",
      "esbuild",
    ]);
    expect(pkg.name).toBe("app");
    expect(notes.join("\n")).toMatch(
      /better-sqlite3 and esbuild.*package\.json/
    );
    expect(existsSync(workspaceFile())).toBe(false);
  });

  // With no list, Bun uses its own default list, which trusts these packages
  // (a Bun template project built better-sqlite3 that way, 2026-10-16). Writing
  // a list would replace that default for every other package of the app.
  it("leaves Bun's default list in charge when the app has no list", async () => {
    await writePackageJson({ name: "app" });

    expect(await approveNativeBuilds(dir, "bun", undefined)).toEqual([]);
    expect(await readPackageJson()).toEqual({ name: "app" });
  });
});

describe("approveNativeBuilds on npm and Yarn", () => {
  it.each(["npm", "yarn"] as const)(
    "changes nothing on %s, which run install scripts by default",
    async pm => {
      await writeFile(join(dir, "package.json"), '{"name":"app"}\n');

      expect(await approveNativeBuilds(dir, pm, undefined)).toEqual([]);
      expect(await readFile(join(dir, "package.json"), "utf8")).toBe(
        '{"name":"app"}\n'
      );
      expect(existsSync(workspaceFile())).toBe(false);
    }
  );
});
