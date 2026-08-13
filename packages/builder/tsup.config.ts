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
  // The entry carries the directive for the whole package. `builder-shell.tsx`
  // declares its own, but it is bundled as a NON-entry module and treeshaking
  // drops module-level directives from those — so the published entry would
  // arrive without it and a Next host would try to render the editor on the
  // server. The whole package is an editor and is client-only by nature, which
  // is the same treatment `@nextlyhq/ui`'s root barrel gets.
  banner: { js: '"use client";' },
  // The chrome stylesheet is NOT copied here. It is compiled by `build:css`
  // with the Tailwind CLI, because the shell draws with utility classes and a
  // verbatim copy ships the custom properties without the rules that use them.
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Mutually exclusive with the banner above, and correctness wins. Rollup runs
  // the treeshaking pass and drops module-level directives from the bundle —
  // including one in the entry source — so a treeshaken build ships without
  // `"use client"` and a Server Component importing it fails. The bytes are
  // recovered by consumers, whose own bundlers treeshake this package now that
  // `sideEffects` is declared. `@nextlyhq/ui` made the same trade for the same
  // reason.
  treeshake: false,
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
