/**
 * Tests for the content-template npm dist-tag channel.
 *
 * Content templates (blog) render CMS content through `nextly/runtime` cache
 * helpers, which ship on the active `alpha` channel; the conservative `latest`
 * tag can lag behind it during the alpha. So a blog scaffold must pin nextly +
 * @nextlyhq/* to `alpha`, while blank stays on `latest`. The plugin template
 * tracks `alpha` too, for the same reason applied to a different package:
 * `@nextlyhq/eslint-plugin` ships the design-token rules on the active release
 * line, and `latest` lags it.
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
  it("routes templates that track the active release line to alpha", () => {
    expect(templateNextlyChannel("blog")).toBe("alpha");
    expect(templateNextlyChannel("blank")).toBe("latest");
    expect(templateNextlyChannel("plugin")).toBe("alpha");
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

  // The plugin scaffold takes a DIFFERENT code path from the app scaffold —
  // `generatePluginPackageJson`, a publishable library rather than an app — so
  // asserting `templateNextlyChannel("plugin") === "alpha"` proves only that the
  // routing function answers correctly, not that its answer reaches the
  // manifest. This asserts the manifest, which is the thing an author installs.
  it("pins the plugin scaffold's manifest to the alpha channel", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", pgDatabase, false, "plugin")
    );
    // `latest` carries @nextlyhq/eslint-plugin's 0.0.0 bootstrap placeholder,
    // which has no `main` and no `exports`: it installs and then fails at the
    // author's first `pnpm lint`, when eslint.config.mjs imports it.
    expect(pkg.devDependencies["@nextlyhq/eslint-plugin"]).toBe(`^${ALPHA}`);
    expect(pkg.devDependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(pkg.peerDependencies["nextly"]).toBe(`^${ALPHA}`);
    expect(pkg.peerDependencies["@nextlyhq/ui"]).toBe(`^${ALPHA}`);
  });

  it("pins the blank scaffold's nextly to the latest channel", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blank-app", pgDatabase, false, "blank")
    );
    expect(pkg.dependencies["nextly"]).toBe(`^${LATEST}`);
    expect(pkg.dependencies["@nextlyhq/admin"]).toBe(`^${LATEST}`);
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
});
