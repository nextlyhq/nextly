import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { declarationBuildInputs } from "./src/__tests__/ensure-declarations";

/**
 * Rerun the suite when a declaration-build input is DELETED.
 *
 * `forceRerunTriggers` covers a changed file, not a removed one: Vitest's
 * unlink handling does not match deleted paths against those patterns, so
 * moving a tsup config out of the tree left a watch session waiting on green
 * while `ensureDeclarations()` never saw the input go missing. Deletion is the
 * case that matters most here — a missing input is the one the freshness check
 * treats as unknown.
 *
 * The rerun is provoked by re-emitting a `change` for a file the graph already
 * watches, rather than by reaching into Vitest's internals, so it does not
 * depend on APIs that are not part of its contract.
 */
function rerunOnDeletedBuildInput(): Plugin {
  // Not `import.meta.filename`, which arrives in Node 20.11 while this
  // repository supports Node 20 — on 20.9 it is `undefined` and the emitted
  // change names nothing.
  const self = fileURLToPath(import.meta.url);
  return {
    name: "nextly:rerun-on-deleted-build-input",
    configureServer(server) {
      server.watcher.on("unlink", (file: string) => {
        // Recomputed per event rather than snapshotted at startup. The chain
        // is exactly the thing that can change during a session — repointing
        // `extends` brings in a config this had never heard of — and a list
        // captured once would be blind to the deletion of whatever arrived
        // after it. The cost is a stat walk on an unlink, which is rare.
        const watched = declarationBuildInputs() ?? [];
        const matches =
          watched.includes(file) ||
          watched.some(input => basename(input) === basename(file));
        // A DELETED input no longer appears in the recomputed list, so a
        // deletion is also recognised by shape: any tsconfig, tsup config or
        // lockfile is a build input of this package whether or not the chain
        // still names it.
        const looksLikeInput =
          /(^|\/)(tsconfig[^/]*\.json|tsup[^/]*\.config\.[cm]?[jt]s|pnpm-lock\.yaml|package\.json)$/.test(
            file
          );
        if (!matches && !looksLikeInput) return;
        server.watcher.emit("change", self);
      });
    },
  };
}

export default defineConfig({
  plugins: [rerunOnDeletedBuildInput()],
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
      // The line above resolves the chain as it stands when Vitest loads this
      // file, and Vitest registers these once at watcher startup — it never
      // re-runs the function. So a session that repoints `extends` at a config
      // it was not already watching would follow the new chain on the next
      // rebuild but stop noticing edits to it. These patterns cover the shared
      // configs by shape rather than by resolution, which is what survives the
      // chain changing underneath a running watcher.
      "**/tsconfig*.json",
      "**/tsconfig/**/*.json",
    ],
  },
});
