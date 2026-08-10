/**
 * The committed audit evidence must agree with the live contrast report.
 *
 * Both are generated from the same themes by different scripts, and both are
 * checked in. That makes them a pair that can silently diverge: the evidence
 * was generated before the presets gained their accessibility corrections, so
 * it recorded 14 failures for a theme the report called clean. Nothing was
 * wrong with either file on its own -- each was right about the tree it was
 * generated from -- and anyone reading the evidence drew conclusions from
 * numbers the product had stopped producing.
 *
 * Comparing the two costs nothing and is exactly the disagreement that
 * happened. Regenerating the evidence is `node scripts/audit-themes.mjs` from
 * `apps/playground`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTRAST_REPORT } from "../contrast-report.generated";

const here = dirname(fileURLToPath(import.meta.url));

interface Evidence {
  generatedBy: string;
  contrastSourceRev: string;
  wcagFailures: Record<string, unknown[]>;
}

const evidence = JSON.parse(
  readFileSync(resolve(here, "../audit-evidence/tokens.json"), "utf8")
) as Evidence;

describe("the audit evidence matches the contrast report", () => {
  it("reads both artifacts", () => {
    // Comparing two empty sets passes without checking anything.
    expect(Object.keys(evidence.wcagFailures).length).toBeGreaterThan(0);
    expect(Object.keys(CONTRAST_REPORT).length).toBeGreaterThan(0);
    expect(evidence.contrastSourceRev).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("covers the same themes on both sides", () => {
    // A theme present in one and absent from the other is drift that a
    // per-theme count comparison would step over.
    expect([...Object.keys(evidence.wcagFailures)].sort()).toEqual(
      [...Object.keys(CONTRAST_REPORT)].sort()
    );
  });

  it("records the same failure count for every theme", () => {
    const disagreements = Object.entries(evidence.wcagFailures)
      .map(([theme, failures]) => ({
        theme,
        evidence: failures.length,
        report: CONTRAST_REPORT[theme],
      }))
      .filter(row => row.evidence !== row.report);

    expect(
      disagreements.map(
        row =>
          `${row.theme}: evidence says ${row.evidence}, report says ${row.report}`
      ),
      `The committed audit evidence and the contrast report disagree, so one ` +
        `of them describes a tree that no longer exists. Regenerate the ` +
        `evidence with \`node scripts/audit-themes.mjs\` from apps/playground.`
    ).toEqual([]);
  });
});
