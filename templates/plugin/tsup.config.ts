import { defineConfig } from "tsup";

// Builds the publishable plugin. `dev/` is NOT an entry — it never ships.
// nextly / admin / react are peers, kept external.
export default defineConfig({
  entry: ["src/index.ts", "src/admin/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "nextly",
    "@nextlyhq/admin",
    "@nextlyhq/plugin-sdk",
    "react",
    "react-dom",
  ],
  outExtension() {
    return { js: ".mjs" };
  },
});
