/**
 * The paths both admin CSS builds agree on, in one place.
 *
 * Both builds compile the same entry to the same output: the dev build
 * (build-css-fast.mjs) takes all three paths from here, while the release
 * build (build-css.mjs) compiles through compile-tailwind.mjs, which owns the
 * entry (`STYLES_ENTRY`) and joins the same output paths from its
 * `PACKAGE_ROOT`. The dev build passes its own root — it resolves its
 * directory through a real path for symlink preservation — so only the joins
 * live here.
 */
import path from "node:path";

/**
 * The admin CSS build paths under `rootDir` (the admin package root).
 *
 * `outputDir` is included because the dev build creates it on demand.
 */
export function cssPaths(rootDir) {
  const outputDir = path.join(rootDir, "dist/styles");
  return {
    inputFile: path.join(rootDir, "src/styles/globals.css"),
    outputDir,
    outputFile: path.join(outputDir, "globals.css"),
  };
}
