import { defineConfig } from "vitest/config";

import { declarationBuildInputs } from "./src/__tests__/ensure-declarations";

export default defineConfig({
  test: {
    // The release-tag guard reads this package's OWN `dist/index.d.ts`: the
    // tags it checks are written by the declaration bundler, so there is
    // nothing to assert against until the package is built.
    //
    // A global setup rather than a build chained into the `test` script. That
    // chain covered one entry point of four — `test:watch`, `test:ui` and
    // `test:coverage` all invoke vitest directly — and it ran `rimraf dist`
    // inside the parallel task graph, where other packages are reading this
    // package's artifacts at the same time. This runs for every entry point,
    // rebuilds only when the declarations are stale, and never removes them.
    globalSetup: ["./src/__tests__/global-setup.ts"],

    // The surface guard READS the sources rather than importing them (the
    // barrel ships `"use client"` and pulls in the whole component tree, which
    // does not belong in a Node test process). Vitest therefore sees no module
    // dependency on them, and in watch mode an edit to `src/index.ts` reran
    // nothing: the suite kept reporting on declarations built before the edit,
    // so a wrong release tag stayed green until a manual restart. Naming the
    // sources as rerun triggers is what puts them back in the watch graph.
    //
    // The defaults are repeated because this REPLACES them rather than adding
    // to them, and dropping them would stop a config or manifest edit from
    // triggering a rerun at all.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      "**/src/**/*.{ts,tsx}",
      // The overlay and contrast suites read `theme.css` the same way, so a
      // deleted dark-mode token or a contrast regression stayed green in watch
      // mode until a restart. CSS is not a module here, so nothing else puts it
      // in the graph.
      "**/src/**/*.css",
      // The declaration build's own inputs, taken from the same list the
      // freshness check uses rather than restated as globs. Naming them by
      // hand meant `**/tsconfig.json` matched only the package's own file
      // while the options that decide the output live in the configs it
      // extends, none of which are called `tsconfig.json`. Deriving them
      // keeps the watcher and the rebuild looking at one set of files.
      ...(declarationBuildInputs() ?? []),
    ],
  },
});
