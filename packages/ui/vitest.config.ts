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
      // Deliberately NOT written `**/tsup*.config.*/**` to match the entries
      // above: picomatch does not match `tsup.config.ts` against that, because
      // a `*` before the trailing `/**` stops the pattern collapsing onto the
      // file itself. Those entries are Vitest's own defaults and match only
      // because a literal segment does collapse. Given the same suffix these
      // would silently never fire.
      "**/tsup*.config.*",
    ],
  },
});
