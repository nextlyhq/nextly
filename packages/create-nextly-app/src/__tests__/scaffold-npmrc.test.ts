/**
 * The `.npmrc` a pnpm scaffold needs must reach the PROJECT, and must not destroy one already
 * there.
 *
 * Both halves are tested by scaffolding onto a real temporary directory rather than by calling
 * the generator. A test that calls `generateNpmrc` directly stays green if the `copyTemplate`
 * wiring is deleted outright — it proves a string is produced, not that any project receives it —
 * and the wiring is the part that can regress.
 *
 * The overwrite half matters because a scaffold does not always land on an empty directory: the
 * CLI can overlay an existing project, and a `--local-template` can carry its own `.npmrc`. That
 * file is where private registries, auth tokens and proxies live, so replacing it would break the
 * install that runs moments later — and break it by reaching the wrong registry rather than by
 * failing outright.
 */
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  symlink,
  lstat,
  link as hardLink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseConfig, PackageManager } from "../types";
import { copyTemplate } from "../utils/template";

const templates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates"
);

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "nextly-npmrc-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Scaffolds a blank project and returns its `.npmrc`, or null when none was written. */
async function scaffold(
  packageManager: PackageManager,
  seedNpmrc?: string,
  projectType: "blank" | "plugin" = "blank"
): Promise<string | null> {
  const target = join(workspace, "app");
  if (seedNpmrc !== undefined) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, ".npmrc"), seedNpmrc, "utf-8");
  }

  await copyTemplate({
    projectName: "app",
    projectType,
    targetDir: target,
    database: sqlite,
    packageManager,
    templateSource: {
      basePath: join(templates, "base"),
      templatePath: join(templates, projectType),
    },
    // Set by the installer once it has settled a directory conflict with the user, which is the
    // situation the overlay cases below are standing in for.
    allowExistingTarget: seedNpmrc !== undefined,
  });

  const npmrcPath = join(target, ".npmrc");
  return existsSync(npmrcPath) ? readFile(npmrcPath, "utf-8") : null;
}

describe("a pnpm scaffold", () => {
  it("receives the workspace-root opt-out", async () => {
    const npmrc = await scaffold("pnpm");
    expect(npmrc).not.toBeNull();
    expect(npmrc).toMatch(/^ignore-workspace-root-check=true$/m);
  }, 60_000);

  it("keeps the settings an existing .npmrc already carried", async () => {
    const npmrc = await scaffold(
      "pnpm",
      "@acme:registry=https://npm.acme.internal/\nnode-linker=hoisted\n"
    );

    // The point of the case: these decide which registry the install about to run will contact.
    expect(npmrc).toContain("@acme:registry=https://npm.acme.internal/");
    expect(npmrc).toContain("node-linker=hoisted");
    expect(npmrc).toMatch(/^ignore-workspace-root-check=true$/m);
  }, 60_000);

  it("does not overrule a deliberate setting of the same key", async () => {
    const npmrc = await scaffold("pnpm", "ignore-workspace-root-check=false\n");

    expect(npmrc).toContain("ignore-workspace-root-check=false");
    expect(npmrc).not.toContain("ignore-workspace-root-check=true");
  }, 60_000);

  it("does not mangle a file with no trailing newline", async () => {
    const npmrc = await scaffold("pnpm", "node-linker=hoisted");
    expect(npmrc).toContain("node-linker=hoisted\n");
    expect(npmrc).toMatch(/^ignore-workspace-root-check=true$/m);
  }, 60_000);
});

describe("an existing .npmrc that is a symlink", () => {
  // Left untouched, because reading and writing it back would follow the link. The realistic
  // shape is a link to a shared or home-directory config, so appending would edit settings
  // belonging to every other project on the machine — a scaffold has no business doing that.
  it("is not followed, and its target keeps its contents", async () => {
    const target = join(workspace, "app");
    const shared = join(workspace, "shared-npmrc");
    const original = "@acme:registry=https://npm.acme.internal/\n";
    await writeFile(shared, original, "utf-8");
    await mkdir(target, { recursive: true });
    await symlink(shared, join(target, ".npmrc"));

    await copyTemplate({
      projectName: "app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "pnpm",
      templateSource: {
        basePath: join(templates, "base"),
        templatePath: join(templates, "blank"),
      },
      allowExistingTarget: true,
    });

    // The referent is what an unnoticed follow would have modified.
    expect(await readFile(shared, "utf-8")).toBe(original);
    // And the link is still a link, rather than having been replaced by a regular file.
    expect((await lstat(join(target, ".npmrc"))).isSymbolicLink()).toBe(true);
  }, 60_000);
});

describe("a plugin scaffold", () => {
  // The plugin branch returns EARLY from copyTemplate, so it writes the file through its own
  // call. Covering only `blank` leaves that call deletable with the whole suite green — and a
  // plugin scaffold on pnpm 9 would go back to refusing `pnpm add`.
  it("gets the same opt-out as an app scaffold", async () => {
    const npmrc = await scaffold("pnpm", undefined, "plugin");
    expect(npmrc).toMatch(/^ignore-workspace-root-check=true$/m);
  }, 60_000);

  it("gets none for npm", async () => {
    expect(await scaffold("npm", undefined, "plugin")).toBeNull();
  }, 60_000);
});

describe("an existing .npmrc that is a HARD link", () => {
  // `lstat` cannot see this one: a hard link IS a regular file. Both paths are one inode, so
  // appending would edit the shared config every other project reads. `nlink` is the tell.
  it("is not modified, and the shared file keeps its contents", async () => {
    const target = join(workspace, "app");
    const shared = join(workspace, "shared-npmrc");
    const original = "@acme:registry=https://npm.acme.internal/\n";
    await writeFile(shared, original, "utf-8");
    await mkdir(target, { recursive: true });
    await hardLink(shared, join(target, ".npmrc"));

    await copyTemplate({
      projectName: "app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "pnpm",
      templateSource: {
        basePath: join(templates, "base"),
        templatePath: join(templates, "blank"),
      },
      allowExistingTarget: true,
    });

    expect(await readFile(shared, "utf-8")).toBe(original);
  }, 60_000);
});

describe("every other package manager", () => {
  // npm reads `.npmrc` too and answers every command with `npm warn Unknown project config
  // "ignore-workspace-root-check"`. A permanent warning for the majority, buying them a setting
  // they cannot use.
  it.each(["npm", "yarn", "bun"] as const)(
    "gets no .npmrc from a %s scaffold",
    async manager => {
      expect(await scaffold(manager)).toBeNull();
    },
    60_000
  );

  it("leaves an existing .npmrc untouched", async () => {
    const seeded = "@acme:registry=https://npm.acme.internal/\n";
    expect(await scaffold("npm", seeded)).toBe(seeded);
  }, 60_000);
});
