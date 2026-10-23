import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types/index.ts",
    "src/schema/index.ts",
    "src/migrations.ts",
    "src/schema-name.ts",
    "src/text-match.ts",
    "src/version-check.ts",
  ],
  format: ["esm", "cjs"],
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  sourcemap: true,
  // Keep the file names the exports map already publishes.
  outExtensions({ format }) {
    return format === "cjs"
      ? { js: ".cjs", dts: ".d.cts" }
      : { js: ".mjs", dts: ".d.ts" };
  },
  // CommonJS stays published beside ESM; tsdown's hint to drop it is noise here.
  checks: { legacyCjs: false },
  cjsDefault: false,
});
