import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suites read `theme.css` and the package sources through the
    // filesystem rather than importing them, so Vitest has no module
    // dependency to invalidate and a watch session would keep reporting on
    // files it never re-read.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      // Every extension the tab-contract scan reads, not only the TypeScript
      // ones. That scan walks the repository with `readFileSync`, so a `.js` or
      // `.jsx` call site is in no module graph Vitest can invalidate — without
      // this a watch session keeps showing the previous green after a real
      // violation is added. Kept in step with `CALL_SITE_EXTENSIONS` in
      // `src/components/__tests__/tabs-contract.test.ts`, which asserts this
      // list covers it.
      "**/src/**/*.{ts,tsx,js,jsx}",
      // And every ROOT that scan walks, not only this package, and the WHOLE
      // of each root rather than its `src`. The traversal recurses from the
      // root, so `packages/foo/examples/demo.jsx` is a call site it reads — and
      // a `src`-only trigger left that file able to gain a violation with the
      // suite never rerunning. The scan's reach is what these have to match,
      // not the convention most files happen to follow.
      //
      // Kept in step with `CALL_SITE_ROOT_GLOBS` in
      // `src/components/__tests__/tabs-contract.test.ts`, which asserts this
      // list covers every root-and-extension pair the scan reads.
      "../**/*.{ts,tsx,js,jsx}",
      "../../apps/**/*.{ts,tsx,js,jsx}",
      "../../templates/**/*.{ts,tsx,js,jsx}",
      "**/src/**/*.css",
      // The declaration build runs through both tsup configs, and a child
      // process loads them — they are in no module graph Vitest can invalidate,
      // so a config that stops emitting an entry point would leave the last
      // green surface result on screen.
      //
      // Deliberately NOT written `**/tsup*.config.*/**` to match the shape of
      // the entries above, because that shape does not match a FILE. Measured
      // against the picomatch Vitest matches with:
      //
      //   `**/package.json/**`     vs `packages/ui/package.json`     -> true
      //   `**/vitest.config.*/**`  vs `packages/ui/vitest.config.ts` -> false
      //   `**/tsup*.config.*`      vs `packages/ui/tsup.config.ts`   -> true
      //
      // Only a trailing literal segment collapses onto the file; a segment
      // holding a `*` does not. So two of the three defaults above match
      // nothing — harmless there, since editing a Vitest or Vite config
      // restarts the server anyway, and they are kept to stay in step with the
      // defaults they replace. A trigger for these configs has to be written
      // without the suffix or it would silently never fire.
      "**/tsup*.config.*",
    ],
  },
});
