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
  // Declarations written by oxc from the source's own annotations, which
  // `isolatedDeclarations` requires; set explicitly so a build can never fall
  // back to the type checker without anyone noticing.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  treeshake: true,
  deps: { neverBundle: ["nextly", "@nextlyhq/admin", "react", "react-dom"] },
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
