import { defineConfig } from "vitest/config";

// The engine is plain Node with no globals: tests import from vitest explicitly
// and run in the node environment, scoped to this package's own src suites.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Set for the PACKAGE rather than per test, because this package's suites
    // are CPU-bound walks over deliberately large synthetic documents and
    // vitest's 5 s default is a budget none of them was written against.
    //
    // Annotating one test at a time is the approach this replaces. It requires
    // predicting which case is expensive, and each wrong prediction costs a red
    // gate for the whole repository before anyone finds out — three separate
    // cases have now had to be discovered that way.
    //
    // Sized from a measured environment factor rather than guessed. A CI runner
    // executing several matrix legs at once was ~50x slower per unit of work
    // than a developer machine here, measured across tests that PASSED, and the
    // slowest case in this package outside `performance.test.ts` runs in about
    // 160 ms locally — so roughly 8 s under load. Thirty seconds leaves headroom
    // over that while staying far below the point where a genuine hang would go
    // unnoticed for long. `performance.test.ts` keeps its own larger explicit
    // budget, which is about the size of the documents it builds.
    testTimeout: 30_000,
  },
});
