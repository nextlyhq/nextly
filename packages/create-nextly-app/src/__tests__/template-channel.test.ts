/**
 * The alpha line, and the fallbacks, for Nextly's packages when a source is
 * given on purpose.
 *
 * On the default paths a project declares this CLI's own release
 * (scaffold-installs-its-release.test.ts). A template from a disk or a branch
 * resolves the packages from the `alpha` dist-tag, the active release line,
 * and never from `latest`, which once carried `@nextlyhq/eslint-plugin`'s 0.0.0
 * bootstrap placeholder. --use-yalc resolves nothing and falls back to the tag.
 * The per-template routing these tests once covered, blank on `latest` and
 * blog and plugin on `alpha`, is gone: the source decides, not the template.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextlySource } from "../lib/nextly-release";
import type { DatabaseConfig } from "../types";
import { generatePackageJson } from "../utils/template";

const pgDatabase: DatabaseConfig = {
  type: "postgresql",
  adapter: "@nextlyhq/adapter-postgres",
  databaseDriver: "pg",
  connectionUrl: "postgresql://localhost/test",
  envExample: "postgresql://localhost/test",
};

// Distinct versions per dist-tag so we can assert which channel a scaffold
// resolved from. Every registry dist-tags request returns both tags.
const LATEST = "0.0.2-alpha.37";
const ALPHA = "0.0.2-alpha.42";
const CLI = "0.0.2-alpha.40";
const ALPHA_LINE: NextlySource = { kind: "alpha", cliVersion: CLI };
const YALC: NextlySource = { kind: "yalc", cliVersion: CLI };

describe("the alpha line", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ latest: LATEST, alpha: ALPHA }),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declares a blog scaffold's nextly + @nextlyhq/* on the alpha line", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blog-app", pgDatabase, ALPHA_LINE, "blog")
    );
    expect(pkg.dependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(pkg.dependencies["@nextlyhq/admin"]).toBe(`^${ALPHA}`);
    expect(pkg.dependencies["@nextlyhq/adapter-drizzle"]).toBe(`^${ALPHA}`);
  });

  // The plugin scaffold takes a DIFFERENT code path from the app scaffold —
  // `generatePluginPackageJson`, a publishable library rather than an app — so
  // this asserts its manifest, which is the thing an author installs.
  it("declares the plugin scaffold's manifest on the alpha line", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", pgDatabase, ALPHA_LINE, "plugin")
    );
    // `latest` carries @nextlyhq/eslint-plugin's 0.0.0 bootstrap placeholder,
    // which has no `main` and no `exports`: it installs and then fails at the
    // author's first `pnpm lint`, when eslint.config.mjs imports it.
    expect(pkg.devDependencies["@nextlyhq/eslint-plugin"]).toBe(`^${ALPHA}`);
    expect(pkg.devDependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(pkg.peerDependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(pkg.peerDependencies["@nextlyhq/ui"]).toBe(`^${ALPHA}`);
  });

  // `--use-yalc` empties the resolved-version map, so every range falls back to
  // a bare dist-tag. That fallback must be `alpha`, not `latest`: the yalc
  // installer links a fixed list that does not include
  // `@nextlyhq/eslint-plugin`, so whatever the manifest names is what the author
  // actually installs — and `latest` was once the unusable 0.0.0 bootstrap.
  it("falls back to the alpha tag, not latest, in yalc mode", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", pgDatabase, YALC, "plugin")
    );
    expect(pkg.devDependencies["@nextlyhq/eslint-plugin"]).toBe("alpha");
    expect(pkg.devDependencies["nextly"]).toBe("alpha");
    // A peer cannot take the tag: pnpm rejects it there
    // (ERR_PNPM_INVALID_PEER_DEPENDENCY_SPECIFICATION), so it anchors on the
    // CLI's release, which the whole family shares.
    expect(pkg.peerDependencies["nextly"]).toBe(`^${CLI}`);
  });

  it("never declares what latest names", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blank-app", pgDatabase, ALPHA_LINE, "blank")
    );
    // Next.js's own packages still come from `latest`; Nextly's never do.
    const nextly = Object.entries(
      pkg.dependencies as Record<string, string>
    ).filter(([name]) => name === "nextly" || name.startsWith("@nextlyhq/"));
    expect(nextly.length).toBeGreaterThan(3);
    for (const [name, spec] of nextly)
      expect([name, spec]).toEqual([name, `^${ALPHA}`]);
  });
});

// Reset modules per test so the per-channel version cache never masks the
// failure path (a cached alpha version would hide a regression here).
describe("alpha pin survives a registry lookup failure", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a blog scaffold on the alpha tag when the registry request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    const { generatePackageJson: gen } = await import("../utils/template");
    const pkg = JSON.parse(
      await gen("blog-app", pgDatabase, ALPHA_LINE, "blog")
    );
    // The dist-tag name is itself a valid npm spec; a content template must
    // never silently drop to `latest` (which lacks the runtime helpers).
    expect(pkg.dependencies["nextly"]).toBe("alpha");
    expect(pkg.dependencies["@nextlyhq/admin"]).toBe("alpha");
  });

  it("keeps a blog scaffold on the alpha tag when the alpha tag is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ latest: LATEST }),
      }))
    );
    const { generatePackageJson: gen } = await import("../utils/template");
    const pkg = JSON.parse(
      await gen("blog-app", pgDatabase, ALPHA_LINE, "blog")
    );
    expect(pkg.dependencies["nextly"]).toBe("alpha");
  });
});

/*
 * A plugin states the `nextly` it supports twice: as the peer range in its
 * package.json, and as `nextly` in definePlugin, which boot checks against the
 * running core and refuses on a mismatch. The scaffold installs that core from
 * the plugin's channel, so both statements have to come from the same one.
 * `latest` and `alpha` are set far apart here, as they are whenever the alpha
 * line moves ahead of the last stable release.
 */
