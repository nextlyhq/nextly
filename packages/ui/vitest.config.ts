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
      "**/src/**/*.{ts,tsx}",
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
