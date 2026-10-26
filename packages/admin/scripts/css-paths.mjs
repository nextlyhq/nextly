/**
 * The paths both admin CSS builds agree on, in one place.
 *
 * The release build (build-css.mjs) and the dev build (build-css-fast.mjs)
 * compile the same entry to the same output; their path constants were
 * declared twice and drifted into a clone. Each build passes its own root —
 * the dev build resolves its directory through a real path for symlink
 * preservation, the release build does not — so only the joins live here.
 */
import path from "node:path";

/**
 * The admin CSS build paths under `rootDir` (the admin package root).
 *
 * `outputDir` is included because the dev build creates it on demand, and
 * the release build's temp files live beside `outputFile` in it.
 */
export function cssPaths(rootDir) {
  const outputDir = path.join(rootDir, "dist/styles");
  return {
    inputFile: path.join(rootDir, "src/styles/globals.css"),
    outputDir,
    outputFile: path.join(outputDir, "globals.css"),
  };
}
