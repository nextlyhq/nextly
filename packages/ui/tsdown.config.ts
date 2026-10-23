import { defineConfig } from "tsdown";

import { clientBuildEntries } from "./scripts/published-entries.js";

// Left to the consumer rather than bundled: React and Radix keep component
// state and portals in module-level stores, so a second copy inside this
// bundle would not share that state with the host app's copy. lucide-react,
// sonner and cmdk are declared dependencies the consumer resolves once.
const NEVER_BUNDLE = ["react", "react-dom", "lucide-react", "sonner", "cmdk"];

export default defineConfig({
  // The component surface. Bundling collapses per-file `"use client"`
  // directives — they are a per-module property a bundler drops from
  // non-entry modules — so the directive is applied to the bundle here. That is
  // accurate rather than a blunt instrument: all but a couple of these modules
  // use hooks, context, `forwardRef` or Radix, none of which a Server Component
  // can render. Build-time-only exports are built by tsdown.server-safe.config.ts
  // so they stay importable from server code.
  // Read from the same map the server-safe build and the surface snapshot use, so retargeting
  // the barrel moves all three together rather than leaving the snapshot describing a file the
  // build no longer produces.
  entry: clientBuildEntries(),
  format: ["esm", "cjs"],
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which falls back to `tsc` without saying so when the
  // flag is off.
  dts: { generator: "oxc", sourcemap: false },
  // Cleaning is done once by the build script, not per-config: the two configs
  // also run as concurrent watchers in dev, where a clean here would wipe the
  // server-safe entries and leave them missing until their sources changed.
  clean: false,
  sourcemap: true,
  // Off, as before. The banner below is added after treeshaking, so the
  // directive does not depend on this; consumers' bundlers treeshake this
  // package anyway, since `sideEffects` is declared.
  treeshake: false,
  deps: {
    neverBundle: id =>
      NEVER_BUNDLE.some(name => id === name || id.startsWith(`${name}/`)) ||
      id.startsWith("@radix-ui/"),
  },
  // Keep the file names the exports map already publishes.
  outExtensions({ format }) {
    return format === "cjs"
      ? { js: ".cjs", dts: ".d.cts" }
      : { js: ".mjs", dts: ".d.ts" };
  },
  // CommonJS stays published beside ESM; tsdown's hint to drop it is noise here.
  checks: { legacyCjs: false },
  cjsDefault: false,
  banner: { js: '"use client";' },
});
