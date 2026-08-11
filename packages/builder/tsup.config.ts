import { defineConfig } from "tsup";

/**
 * One entry for now; the externals are the contract.
 *
 * React and the design system belong to the host application. Bundling either
 * would put a second copy in the consumer's tree — for React that breaks hooks
 * outright, and for `@nextlyhq/ui` it would mean two sets of the CSS custom
 * properties the admin theme is built on.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@nextlyhq/ui",
    "@nextlyhq/plugin-sdk",
  ],
  outExtension() {
    return { js: ".mjs" };
  },
});
