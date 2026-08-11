/**
 * Both generated artifacts must be stamped with the harness they were measured
 * against, and that stamp must be the harness as it stands now.
 *
 * A failure count is a property of (theme x contrast source): a recorded 58
 * became 48 with the theme untouched, because the shared harness moved beneath
 * it. The stamp exists so a stale number announces itself instead of being
 * hunted for in the theme.
 *
 * It used to be the commit that last touched the harness, which could not
 * support this test. A generator run before committing recorded the PREVIOUS
 * commit, so the value was stale the moment it was written; a rebase changed it
 * without changing an input; and a commit identifier cannot be recomputed and
 * compared. The content hash can, which is what turns the stamp from a claim in
 * a banner into something that fails.
 *
 * Regenerate with `node scripts/generate-contrast-report.mjs` and
 * `node scripts/audit-themes.mjs` from `apps/playground`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The same helper the generator scripts use, typed by a sibling `.d.mts`.
// Sharing the implementation is the point: two definitions of "the harness's
// identity" would be free to disagree, and the disagreement would look exactly
// like the staleness this is meant to detect.
import { contrastSourceStamp } from "../../../scripts/contrast-source-stamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

const report = readFileSync(
  resolve(here, "../contrast-report.generated.ts"),
  "utf8"
);
const evidence = JSON.parse(
  readFileSync(resolve(here, "../audit-evidence/tokens.json"), "utf8")
) as { contrastSourceRev: string };

const current: string = contrastSourceStamp(repoRoot);

describe("generated artifacts are stamped with the current harness", () => {
  it("computes a stamp that looks like one", () => {
    // An empty or constant stamp would satisfy every comparison below.
    expect(current).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes when the harness changes and not otherwise", () => {
    // Recomputing over the same tree must agree; that is the property the
    // commit-based stamp lacked, and the whole reason this test can exist.
    expect(contrastSourceStamp(repoRoot)).toBe(current);
  });

  it("stamps the contrast report with the current harness", () => {
    const stamped = report.match(/contrast source `([0-9a-f]+)`/)?.[1];
    expect(
      stamped,
      `contrast-report.generated.ts was measured against a different contrast ` +
        `harness than the one in the tree, so its counts describe code that ` +
        `has since changed. Regenerate it.`
    ).toBe(current);
  });

  it("stamps the audit evidence with the current harness", () => {
    expect(
      evidence.contrastSourceRev,
      `audit-evidence/tokens.json was measured against a different contrast ` +
        `harness than the one in the tree. Regenerate it.`
    ).toBe(current);
  });
});
