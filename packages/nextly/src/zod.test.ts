import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z as nextlysOwnZod } from "zod";

const packageRoot = resolve(__dirname, "..");

describe("nextly/zod", () => {
  // Generated schema files import Zod from this entry, so an app that depends
  // on `nextly` but not on `zod` can still compile them. Missing from the
  // exports map, or from the build, the import fails in exactly those apps.
  it("is a published entry with its types", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8")
    ) as { exports: Record<string, { types?: string; import?: string }> };

    expect(manifest.exports["./zod"]).toEqual({
      types: "./dist/zod.d.mts",
      import: "./dist/zod.mjs",
    });
  });

  it("is built, as a client-safe entry", () => {
    // Schemas run in the browser as well as on the server, so the entry sits
    // with the others a browser bundle may reach, where the admin's bundle
    // boundary test holds it to that.
    const buildConfig = readFileSync(
      resolve(packageRoot, "tsdown.config.ts"),
      "utf8"
    );
    const clientEntries = buildConfig.slice(
      buildConfig.indexOf("const clientEntries = ["),
      buildConfig.indexOf("];", buildConfig.indexOf("const clientEntries = ["))
    );

    expect(clientEntries).toContain('"src/zod.ts"');
  });

  it("re-exports the very Zod Nextly uses, so app code and generated schemas share one instance", async () => {
    // A second copy would let `z.object({ post: PostSchema })` mix instances,
    // which Zod does not support across versions. Identity, not shape: a fresh
    // install of another Zod would pass a check on `z.object` alone.
    const entry = await import("./zod");

    expect(entry.z).toBe(nextlysOwnZod);
  });
});
