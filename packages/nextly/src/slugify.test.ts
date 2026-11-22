/**
 * `nextly/slugify`: core's one slug rule, published as a leaf a browser bundle
 * may import, so a plugin's dialog previews an address by the very function
 * the server makes it with rather than by a copy of it.
 *
 * What separates it from a plausible broken entry: the root's `slugify` and
 * the auto-slug hook's are this function, not an equal one; the module
 * imports nothing, so a browser takes nothing more; and the export map and
 * the build both name it, since either alone publishes an entry that is
 * missing on install.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importedSpecifiers } from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

import { slugify as hookSlugify } from "./hooks/prebuilt";
import { slugify } from "./slugify";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("core's slug rule", () => {
  it("is the auto-slug hook's own function, which the root publishes", () => {
    expect(hookSlugify).toBe(slugify);
  });

  it("lowers, drops accents and joins every run of other characters with one hyphen", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("Café & Restaurant")).toBe("cafe-restaurant");
    expect(slugify("  Multiple   Spaces  ")).toBe("multiple-spaces");
  });

  it("imports nothing, so a browser bundle reaching it takes nothing more", () => {
    const file = resolve(HERE, "slugify.ts");
    expect(importedSpecifiers(readFileSync(file, "utf8"), file)).toEqual([]);
  });

  it("is published as `nextly/slugify`, and built as a client-safe entry", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(HERE, "../package.json"), "utf8")
    ) as { exports: Record<string, { types?: string; import?: string }> };
    expect(pkg.exports["./slugify"]).toEqual({
      types: "./dist/slugify.d.mts",
      import: "./dist/slugify.mjs",
    });
    const build = readFileSync(resolve(HERE, "../tsdown.config.ts"), "utf8");
    const client = build.slice(
      build.indexOf("const clientEntries = ["),
      build.indexOf("];", build.indexOf("const clientEntries = ["))
    );
    expect(client).toContain('"src/slugify.ts"');
  });
});
