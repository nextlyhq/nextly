import { defineConfig } from "tsup";

export default defineConfig({
  // The public entry points: the Node-safe root and the admin components.
  // (The former components entry existed only for the never-mounted
  // submission components, which are gone.)
  entry: ["src/index.ts", "src/admin/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
