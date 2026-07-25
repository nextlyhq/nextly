/**
 * Tests for the content-template npm dist-tag channel.
 *
 * Content templates (blog) render CMS content through `nextly/runtime` cache
 * helpers, which ship on the active `alpha` channel; the conservative `latest`
 * tag can lag behind it during the alpha. So a blog scaffold must pin nextly +
 * @nextlyhq/* to `alpha`, while blank/plugin stay on `latest`.
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
  it("routes content templates to alpha and everything else to latest", () => {
    expect(templateNextlyChannel("blog")).toBe("alpha");
    expect(templateNextlyChannel("blank")).toBe("latest");
    expect(templateNextlyChannel("plugin")).toBe("latest");
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
});
