import { defineConfig } from "tsdown";

export default defineConfig({
  // The public entry points: the Node-safe root and the admin components.
  // (The former components entry existed only for the never-mounted
  // submission components, which are gone.)
  entry: ["src/index.ts", "src/admin/index.ts"],
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map already publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
