import { defineConfig } from "tsdown";

export default defineConfig({
  // The Node-safe root, with no `next` or `react` coupling, so it stays usable
  // in headless projects, and the admin's SEO tab, which only the admin loads.
  entry: ["src/index.ts", "src/admin/index.ts"],
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map already publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
