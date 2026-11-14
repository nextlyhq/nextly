/**
 * What `@nextlyhq/admin`'s root publishes: what an application mounts, and the
 * hooks and primitives its README lists for an application's own components.
 *
 * The root is the admin's first load. A library entry cannot drop its own
 * unused exports, so every value exported there is downloaded before any admin
 * screen draws, whether a screen uses it or not. Everything else the admin
 * offers lives in `@nextlyhq/admin/kit` (`src/kit.ts`), which
 * `@nextlyhq/plugin-sdk/admin` re-exports to plugins. Read from the built
 * entries, since those are what ship.
 */
import { join, resolve } from "node:path";

import { exportStatements } from "@nextlyhq/module-specifiers/declaration-exports";
import { ADMIN_ROOT_EXPORTS } from "nextly/admin-root-exports";
import { describe, expect, it } from "vitest";

const DIST = resolve(__dirname, "../../dist");

/** The values a built entry exports, sorted. */
function valueExports(entry: string): string[] {
  const { named, declared, stars } = exportStatements(join(DIST, entry));
  // A whole-module re-export would publish names this list cannot see.
  expect(stars, `${entry} re-exports a whole module`).toEqual([]);
  return [...named.map(name => name.exported), ...declared].sort();
}

const NOT_ON_THE_LIST =
  "@nextlyhq/admin's root exports a value its list does not hold. The root is downloaded before any admin screen draws: a part for plugins belongs in src/kit.ts, which @nextlyhq/plugin-sdk/admin re-exports. A value an application must import from the root is added to ADMIN_ROOT_EXPORTS (nextly's plugins/codegen/admin-root-exports.ts), in the same change: the component-map generator reads the same list.";

describe("the admin's root entry", () => {
  it("exports only the values on its list", () => {
    expect(valueExports("index.mjs"), NOT_ON_THE_LIST).toEqual(
      ADMIN_ROOT_EXPORTS
    );
  });

  it("leaves none of them out of the kit, which the SDK re-exports whole", () => {
    const kit = new Set(valueExports("kit.mjs"));
    expect(ADMIN_ROOT_EXPORTS.filter(name => !kit.has(name))).toEqual([]);
  });

  it("CONTROL: the kit carries the parts plugin pages are built from", () => {
    const kit = new Set(valueExports("kit.mjs"));
    const parts = ["MediaLibrary", "FieldSettingsPanel", "Stepper", "ListView"];
    expect(parts.filter(name => !kit.has(name))).toEqual([]);
    expect(parts.filter(name => ADMIN_ROOT_EXPORTS.includes(name))).toEqual([]);
  });
});
