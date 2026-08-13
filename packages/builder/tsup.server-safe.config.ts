import { defineConfig } from "tsup";

/**
 * The parts of this package that contain no React.
 *
 * `geometry` maps a canvas rectangle into host coordinates; `shell-state`
 * decides which panel the rail opens, what the shell's declared bounds are, and
 * how chrome preferences are read and written. Both are arithmetic and set
 * membership, and neither imports anything at all.
 *
 * Built SEPARATELY from the root entry because that entry carries a
 * `"use client"` banner. The banner is required there — the shell is a client
 * component and Rollup drops per-module directives — but it applies to
 * everything the entry re-exports, which marked these two as client-only as
 * well. A Server Component could then not compute a layout bound or a
 * coordinate, for no reason other than how the bundle was assembled.
 *
 * That was not hypothetical. `e2e/tests/canvas/coordinate-mapping.ts` already
 * imports the geometry, and it kept working only because that package resolves
 * `@nextlyhq/builder` through a tsconfig path mapping to SOURCE, bypassing the
 * published entry entirely. The export map was advertising something the
 * artifact could not deliver, and the one consumer was not using the artifact.
 *
 * Same split, and the same reason, as `@nextlyhq/ui`'s `./color` and `./utils`.
 *
 * Neither config cleans `dist`; the root config does that once, and this one
 * runs after it.
 */
export default defineConfig({
  entry: ["src/geometry.ts", "src/shell-state.ts"],
  format: ["esm"],
  dts: true,
  clean: false,
  sourcemap: true,
  // Safe here, unlike the root config: with no directive to preserve, there is
  // nothing for the treeshaking pass to strip.
  treeshake: true,
  outExtension() {
    return { js: ".mjs" };
  },
});
