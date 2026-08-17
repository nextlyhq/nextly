/**
 * Vendor the Scalar standalone browser bundle into src/vendor as a text asset.
 *
 * The docs route serves Scalar same-origin (no CDN). The bundle is imported as
 * a STRING at build time rather than resolved at runtime: the plugin's dist is
 * pulled into the host app's Next bundle, where a bundler statically analyzes
 * any literal require.resolve("@scalar/...") and fails on it, and where
 * import.meta.url points into the bundle, not the package — runtime resolution
 * cannot survive that. A text import is inert data to every bundler.
 *
 * Run by build/check-types/test so the generated asset exists wherever the
 * module graph needs it. Fails loudly when the dependency is missing.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(pkgRoot, "package.json"));

let pkgDir;
try {
  pkgDir = dirname(require.resolve("@scalar/api-reference/package.json"));
} catch {
  // The exports map does not expose the manifest; walk up from the main entry.
  let dir = dirname(require.resolve("@scalar/api-reference"));
  const { existsSync } = await import("node:fs");
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
  pkgDir = dir;
}

const source = join(pkgDir, "dist", "browser", "standalone.js");
const target = join(pkgRoot, "src", "vendor", "scalar-standalone.js.txt");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`vendored Scalar bundle → ${target} (from ${source})`);
