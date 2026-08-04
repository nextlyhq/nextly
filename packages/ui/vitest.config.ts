import { defineConfig } from "vitest/config";

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
  },
});
