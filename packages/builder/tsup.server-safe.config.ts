import { defineConfig } from "tsup";

/**
 * The parts of this package that contain no React.
 *
 * `geometry` maps a canvas rectangle into host coordinates; `shell-state`
 * decides which panel the rail opens, what the shell's declared bounds are, and
 * how chrome preferences are read and written. Both are arithmetic and set
 * membership, and neither imports anything at all.
 *
 * `ops` is the vocabulary every edit is expressed in and the function that
 * applies one. It belongs here because an op is a change to a DOCUMENT rather
 * than a gesture in a React tree: a server action promoting a selection to a
 * component, and an agent asked to insert a section, apply the same ops the
 * canvas does. Published only from the root barrel, those callers had two
 * options and both were wrong — pull a client boundary into a server module,
 * or grow a second implementation that agrees with this one until the day it
 * does not. It imports `@nextlyhq/blocks-engine` and nothing else.
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
  // The ROOT entry is built here too, and that is the point rather than an
  // accident of grouping. It exports the package name, the frame geometry and
  // the shell's declared bounds — none of which is React — and it describes
  // `BuilderShellProps` as a TYPE, which is erased. Built by the client config
  // it would have inherited the shell's banner and turned every one of those
  // into a client reference.
  entry: [
    "src/index.ts",
    "src/geometry.ts",
    "src/shell-state.ts",
    "src/ops.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: false,
  sourcemap: true,
  // Only reached through the type side of the root entry's declarations; no
  // runtime import here pulls any of them in. Declared so `dts` resolves them
  // rather than trying to bundle a copy.
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@nextlyhq/ui",
    "@nextlyhq/plugin-sdk",
  ],
  // Safe here, unlike the root config: with no directive to preserve, there is
  // nothing for the treeshaking pass to strip.
  treeshake: true,
  outExtension() {
    return { js: ".mjs" };
  },
});
