import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { redirects } from "../plugin";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string; keywords: string[] };

describe("redirects() plugin", () => {
  it("defines the redirects collection + manage-redirects permission + lookup route", () => {
    const { plugin } = redirects();

    expect(plugin.name).toBe("@nextlyhq/plugin-redirects");

    const col = plugin.contributes?.collections?.[0];
    expect(col?.slug).toBe("redirects");
    // defineCollection prepends the Nextly system fields (title, slug); assert
    // the redirect-specific fields are present.
    expect(col?.fields.map(f => (f as { name: string }).name)).toEqual(
      expect.arrayContaining(["fromPath", "toPath", "type"])
    );

    expect(plugin.contributes?.permissions?.[0]).toMatchObject({
      action: "manage",
      resource: "redirects",
    });

    expect(plugin.contributes?.routes?.[0]).toMatchObject({
      method: "GET",
      path: "/lookup",
      public: true,
    });
  });

  it("version matches package.json + declares the nextly-plugin keyword", () => {
    expect(redirects().plugin.version).toBe(pkg.version);
    expect(pkg.keywords).toContain("nextly-plugin");
  });

  it("supports a custom collection slug", () => {
    expect(
      redirects({ slug: "url-redirects" }).plugin.contributes?.collections?.[0]
        .slug
    ).toBe("url-redirects");
  });
});
