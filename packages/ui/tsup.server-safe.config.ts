import { defineConfig } from "tsup";

import { serverSafeBuildEntries } from "./scripts/published-entries.mjs";

// Left to the consumer rather than bundled: React and Radix keep component
// state and portals in module-level stores, so a second copy inside this
// bundle would not share that state with the host app's copy. lucide-react,
// sonner and cmdk are declared dependencies the consumer resolves once.
const external = [
  "react",
  "react-dom",
  "lucide-react",
  "sonner",
  "cmdk",
  /^@radix-ui\//,
];

/**
 * The exports that contain no React runtime: a Tailwind preset read by build
 * tooling, a pure class-name helper, and colour conversions that are arithmetic
 * on numbers. They are built here, without the
 * component bundle's `"use client"` banner, so server code can import them.
 *
 * Built separately from the component bundle so the client banner does not
 * apply here. Neither config cleans `dist`; the build script does that once up
 * front, which also keeps the two dev watchers from clobbering each other.
 */
export default defineConfig({
  // Named so the output stays flat: with plain paths tsup mirrors the source
  // tree from the common root and emits `dist/lib/utils.*`, which would not
  // match the exports map.
  // Read from the export-map derivation rather than declared here, so a subpath's source is
  // stated once. When this config owned it and the surface snapshot kept a copy, retargeting an
  // entry left the snapshot comparing the old barrel while the new one shipped unchecked.
  entry: serverSafeBuildEntries(),
  format: ["esm", "cjs"],
  // The build's own record of every file that went into each artifact. A specifier scan can only
  // see what SURVIVES, and a bundled dependency leaves none — `culori` is a devDependency, so it
  // would be inlined whole with nothing left to name. This makes the origins visible.
  metafile: true,
  dts: true,
  clean: false,
  sourcemap: true,
  treeshake: true,
  external,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
