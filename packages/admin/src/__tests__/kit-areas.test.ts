/**
 * The kit is its areas, whole and without overlap.
 *
 * `@nextlyhq/plugin-sdk/admin` re-exports each name from the kit area that
 * holds it (`@nextlyhq/admin/kit/<area>`), so a plugin's admin module brings
 * only the areas it names. That holds only while every name the kit exports
 * lives in exactly one area, and every area is a published entry: a name in
 * no area would leave the SDK nothing to re-export it from, and a name in two
 * would let a plugin bring one area for a part another holds. Read from the
 * built entries, since those are what ship.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { exportStatements } from "@nextlyhq/module-specifiers/declaration-exports";
import { describe, expect, it } from "vitest";

const PACKAGE = resolve(__dirname, "../..");
const DIST = join(PACKAGE, "dist");

/** The kit's areas, as `src/kit.ts` lists them. */
const AREAS = [
  "core",
  "document",
  "field-ui",
  "media",
  "plugin-parts",
  "table",
  "widgets",
];

/** The values a built entry exports. */
function valueExports(entry: string): string[] {
  const { named, declared } = exportStatements(join(DIST, entry));
  return [...named.map(name => name.exported), ...declared];
}

const manifest = JSON.parse(
  readFileSync(join(PACKAGE, "package.json"), "utf8")
) as { exports: Record<string, unknown> };

describe("the kit's areas", () => {
  it("together export exactly what the kit does", () => {
    const fromAreas = AREAS.flatMap(area => valueExports(`kit/${area}.mjs`));
    expect([...fromAreas].sort()).toEqual(valueExports("kit.mjs").sort());
  });

  it("export each name from one area only", () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const area of AREAS) {
      for (const name of valueExports(`kit/${area}.mjs`)) {
        if (seen.has(name)) twice.push(`${name}: ${seen.get(name)}, ${area}`);
        seen.set(name, area);
      }
    }
    expect(twice).toEqual([]);
  });

  it("are each a published entry", () => {
    expect(
      AREAS.filter(area => manifest.exports[`./kit/${area}`] === undefined)
    ).toEqual([]);
  });

  it("CONTROL: put the parts plugin pages are built from in their own areas", () => {
    const areaOf = (name: string) =>
      AREAS.find(area => valueExports(`kit/${area}.mjs`).includes(name));
    expect(areaOf("MediaLibrary")).toBe("media");
    expect(areaOf("FieldSettingsPanel")).toBe("field-ui");
    expect(areaOf("Stepper")).toBe("plugin-parts");
    expect(areaOf("ListView")).toBe("table");
  });
});
