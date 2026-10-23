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
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
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
