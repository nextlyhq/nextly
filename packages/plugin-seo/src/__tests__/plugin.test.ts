import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { seo } from "../plugin";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string; keywords: string[] };

describe("seo() plugin", () => {
  it("defines the plugin with extend + manage-seo permission", () => {
    const { plugin } = seo({
      collections: ["pages", "posts"],
      baseUrl: "https://example.com",
    });

    expect(plugin.name).toBe("@nextlyhq/plugin-seo");
    expect(plugin.contributes?.extend?.[0].target).toEqual(["pages", "posts"]);

    const fieldNames = plugin.contributes?.extend?.[0].fields.map(
      f => (f as { name: string }).name
    );
    expect(fieldNames).toEqual(["metaTitle", "metaDescription"]);

    expect(plugin.contributes?.permissions?.[0]).toMatchObject({
      action: "manage",
      resource: "seo",
    });
  });

  it("lets the caller override the contributed fields", () => {
    const { plugin } = seo({
      collections: ["pages"],
      baseUrl: "https://example.com",
      fields: [],
    });
    expect(plugin.contributes?.extend?.[0].fields).toEqual([]);
  });

  it("plugin version matches package.json + declares nextly-plugin keyword", () => {
    expect(seo({ collections: ["pages"], baseUrl: "x" }).plugin.version).toBe(
      pkg.version
    );
    expect(pkg.keywords).toContain("nextly-plugin");
  });
});
