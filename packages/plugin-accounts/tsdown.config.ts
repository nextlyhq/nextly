import { defineConfig } from "tsdown";

export default defineConfig({
  // Four entries. The root carries the plugin, its settings, its schema and
  // its typed server functions, all Node-safe; `testing` carries the
  // stand-ins for core's account capabilities, so a site's tests can use them
  // without ever loading test code from the root; `next` carries the server
  // actions and helpers, the one entry that imports Next.js; `admin` carries
  // the staff screens, a client module the root never imports, so React
  // stays out of the server.
  entry: [
    "src/index.ts",
    "src/testing/index.ts",
    "src/next/index.ts",
    "src/admin/index.ts",
  ],
  // Next.js is the site's own, an optional peer dependency: bundling it would
  // load a second copy beside the site's, whose request context ours would
  // never see.
  deps: { neverBundle: [/^next(\/|$)/] },
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map already publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
