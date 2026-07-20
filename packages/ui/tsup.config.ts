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

export default defineConfig({
  // The component surface. Bundling collapses per-file `"use client"`
  // directives — they are a per-module property that esbuild drops from
  // non-entry modules — so the directive is applied to the bundle here. That is
  // accurate rather than a blunt instrument: all but a couple of these modules
  // use hooks, context, `forwardRef` or Radix, none of which a Server Component
  // can render. Build-time-only exports are built by tsup.preset.config.ts so
  // they stay importable from server code.
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Cleaning is done once by the build script, not per-config: the two configs
  // also run as concurrent watchers in dev, where a clean here would wipe the
  // server-safe entries and leave them missing until their sources changed.
  clean: false,
  sourcemap: true,
  // Rollup runs the treeshaking pass and drops directives from the bundle,
  // including one declared in the entry source, so treeshaking here is mutually
  // exclusive with shipping `"use client"`. Correctness wins: the directive is
  // required for any Server Component import to work, while the bytes it costs
  // are recovered by consumers, whose own bundlers treeshake this package now
  // that `sideEffects` is declared.
  treeshake: false,
  external,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
  banner: { js: '"use client";' },
});
