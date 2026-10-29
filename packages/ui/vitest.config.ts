import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The directories this package's cross-package scans read from.
 *
 * Real paths, not globs, because these are handed to the WATCHER. chokidar
 * removed glob support in v4, so `watcher.add("<root>/packages/**")` subscribes
 * to a literal path of that name — which does not exist — and no event is ever
 * emitted for anything beneath it.
 */
const SCAN_ROOTS = ["packages", "apps", "templates"].map(root =>
  fileURLToPath(new URL(`../../${root}`, import.meta.url)).replace(/\\/g, "/")
);

/**
 * The repository root, as an absolute path with forward slashes.
 *
 * Vitest matches a rerun trigger against the path its watcher emits, which is
 * ABSOLUTE, so a relative glob cannot match one however it is spelled: measured
 * against the picomatch Vitest resolves, `../**` + `/*.tsx` against
 * `<root>/packages/admin/src/ApiKeyTable.tsx` is false. A glob beginning `**` +
 * `/` matches an absolute path because the leading `**` absorbs the prefix,
 * which is why the `src`-scoped triggers below work and hid this for the roots.
 *
 * Backslashes are replaced because picomatch treats one as an escape rather
 * than a separator, so a Windows path would match nothing.
 */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(
  /\\/g,
  "/"
);

export default defineConfig({
  plugins: [
    {
      name: "watch-the-scanned-roots",
      // Two different mechanisms have to agree before a watch session reruns:
      // the watcher must EMIT an event for the file, and `forceRerunTriggers`
      // must MATCH the path it emits. The triggers below only ever answered the
      // second question. Vitest's server is rooted at this package, so nothing
      // outside it was watched at all and the matcher was never consulted for
      // the call sites this suite exists to read — measured with a real
      // `vitest --watch` session, where touching a `packages/admin` file
      // produced no rerun while touching one in `packages/ui` did.
      configureServer(server) {
        for (const root of SCAN_ROOTS) server.watcher.add(root);
      },
    },
  ],
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    // The suites read `theme.css` and the package sources through the
    // filesystem rather than importing them, so Vitest has no module
    // dependency to invalidate and a watch session would keep reporting on
    // files it never re-read.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      // Every extension the cross-package scans read, not only the TypeScript
      // ones. Those scans read with `readFileSync`, so a `.js` or `.jsx` file is
      // in no module graph Vitest can invalidate — without this a watch session
      // keeps showing the previous green after a real violation is added.
      "**/src/**/*.{ts,tsx,js,jsx}",
      // And every ROOT those scans reach, not only this package, and the WHOLE
      // of each root rather than its `src`: the comment guard reads all of
      // `apps/playground`, whose routes live under `app/`. Absolute for the
      // reason given above.
      `${REPO_ROOT}packages/**/*.{ts,tsx,js,jsx}`,
      `${REPO_ROOT}apps/**/*.{ts,tsx,js,jsx}`,
      `${REPO_ROOT}templates/**/*.{ts,tsx,js,jsx}`,
      "**/src/**/*.css",
      // The declaration build runs through both tsdown configs, and a child
      // process loads them — they are in no module graph Vitest can invalidate,
      // so a config that stops emitting an entry point would leave the last
      // green surface result on screen.
      //
      // Deliberately NOT written `**/tsdown*.config.*/**` to match the shape of
      // the entries above, because that shape does not match a FILE. Measured
      // against the picomatch Vitest matches with:
      //
      //   `**/package.json/**`     vs `packages/ui/package.json`     -> true
      //   `**/vitest.config.*/**`  vs `packages/ui/vitest.config.ts` -> false
      //   `**/tsdown*.config.*`    vs `packages/ui/tsdown.config.ts` -> true
      //
      // Only a trailing literal segment collapses onto the file; a segment
      // holding a `*` does not. So two of the three defaults above match
      // nothing — harmless there, since editing a Vitest or Vite config
      // restarts the server anyway, and they are kept to stay in step with the
      // defaults they replace. A trigger for these configs has to be written
      // without the suffix or it would silently never fire.
      "**/tsdown*.config.*",
    ],
  },
});
