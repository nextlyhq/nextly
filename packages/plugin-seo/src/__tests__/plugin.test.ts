import { createRequire } from "node:module";

import { text } from "nextly";
import { describe, expect, it } from "vitest";

import { defaultSeoFields } from "../fields";
import { seoPlugin } from "../plugin";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** Read the field names inside the default `seo` group. */
function seoGroupFieldNames(plugin: ReturnType<typeof seoPlugin>): string[] {
  const extend = plugin.contributes?.extend?.[0];
  const group = extend?.fields?.[0];
  if (!group || group.type !== "group") {
    throw new Error("expected the extend payload to start with the seo group");
  }
  return group.fields.map(f => ("name" in f ? (f.name ?? "") : ""));
}

describe("seoPlugin", () => {
  it("returns a plugin definition directly (no unwrapping)", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.name).toBe("@nextlyhq/plugin-seo");
    expect(plugin.category).toBe("seo");
    // Version cannot drift from what ships — it is read from package.json.
    expect(plugin.version).toBe(pkg.version);
    // The core-compat field is literally `nextly`.
    expect(typeof plugin.nextly).toBe("string");
  });

  it("extends exactly the named collections with the seo group", () => {
    const plugin = seoPlugin({ collections: ["pages", "posts"] });
    const extend = plugin.contributes?.extend?.[0];
    expect(extend?.target).toEqual(["pages", "posts"]);
    const group = extend?.fields?.[0];
    expect(group?.type).toBe("group");
    expect(group && "name" in group ? group.name : undefined).toBe("seo");
  });

  it("ships canonical + noindex in the default fields (edge over other plugins)", () => {
    const names = seoGroupFieldNames(seoPlugin({ collections: ["pages"] }));
    expect(names).toEqual([
      "metaTitle",
      "metaDescription",
      "ogImage",
      "canonical",
      "noindex",
    ]);
  });

  it("declares a non-CRUD manage-seo permission", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    const perms = plugin.contributes?.permissions ?? [];
    expect(perms).toContainEqual(
      expect.objectContaining({ action: "manage", resource: "seo" })
    );
  });

  it("lets a project override the contributed fields", () => {
    const custom = [text({ name: "focusKeyword" })];
    const plugin = seoPlugin({ collections: ["pages"], fields: custom });
    expect(plugin.contributes?.extend?.[0]?.fields).toBe(custom);
  });

  it("defaultSeoFields is a single seo group", () => {
    const fields = defaultSeoFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe("group");
  });
});
