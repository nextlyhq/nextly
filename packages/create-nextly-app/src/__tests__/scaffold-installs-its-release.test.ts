/**
 * Which release of Nextly a new project declares.
 *
 * Everything the CLI writes was made for its own release, and Nextly's
 * packages version in lockstep, so on the default paths a project declares
 * every Nextly package at exactly the CLI's version, whatever npm's dist-tags
 * name that day and whether or not the registry answers. A source given on
 * purpose takes the `alpha` tag, the active release line, and nothing comes
 * from `latest`. Each case scaffolds into a real folder from the repository's
 * templates, with the registry replaced, and reads the package.json written.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextlySource } from "../lib/nextly-release";
import type { DatabaseConfig, ProjectType } from "../types";

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

// Three different versions, so the one a scaffold declares says where it
// came from.
const RELEASE = "0.0.2-alpha.40";
const LATEST = "0.0.2-alpha.37";
const ALPHA = "0.0.2-alpha.42";

let workdir: string;

beforeEach(async () => {
  // The registry answers are cached per CLI run, so each test starts fresh.
  vi.resetModules();
  workdir = await mkdtemp(path.join(tmpdir(), "nextly-release-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(workdir, { recursive: true, force: true });
});

const registryAnswers = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ latest: LATEST, alpha: ALPHA }),
    }))
  );

async function scaffold(
  projectType: ProjectType,
  nextlySource?: NextlySource
): Promise<Record<string, Record<string, string>>> {
  const { copyTemplate } = await import("../utils/template");
  const target = path.join(workdir, "app");
  await copyTemplate({
    projectName: "app",
    projectType,
    targetDir: target,
    database: sqlite,
    packageManager: "npm",
    templateSource: {
      basePath: path.join(templates, "base"),
      templatePath: path.join(templates, projectType),
    },
    ...(nextlySource ? { nextlySource } : {}),
  });
  return JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
}

/** Every Nextly package the manifest declares, in any field, with its spec. */
function nextlyDeclared(
  pkg: Record<string, Record<string, string>>
): Array<[string, string]> {
  return ["dependencies", "devDependencies", "peerDependencies"].flatMap(
    field =>
      Object.entries(pkg[field] ?? {}).filter(
        ([name]) => name === "nextly" || name.startsWith("@nextlyhq/")
      )
  );
}

describe("a scaffold on a default path", () => {
  it.each(["blank", "blog"] as const)(
    "declares every Nextly package of a %s project at exactly the CLI's release",
    async projectType => {
      registryAnswers();

      const pkg = await scaffold(projectType, {
        kind: "release",
        cliVersion: RELEASE,
      });

      const declared = nextlyDeclared(pkg);
      expect(declared.length).toBeGreaterThan(3);
      for (const [name, spec] of declared) {
        expect([name, spec]).toEqual([name, RELEASE]);
      }
    }
  );

  it("declares the CLI's release with the registry unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const pkg = await scaffold("blank", {
      kind: "release",
      cliVersion: RELEASE,
    });

    for (const [name, spec] of nextlyDeclared(pkg)) {
      expect([name, spec]).toEqual([name, RELEASE]);
    }
  });

  // What a caller that names no source gets is the default path's answer,
  // this CLI's own release.
  it("declares this CLI's own version when no source is named", async () => {
    registryAnswers();
    const { packageVersion } = await import("../lib/package-version");

    const pkg = await scaffold("blank");

    expect(pkg.dependencies.nextly).toBe(packageVersion());
  });
});

describe("a scaffold from a source given on purpose", () => {
  it("takes the alpha line, never latest", async () => {
    registryAnswers();

    const pkg = await scaffold("blank", {
      kind: "alpha",
      cliVersion: RELEASE,
    });

    for (const [name, spec] of nextlyDeclared(pkg)) {
      expect([name, spec]).toEqual([name, `^${ALPHA}`]);
    }
  });
});
