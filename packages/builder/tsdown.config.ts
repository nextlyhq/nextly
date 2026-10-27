import { defineConfig } from "tsdown";

// Packages this build never bundles: each name and its subpaths.
const NEVER_BUNDLE = [
  "react",
  "react-dom",
  "@nextlyhq/ui",
  "@nextlyhq/plugin-sdk",
];

/**
 * The CLIENT entry, and the externals are the contract.
 *
 * React and the design system belong to the host application. Bundling either
 * would put a second copy in the consumer's tree — for React that breaks hooks
 * outright, and for `@nextlyhq/ui` it would mean two sets of the CSS custom
 * properties the admin theme is built on.
 *
 * `src/shell.ts` rather than `src/index.ts`, because the banner below applies to
 * the WHOLE artifact and everything it re-exports. Built from the root barrel it
 * marked the frame geometry as client-only too — plain arithmetic that a Server
 * Component is meant to call, and part of this package's public surface before
 * the shell existed. The root entry is built by the server-safe config instead,
 * so the boundary sits where the React is.
 */
export default defineConfig({
  entry: ["src/shell.ts"],
  // This entry carries the directive for the shell. `builder-shell.tsx` declares
  // its own, but it is bundled as a NON-entry module and treeshaking drops
  // module-level directives from those — so the published entry would arrive
  // without it and a Next host would try to render the editor on the server.
  banner: { js: '"use client";' },
  // The chrome stylesheet is NOT copied here. It is compiled by `build:css`
  // with the Tailwind CLI, because the shell draws with utility classes and a
  // verbatim copy ships the custom properties without the rules that use them.
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  // NOT `clean`. This config is one of three producers writing into the same
  // `dist`, and under `--watch` a clean here deletes the other two's output on
  // every rebuild — the root entry, the server-safe subpaths and the compiled
  // stylesheet all vanish until something else happens to rewrite them. The
  // build script clears the directory once, up front, where nothing races it.
  clean: false,
  sourcemap: true,
  // Off, as before. The banner above is added after treeshaking, so the
  // directive does not depend on this; the bytes are recovered by consumers,
  // whose own bundlers treeshake this package now that `sideEffects` is
  // declared. `@nextlyhq/ui` keeps the same setting.
  treeshake: false,
  deps: {
    neverBundle: id =>
      NEVER_BUNDLE.some(name => id === name || id.startsWith(`${name}/`)),
  },
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
