import { defineConfig } from "tsdown";

// Bundles every dep (posthog-node, conf, env-paths, picocolors) into the
// output so consumers (create-nextly-app, nextly) don't need to add them
// as runtime dependencies.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  deps: { alwaysBundle: [/(.*)/] },
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
