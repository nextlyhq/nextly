import { defineConfig, type UserConfig } from "tsdown";

/**
 * Two entries, and the split is the package's central contract.
 *
 * `index` renders block documents with React alone: no Next.js, no CMS, no
 * database. That is what lets the renderer be used standalone, and a test
 * enforces it.
 *
 * `blocks` is the core library. Its own entry rather than part of `index`
 * because it grows toward the full primitive set while the root entry is the
 * renderer's contract, and a consumer supplying their own blocks should not
 * carry ours.
 *
 * `next` is the only Next-coupled surface. Keeping it in its own entry means a
 * consumer who imports the renderer never pulls `next/*` into their graph, and
 * bundlers can drop it entirely. Puck ships a separate `/rsc` bundle for the
 * same reason: one bundle cannot serve both an editor-aware and a
 * server-rendering consumer.
 *
 * `environment` is the client entry, and has a build of its own below.
 */
/** What both builds share. */
const shared = {
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  sourcemap: true,
  treeshake: true,
  // React and Next are the consumer's; bundling either would produce a second
  // copy of React in the tree, which breaks hooks and RSC alike.
  deps: { neverBundle: ["react", "react/jsx-runtime", "next"] },
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
} satisfies UserConfig;

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts", "src/next.ts", "src/blocks/index.ts"],
    clean: true,
  },
  /*
   * `environment` is the one CLIENT entry, built apart so nothing else is ever
   * bundled into a chunk with it. Its module's own `"use client"` is kept
   * because it is an entry module (a bundler drops directives only from the
   * modules it folds into a chunk); `environment-directive.test.ts` holds the
   * published file to that. A Next host given the file without the directive
   * would try to create a React context on the server, where there is none.
   * Not `clean`: the build above owns the directory and has already cleared it
   * when this one writes beside it.
   */
  {
    ...shared,
    entry: ["src/environment.tsx"],
    clean: false,
  },
]);
