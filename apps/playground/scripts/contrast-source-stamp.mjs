/**
 * Identifies the contrast harness a measurement was taken against.
 *
 * A failure count is a property of (theme x contrast source), not of the theme:
 * a recorded 58 became 48 with the theme untouched, because the shared harness
 * moved underneath it. Stored bare, such a number stays authoritative-looking
 * after it stops being true, and the drift gets hunted for in the theme.
 *
 * The identifier is a hash of the harness's CONTENTS rather than the commit
 * that last touched it, for three reasons the commit form got wrong:
 *
 * 1. A generator run before committing records the PREVIOUS commit, so the
 *    stamp is stale the moment it is written and only accidentally correct if
 *    the commit that writes it is also the last to touch the harness.
 * 2. A rebase or squash changes the commit without changing a single input,
 *    announcing drift that did not happen.
 * 3. A commit identifier cannot be checked. A content hash can be recomputed
 *    and compared, which turns "a stale reading announces itself" from a claim
 *    in a banner into something a test enforces.
 *
 * Tests under the harness are excluded deliberately: they do not participate
 * in computing a ratio, so adding one changes no measurement and must not
 * invalidate every recorded number.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The harness, relative to the repository root. */
export const CONTRAST_SOURCE_DIR = "packages/ui/src/styles/contrast";

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.[cm]?tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * A short, stable hash of every file that participates in a measurement.
 *
 * Paths are included alongside contents and read in sorted order, so a rename
 * or a reordering of the directory changes the stamp and a re-read of the same
 * tree does not.
 */
export function contrastSourceStamp(repoRoot) {
  const dir = join(repoRoot, CONTRAST_SOURCE_DIR);
  const hash = createHash("sha256");
  for (const file of sourceFiles(dir)) {
    hash.update(relative(repoRoot, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
