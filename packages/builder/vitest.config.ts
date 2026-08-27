import { defineConfig } from "vitest/config";

import { TEST_GLOBS } from "./src/source-modules";

/**
 * The suite is static analysis over source files, not rendering.
 *
 * `node` rather than a DOM environment because nothing here mounts a
 * component: the layering checks read files and walk the import graph, and a
 * DOM environment would add startup cost for capability none of them use. When
 * renderer tests arrive they will need `jsdom`, and switching then is a
 * deliberate change rather than an inherited default.
 *
 * The include list is DERIVED rather than written here. The layering guard
 * relaxes its import allowlist for anything it considers a test, so the runner
 * and the guard have to mean the same thing by the word: a hand-written glob
 * that omitted an extension the guard accepted would let a file import `vitest`
 * and never be run. Both now come from one list in `src/source-modules.ts`.
 *
 * `globalSetup` is what keeps that derivation honest. Narrowing the one list
 * narrows these globs too, and a suite that stops being collected reports the
 * same green as a suite that passed — so the check that the runner still
 * collects every test on disk cannot itself be a test, because the narrowing
 * would un-collect it. It runs before collection instead, where no glob decides
 * whether it executes.
 */

export default defineConfig({
  test: {
    environment: "node",
    include: TEST_GLOBS,
    globalSetup: ["./vitest.global-setup.ts"],
    // Runs fresh inside EACH test file's own resolved environment, which is
    // what lets one file serve both the node suites and the jsdom ones — see
    // the guard it opens with.
    setupFiles: ["../../scripts/vitest-dom-setup.ts"],
  },
});
