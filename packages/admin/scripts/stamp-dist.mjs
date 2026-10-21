#!/usr/bin/env node

/**
 * stamp-dist.mjs — Write the build's provenance into the dist.
 *
 * The bundle report labels its bytes with a commit; without a stamp, a dist
 * from an older checkout or another branch wears whichever commit the
 * checkout holds, and nothing can tell. The build chain runs this last
 * (package.json `build`), after tsup's clean, so the stamp always describes
 * the bytes the dist now holds.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let commit = "unversioned";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: PACKAGE_ROOT,
    stdio: ["pipe", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  // No readable git: the stamp still records when the build ran.
}

writeFileSync(
  join(PACKAGE_ROOT, "dist", ".build-info.json"),
  `${JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2)}\n`
);
console.log(`[stamp-dist] dist stamped: ${commit.slice(0, 12)}`);
