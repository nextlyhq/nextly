import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/testing.ts", "src/client.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["nextly", "@nextlyhq/admin", "react", "react-dom"],
  outExtension() {
    return { js: ".mjs" };
  },
});
