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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("approveNativeBuilds on pnpm 10.26 and later", () => {
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
    // pnpm 11 removed onlyBuiltDependencies, so it isn't written for pnpm 12.
    expect(yaml.onlyBuiltDependencies).toBeUndefined();
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
    expect(yaml.onlyBuiltDependencies).toBeUndefined();
  });

  it("uses allowBuilds from pnpm 10.26, where it was added", async () => {
    await approveNativeBuilds(dir, "pnpm", "10.26.0");

    const yaml = await readWorkspace();
    expect(yaml.allowBuilds).toMatchObject({ esbuild: true });
    expect(yaml.onlyBuiltDependencies).toBeUndefined();
  });

  // pnpm decides a package's build by its version-scoped key too
  // (`nx@21.6.4 || 21.6.5: true` in its docs). A bare key added beside an
  // app's scoped one would widen what the app trusts to every version.
  it("keeps an app's version-scoped approval and adds no bare key beside it", async () => {
    await writeFile(workspaceFile(), "allowBuilds:\n  esbuild@0.28.1: true\n");

    const notes = await approveNativeBuilds(dir, "pnpm", "12.5.1");

    const yaml = await readWorkspace();
    expect(yaml.allowBuilds).toEqual({
      "esbuild@0.28.1": true,
      "better-sqlite3": true,
      sharp: true,
    });
    expect(notes.join("\n")).toMatch(/esbuild@0\.28\.1/);
    // Other versions stay unapproved, and the note says what to do if pnpm
    // then stops on one.
    expect(notes.join("\n")).toMatch(/ERR_PNPM_IGNORED_BUILDS/);
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

// From pnpm 12.11, an entry in `permissions` outranks the package's
// allowBuilds entry, and pnpm's own approval writes there once the file has
// the section (pnpm.io/settings/build, read 2026-10-16).
describe("approveNativeBuilds on pnpm 12.11 and later", () => {
  it("approves in permissions when the app's file has that section", async () => {
    await writeFile(
      workspaceFile(),
      "permissions:\n  drizzle-kit:\n    skills: true\n  esbuild:\n    build: false\nallowBuilds:\n  sharp: true\n"
    );

    const notes = await approveNativeBuilds(dir, "pnpm", "12.11.2");

    const yaml = await readWorkspace();
    expect(yaml.permissions).toEqual({
      // An entry without a build decision gains one; a denial is kept.
      "drizzle-kit": { skills: true },
      esbuild: { build: false },
      "better-sqlite3": { build: true },
    });
    // sharp was decided in allowBuilds and nothing in permissions outranks it.
    expect(yaml.allowBuilds).toEqual({ sharp: true });
    expect(notes.join("\n")).toMatch(/Left esbuild/);
  });

  it("approves in allowBuilds when the file has no permissions section", async () => {
    await approveNativeBuilds(dir, "pnpm", "12.11.2");

    const yaml = await readWorkspace();
    expect(yaml.permissions).toBeUndefined();
    expect(yaml.allowBuilds).toMatchObject({ esbuild: true });
  });
});

describe("approveNativeBuilds on pnpm 10", () => {
  it("lists them in onlyBuiltDependencies for pnpm 10.6 to 10.25", async () => {
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
    // allowBuilds arrived in pnpm 10.26, so 10.18 would not read it.
    expect(yaml.allowBuilds).toBeUndefined();
  });

  it("keeps a package the app's pnpm 10 settings never build", async () => {
    await writeFile(workspaceFile(), "neverBuiltDependencies:\n  - esbuild\n");

    await approveNativeBuilds(dir, "pnpm", "10.18.3");

    const yaml = await readWorkspace();
    expect(yaml.onlyBuiltDependencies).toEqual(["better-sqlite3", "sharp"]);
    expect(yaml.neverBuiltDependencies).toEqual(["esbuild"]);
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

// An app inside a monorepo is one package of a workspace whose settings live at
// its root. A workspace file written into the app's own folder would make it a
// workspace of its own, cut off from the root's lockfile and workspace: links.
describe("approveNativeBuilds inside a monorepo", () => {
  it("edits the pnpm workspace root's file, and writes none in the app", async () => {
    await writeFile(workspaceFile(), "packages:\n  - apps/*\n");
    const app = join(dir, "apps", "web");
    await mkdir(app, { recursive: true });

    await approveNativeBuilds(app, "pnpm", "12.5.1");

    expect(existsSync(join(app, "pnpm-workspace.yaml"))).toBe(false);
    const yaml = await readWorkspace();
    expect(yaml.packages).toEqual(["apps/*"]);
    expect(yaml.allowBuilds).toMatchObject({ esbuild: true });
  });

  it("adds to the Bun workspace root's trustedDependencies", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "root",
          workspaces: ["apps/*"],
          trustedDependencies: ["sharp"],
        },
        null,
        2
      ) + "\n"
    );
    const app = join(dir, "apps", "web");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "package.json"), '{"name":"web"}\n');

    await approveNativeBuilds(app, "bun", undefined);

    const root = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(root.trustedDependencies).toEqual([
      "sharp",
      "better-sqlite3",
      "esbuild",
    ]);
    expect(await readFile(join(app, "package.json"), "utf8")).toBe(
      '{"name":"web"}\n'
    );
  });
});
