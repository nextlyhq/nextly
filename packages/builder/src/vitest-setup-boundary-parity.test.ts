/**
 * The two boundary suites say the same thing.
 *
 * Each package needs its OWN suite: what it proves is that this package's
 * config resolves the shared setup, which a suite living anywhere else cannot
 * establish. The assertions inside them are therefore duplicated, and that is a
 * real risk — a later correction applied to one and not the other leaves one
 * package quietly holding weaker coverage, which is the drift the shared setup
 * was written to prevent.
 *
 * They cannot be shared. Measured, both ways round:
 *
 * - A module outside every package resolves its imports from the repository
 *   root, where `react` is not a dependency. Adding it there would be worse
 *   than the duplication: the packages would load their own copy and the shared
 *   module another, and two React copies in one renderer means hooks called
 *   against the wrong dispatcher.
 * - Importing such a module from a package's `src` fails `rootDir` — TS6059,
 *   "is not under rootDir" — and widening `rootDir` changes what the published
 *   build emits.
 *
 * So the duplication stays and divergence is made LOUD instead, which is the
 * same move the suites themselves make: the failure was silent, so it was given
 * something that fails.
 *
 * @module vitest-setup-boundary-parity.test
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The repository root, from this package's own directory. */
const REPO = join(import.meta.dirname, "..", "..", "..");

const SUITES = [
  "packages/builder/src/vitest-setup-boundary.test.tsx",
  "packages/plugin-page-builder/src/vitest-setup-boundary.test.tsx",
];

/**
 * A suite's content without the one line that legitimately differs.
 *
 * The `@module` tag names the file's own path, so it cannot match across two
 * packages and is not something a reader could keep in step anyway.
 */
function comparable(path: string): string {
  return readFileSync(join(REPO, path), "utf8")
    .split("\n")
    .filter(line => !line.includes("@module"))
    .join("\n");
}

describe("the per-package boundary suites", () => {
  it("are the same suite, so neither can quietly weaken", () => {
    const [first, second] = SUITES.map(comparable);

    expect(second).toBe(first);
  });

  it("are actually there to be compared", () => {
    // The control: two unreadable paths would make the case above compare
    // nothing against nothing and pass.
    for (const path of SUITES) {
      expect(comparable(path)).toContain("not configured to support act");
    }
  });
});
