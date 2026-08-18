import { defineConfig } from "tsup";

// Builds the publishable plugin. `dev/` is NOT an entry — it never ships.
// nextly / admin / sdk / ui / react are peers, kept external: bundling one
// would ship a second copy of code the host already provides.
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
    "@nextlyhq/ui",
    "react",
    "react-dom",
  ],
  outExtension() {
    return { js: ".mjs" };
  },
});