describe("a plugin's declared nextly range follows its source", () => {
  const STABLE = "0.0.1";
  let workdir: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ latest: STABLE, alpha: ALPHA }),
      }))
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  it("writes the alpha range into definePlugin, matching the peer range", async () => {
    const { copyTemplate } = await import("../utils/template");
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-range-"));
    const target = path.join(workdir, "my-plugin");
    const templatesRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../templates"
    );

    await copyTemplate({
      projectName: "my-plugin",
      projectType: "plugin",
      targetDir: target,
      database: pgDatabase,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "plugin"),
      },
      nextlySource: ALPHA_LINE,
    });

    const pkg = JSON.parse(
      await readFile(path.join(target, "package.json"), "utf-8")
    );
    const pluginSource = await readFile(
      path.join(target, "src/plugin.ts"),
      "utf-8"
    );
    const declared = /nextly: "([^"]+)"/.exec(pluginSource)?.[1];

    expect(pkg.peerDependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(declared).toBe(pkg.peerDependencies["nextly"]);
  });

  // The template bundled in a CLI release was written against the packages
  // released with it. Run as an older release while the channel has moved on,
  // the scaffold must install that release's packages, not the channel's.
  it("pins every Nextly package to the CLI's own release for the bundled template", async () => {
    const RELEASE = "0.0.2-alpha.40";
    const { copyTemplate } = await import("../utils/template");
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-release-"));
    const target = path.join(workdir, "my-plugin");
    const templatesRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../templates"
    );

    await copyTemplate({
      projectName: "my-plugin",
      projectType: "plugin",
      targetDir: target,
      database: pgDatabase,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "plugin"),
      },
      nextlySource: { kind: "release", cliVersion: RELEASE },
    });

    const pkg = JSON.parse(
      await readFile(path.join(target, "package.json"), "utf-8")
    );
    const pluginSource = await readFile(
      path.join(target, "src/plugin.ts"),
      "utf-8"
    );
    const nextlyFamily = Object.entries(
      pkg.devDependencies as Record<string, string>
    ).filter(([name]) => name === "nextly" || name.startsWith("@nextlyhq/"));

    // The whole family, installed exactly as released.
    expect(nextlyFamily.length).toBeGreaterThan(0);
    for (const [name, version] of nextlyFamily) {
      expect(version, name).toBe(RELEASE);
    }
    expect(pkg.peerDependencies["nextly"]).toBe(`^${RELEASE}`);
    expect(/nextly: "([^"]+)"/.exec(pluginSource)?.[1]).toBe(`^${RELEASE}`);
  });
  // A source given on purpose is not pinned, but when no version resolves
  // (offline, --use-yalc) its peers still anchor on the CLI's release: an
  // installed prerelease such as 0.0.2-alpha.40 does not satisfy `>=0.0.0`.
  it.each([
    ["under --use-yalc", "yalc"],
    ["offline", "alpha"],
  ] as const)(
    "anchors peer ranges on the CLI's release %s",
    async (_label, kind) => {
      const RELEASE = "0.0.2-alpha.40";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, json: async () => ({}) }))
      );
      const { copyTemplate } = await import("../utils/template");
      workdir = await mkdtemp(path.join(tmpdir(), "nextly-plugin-anchor-"));
      const target = path.join(workdir, "my-plugin");
      const templatesRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../templates"
      );

      await copyTemplate({
        projectName: "my-plugin",
        projectType: "plugin",
        targetDir: target,
        database: pgDatabase,
        templateSource: {
          basePath: path.join(templatesRoot, "base"),
          templatePath: path.join(templatesRoot, "plugin"),
        },
        nextlySource: { kind, cliVersion: RELEASE },
      });

      const pkg = JSON.parse(
        await readFile(path.join(target, "package.json"), "utf-8")
      );
      const pluginSource = await readFile(
        path.join(target, "src/plugin.ts"),
        "utf-8"
      );
      for (const name of [
        "nextly",
        "@nextlyhq/admin",
        "@nextlyhq/plugin-sdk",
        "@nextlyhq/ui",
      ]) {
        expect(pkg.peerDependencies[name], name).toBe(`^${RELEASE}`);
      }
      expect(/nextly: "([^"]+)"/.exec(pluginSource)?.[1]).toBe(`^${RELEASE}`);
    }
  );
});
