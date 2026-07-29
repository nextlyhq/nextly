/**
 * Tests for the per-template npm dist-tag channel.
 *
 * Train-coupled templates pin nextly + @nextlyhq/* to `alpha`: blog renders
 * through `nextly/runtime` cache helpers that ship on the active alpha
 * channel, and plugin ships bundled with the CLI so its generated test and
 * dev playground exercise current plugin-sdk/admin APIs. The conservative
 * `latest` tag can lag the train during the alpha, so only blank stays on
 * `latest`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";
import { generatePackageJson, templateNextlyChannel } from "../utils/template";

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

describe("templateNextlyChannel", () => {
  it("routes content templates to alpha and blank to latest", () => {
    expect(templateNextlyChannel("blog")).toBe("alpha");
    expect(templateNextlyChannel("blank")).toBe("latest");
  });

  it("keeps plugin on the same channel as the other train-coupled templates", () => {
    // The plugin template ships bundled inside the CLI, so its scaffolds
    // must install from the same release train the CLI was published on —
    // whichever dist-tag that is. Asserted relationally (not against a
    // literal tag) so this test survives channel renames when the alpha
    // phase ends.
    expect(templateNextlyChannel("plugin")).toBe(templateNextlyChannel("blog"));
  });
});

describe("content-template dist-tag pinning", () => {
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

  it("pins the blog scaffold's nextly + @nextlyhq/* to the alpha channel", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blog-app", pgDatabase, false, "blog")
    );
    expect(pkg.dependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(pkg.dependencies["@nextlyhq/admin"]).toBe(`^${ALPHA}`);
    expect(pkg.dependencies["@nextlyhq/adapter-drizzle"]).toBe(`^${ALPHA}`);
  });

  it("pins the blank scaffold's nextly to the latest channel", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blank-app", pgDatabase, false, "blank")
    );
    expect(pkg.dependencies["nextly"]).toBe(`^${LATEST}`);
    expect(pkg.dependencies["@nextlyhq/admin"]).toBe(`^${LATEST}`);
  });

  it("pins the plugin scaffold's nextly family to its template channel", async () => {
    // Expected version derived from the channel mapping (not a hardcoded
    // tag), so the assertion keeps holding when the channel changes.
    const tagVersions: Record<string, string> = {
      latest: LATEST,
      alpha: ALPHA,
    };
    const expected = `^${tagVersions[templateNextlyChannel("plugin")]}`;

    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", pgDatabase, false, "plugin")
    );
    // The template ships with the CLI, so its devDeps and the declared peer
    // compat range must come from the CLI's own release train.
    expect(pkg.devDependencies["nextly"]).toBe(expected);
    expect(pkg.devDependencies["@nextlyhq/plugin-sdk"]).toBe(expected);
    expect(pkg.peerDependencies["nextly"]).toBe(expected);
  });

  it("omits the nextly family from plugin devDeps under --use-yalc", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", pgDatabase, true, "plugin")
    );
    // The installer yalc-adds these before the first install; registry specs
    // here would race it into fetching published packages it is about to
    // replace. Non-nextly tooling stays.
    for (const dep of Object.keys(pkg.devDependencies)) {
      expect(dep, "yalc plugin devDep").not.toMatch(/^nextly$|^@nextlyhq\//);
    }
    expect(pkg.devDependencies["tsup"]).toBeDefined();
    expect(pkg.devDependencies["vitest"]).toBeDefined();
    // Peers stay declared (publish metadata) but with a valid semver range,
    // never a dist-tag name pnpm would reject.
    expect(pkg.peerDependencies["nextly"]).toBe(">=0.0.0");
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
    const pkg = JSON.parse(await gen("blog-app", pgDatabase, false, "blog"));
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
    const pkg = JSON.parse(await gen("blog-app", pgDatabase, false, "blog"));
    expect(pkg.dependencies["nextly"]).toBe("alpha");
  });

  it("rejects a malformed registry version instead of wrapping it", async () => {
    // The registry payload is untrusted: a dist-tag pointing at a
    // non-semver value must fall back to the tag name (a valid npm spec),
    // never become an invalid "^not-a-version" install spec.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ latest: "not-a-version", alpha: "also bad" }),
      }))
    );
    const { generatePackageJson: gen, templateNextlyChannel: channelOf } =
      await import("../utils/template");
    const pkg = JSON.parse(await gen("my-plugin", pgDatabase, false, "plugin"));
    expect(pkg.devDependencies["nextly"]).toBe(channelOf("plugin"));
    expect(pkg.peerDependencies["nextly"]).toBe(">=0.0.0");

    const blogPkg = JSON.parse(
      await gen("blog-app", pgDatabase, false, "blog")
    );
    expect(blogPkg.dependencies["nextly"]).toBe(channelOf("blog"));
  });

  it("keeps plugin devDeps on its channel tag but peers on a semver range when the registry fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    const { generatePackageJson: gen, templateNextlyChannel: channelOf } =
      await import("../utils/template");
    const pkg = JSON.parse(await gen("my-plugin", pgDatabase, false, "plugin"));
    // devDeps may carry the dist-tag name (a valid install spec) — asserted
    // via the channel mapping, not a literal tag...
    expect(pkg.devDependencies["nextly"]).toBe(channelOf("plugin"));
    // ...but peerDependencies must stay a semver range: pnpm 11 rejects a
    // dist-tag there and then refuses to run any script in the scaffold.
    expect(pkg.peerDependencies["nextly"]).toBe(">=0.0.0");
    expect(pkg.peerDependencies["@nextlyhq/plugin-sdk"]).toBe(">=0.0.0");
  });
});
