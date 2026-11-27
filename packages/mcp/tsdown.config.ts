import { defineConfig } from "tsdown";

export default defineConfig({
  // One Node-safe entry: the adapter couples to no web framework, so the
  // chat-app door and the local door load the same file.
  entry: ["src/index.ts"],
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check. oxc
  // writes them from the source's own annotations (`isolatedDeclarations`).
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
