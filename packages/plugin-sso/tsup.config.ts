import { defineConfig } from "tsup";

export default defineConfig({
  // Single Node-safe entry. The admin components ship from a separate entry
  // once Phase 6 adds them; until then the plugin has no `react` coupling and
  // stays usable in headless and admin-only projects.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
