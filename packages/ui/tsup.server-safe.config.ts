import { defineConfig } from "tsup";

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
 * tooling and a pure class-name helper. They are built here, without the
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
  entry: {
    "tailwind-preset": "src/tailwind-preset.ts",
    utils: "src/lib/utils.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: false,
  sourcemap: true,
  treeshake: true,
  external,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
