import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/testing.ts",
    "src/client.ts",
    "src/admin.ts",
    "src/blocks.ts",
    "src/routing.ts",
    "src/widgets.ts",
    "src/db.ts",
    "src/schema.ts",
  ],
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  clean: true,
  sourcemap: true,
  treeshake: true,
  deps: { neverBundle: ["nextly", "@nextlyhq/admin", "react", "react-dom"] },
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
