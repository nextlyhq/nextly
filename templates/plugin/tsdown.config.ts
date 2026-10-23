import { defineConfig } from "tsdown";

// The host provides these. Each name and its subpaths stay external: bundling
// one would ship a second copy of code the host already provides.
const HOST_PACKAGES = [
  "nextly",
  "@nextlyhq/admin",
  "@nextlyhq/plugin-sdk",
  "@nextlyhq/ui",
  "react",
  "react-dom",
];

// Builds the publishable plugin. `dev/` is NOT an entry — it never ships.
export default defineConfig({
  entry: ["src/index.ts", "src/admin/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  deps: {
    neverBundle: id =>
      HOST_PACKAGES.some(name => id === name || id.startsWith(`${name}/`)),
  },
  // `.mjs` and `.d.ts`, the names the package's exports map publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
