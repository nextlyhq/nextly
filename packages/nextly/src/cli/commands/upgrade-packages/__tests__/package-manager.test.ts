/**
 * How `nextly upgrade` speaks to each package manager: the arguments it
 * passes, what it reads back of a registry's answer, and that a run it
 * starts can be stopped and is not kept whole in memory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  installArgs,
  isYarnClassic,
  runManager,
  viewArgs,
} from "../package-manager";
import { parseReleases, registryFor } from "../registry-releases";

describe("the arguments a package manager is run with", () => {
  it("lets each manager change its lockfile, in the words that manager takes", () => {
    expect(installArgs("npm")).toEqual(["install"]);
    expect(installArgs("pnpm")).toEqual(["install", "--no-frozen-lockfile"]);
    expect(installArgs("yarn")).toEqual(["install", "--no-immutable"]);
    // Yarn 1 has no such flag, and refuses one it does not know.
    expect(installArgs("yarn", { classic: true })).toEqual(["install"]);
  });

  it("asks Yarn 1 for a package's document its own way", () => {
    expect(viewArgs("yarn", "nextly")).toEqual([
      "npm",
      "info",
      "nextly",
      "--fields",
      "dist-tags,versions",
      "--json",
    ]);
    expect(viewArgs("yarn", "nextly", { classic: true })).toEqual([
      "info",
      "nextly",
      "--json",
    ]);
  });

  it("tells Yarn 1 from later Yarn by its version", () => {
    expect(isYarnClassic("1.22.22\n")).toBe(true);
    expect(isYarnClassic("4.9.2")).toBe(false);
    expect(isYarnClassic("")).toBe(false);
  });
});

describe("what a registry's answer is read as", () => {
  const tags = { alpha: "9.0.0-alpha.2", latest: "9.0.0-alpha.1" };
  const versions = ["9.0.0-alpha.1", "9.0.0-alpha.2"];

  it("reads a manager's view, the registry's own document, and Yarn 1's wrapped one", () => {
    const expected = { tags, versions };
    expect(parseReleases({ "dist-tags": tags, versions })).toEqual(expected);
    expect(
      parseReleases({
        "dist-tags": tags,
        versions: { "9.0.0-alpha.1": {}, "9.0.0-alpha.2": {} },
      })
    ).toEqual(expected);
    expect(
      parseReleases({ type: "inspect", data: { "dist-tags": tags, versions } })
    ).toEqual(expected);
    // One version comes back from npm as a string, not a list.
    expect(
      parseReleases({ "dist-tags": tags, versions: "9.0.0-alpha.1" })
    ).toEqual({ tags, versions: ["9.0.0-alpha.1"] });
  });

  it.each([
    ["nothing", undefined],
    ["a list", []],
    ["no tags", { versions }],
    ["a tag that names no version", { "dist-tags": { alpha: 3 }, versions }],
    ["no versions", { "dist-tags": tags }],
    ["an empty version list", { "dist-tags": tags, versions: [] }],
    ["a version that is not text", { "dist-tags": tags, versions: [1, 2] }],
  ])("reads %s as no answer", (_what, document) => {
    expect(parseReleases(document)).toBeUndefined();
  });
});

describe("a package manager's run", () => {
  it("is stopped when asked, and its end is waited for", async () => {
    const stop = new AbortController();
    const started = Date.now();
    // `npm exec` would reach a registry; a script of an empty project does not.
    const running = runManager(
      "npm",
      ["exec", "--offline", "--", "node", "-e", "setTimeout(() => {}, 60000)"],
      process.cwd(),
      { signal: stop.signal }
    );
    setTimeout(() => stop.abort(), 1500);

    const run = await running;

    expect(run.status).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 45_000);

  it("keeps the end of what was printed, not all of it", async () => {
    const run = await runManager(
      "npm",
      [
        "exec",
        "--offline",
        "--",
        "node",
        "-e",
        "for (let i = 0; i < 4000; i++) console.error('x'.repeat(1000) + i); console.error('the last line')",
      ],
      process.cwd()
    );

    expect(run.output).toContain("the last line");
    expect(run.output.length).toBeLessThan(300_000);
  }, 45_000);
});

describe("the registry a project's .npmrc names for a package", () => {
  it("is the scope's own first, then the default, each from the nearest file that sets it", () => {
    const root = mkdtempSync(join(tmpdir(), "nextly-npmrc-"));
    try {
      const app = join(root, "apps", "web");
      mkdirSync(app, { recursive: true });
      writeFileSync(
        join(root, ".npmrc"),
        "registry=https://root.example/\n@nextlyhq:registry=https://scoped.example/\n"
      );
      // The project's own file sets the default alone, and a line with no value.
      writeFileSync(
        join(app, ".npmrc"),
        "; a comment\nregistry = https://app.example/\nempty=\n"
      );

      expect(registryFor(app, "nextly")).toBe("https://app.example/");
      expect(registryFor(app, "@nextlyhq/admin")).toBe(
        "https://scoped.example/"
      );
      expect(registryFor(root, "nextly")).toBe("https://root.example/");
      // A scope with no registry of its own uses the default one.
      expect(registryFor(app, "@other/thing")).toBe("https://app.example/");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is npm's own where no file names one", () => {
    const empty = mkdtempSync(join(tmpdir(), "nextly-npmrc-none-"));
    try {
      // No `.npmrc` here; one in a folder above this machine's temp folder
      // would be the operator's own, so only the shape is asserted.
      expect(registryFor(empty, "nextly")).toMatch(/^https?:\/\//);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
