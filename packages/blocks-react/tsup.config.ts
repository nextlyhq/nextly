import { defineConfig } from "tsup";

/**
 * Two entries, and the split is the package's central contract.
 *
 * `index` renders block documents with React alone: no Next.js, no CMS, no
 * database. That is what lets the renderer be used standalone, and a test
 * enforces it.
 *
 * `next` is the only Next-coupled surface. Keeping it in its own entry means a
 * consumer who imports the renderer never pulls `next/*` into their graph, and
 * bundlers can drop it entirely. Puck ships a separate `/rsc` bundle for the
 * same reason: one bundle cannot serve both an editor-aware and a
 * server-rendering consumer.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/next.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // React and Next are the consumer's; bundling either would produce a second
  // copy of React in the tree, which breaks hooks and RSC alike.
  external: ["react", "react/jsx-runtime", "next"],
  outExtension() {
    return { js: ".mjs" };
  },
});
