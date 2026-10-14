import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * This package's own version, read from its package.json.
 *
 * The whole Nextly family versions in lockstep with it, so it also names the
 * packages released alongside this CLI (see copyTemplate's releaseVersion).
 * Read here rather than taken as an option, so every entry point (the binary
 * and a direct createNextly call) gets the same answer. The manifest is found
 * by walking up from this module, which sits at a different depth in src/ than
 * in the built dist/, and is read on first use rather than at import.
 */
let cached: string | undefined;

export function packageVersion(): string {
  if (cached !== undefined) return cached;

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf-8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === "create-nextly-app" && manifest.version) {
        cached = manifest.version;
        return cached;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("create-nextly-app could not find its own package.json.");
    }
    dir = parent;
  }
}
