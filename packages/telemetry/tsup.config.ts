import { defineConfig } from "tsup";

// Bundles every dep (posthog-node, conf, env-paths, picocolors) into the
// output so consumers (create-nextly-app, nextly) don't need to add them
// as runtime dependencies.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  noExternal: [/(.*)/],
  outExtension() {
    return { js: ".mjs" };
  },
});
