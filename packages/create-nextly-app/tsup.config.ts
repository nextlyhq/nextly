import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  // Bundle all dependencies so the CLI is self-contained and works
  // without needing to install dependencies (e.g. via npx or yalc).
  noExternal: [/(.*)/],
  // Inject createRequire so CJS deps (fs-extra, graceful-fs) that use
  // require("fs") work correctly when bundled into ESM output.
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".mjs",
    };
  },
});
