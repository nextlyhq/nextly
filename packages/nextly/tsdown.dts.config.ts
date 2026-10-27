import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

import { allEntries, NEVER_BUNDLE } from "./tsdown.config.ts";

// The declarations' second half. `tsc -p tsconfig.dts.json` has written one
// `.d.ts` per source file to `.dts-tmp`; this bundles them into one `.d.mts`
// per entry, beside the `.mjs` the JavaScript build wrote.

const DTS_TMP = "./.dts-tmp";

// tsc keeps the `@nextly/*` aliases in what it writes, so the bundler has to
// resolve them, against `.dts-tmp` instead of `src`. The map is derived from
// tsconfig.json, so the aliases are listed once, and written as a tsconfig
// inside `.dts-tmp` because the bundler's resolvers read paths from a file, not
// from options passed in. Parsed as plain JSON: a comment added to
// tsconfig.json fails this build rather than dropping an alias.
const { compilerOptions } = JSON.parse(
  readFileSync(new URL("./tsconfig.json", import.meta.url), "utf8")
) as { compilerOptions: { paths: Record<string, string[]> } };
// Beside this file whatever the working directory, since anything that loads
// the config (a test reading its entries, say) runs this write.
const DTS_TSCONFIG = fileURLToPath(
  new URL(`${DTS_TMP}/tsconfig.json`, import.meta.url)
);
mkdirSync(fileURLToPath(new URL(DTS_TMP, import.meta.url)), {
  recursive: true,
});
writeFileSync(
  DTS_TSCONFIG,
  JSON.stringify(
    {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: Object.fromEntries(
          Object.entries(compilerOptions.paths).map(([alias, targets]) => [
            alias,
            targets.map(target =>
              target.replace(/^\.\/src\//, "./").replace(/\.ts$/, ".d.ts")
            ),
          ])
        ),
      },
      include: ["**/*.d.ts"],
    },
    null,
    2
  )
);

export default defineConfig({
  // Keyed by the name the JavaScript build gives each entry, so `api/health`
  // is written as `api/health.d.mts` beside `api/health.mjs`.
  entry: Object.fromEntries(
    allEntries.map(entry => {
      const name = entry.replace(/^src\//, "").replace(/\.ts$/, "");
      return [name, `${DTS_TMP}/${name}.d.ts`];
    })
  ),
  format: ["esm"],
  outDir: "dist",
  tsconfig: DTS_TSCONFIG,
  // The JavaScript build has already filled `dist`.
  clean: false,
  deps: {
    neverBundle: id =>
      NEVER_BUNDLE.some(name => id === name || id.startsWith(`${name}/`)),
  },
  dts: {
    dtsInput: true,
    emitDtsOnly: true,
    sourcemap: false,
    tsconfig: DTS_TSCONFIG,
  },
  // Every declaration file `.d.mts`, entries and shared chunks alike, as the
  // JavaScript build names its `.mjs`.
  outputOptions: {
    entryFileNames: "[name].d.mts",
    chunkFileNames: "[name]-[hash].d.mts",
  },
});
