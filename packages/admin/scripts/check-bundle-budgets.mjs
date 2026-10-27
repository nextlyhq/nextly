#!/usr/bin/env node

/**
 * check-bundle-budgets.mjs — the R-3 gate: hold the shipped bundle to the
 * two budgets the spec states.
 *
 * - The shipped total — every browser-loaded chunk the package emits — stays
 *   at most 3,500 KB minified.
 * - Every built-in route's direct visit — the shell plus that route's own
 *   remainder, what a cold URL for the route downloads before it renders —
 *   stays at most 200 KB gzipped.
 *
 * A breach fails naming the measured size and the budget it exceeded; a run
 * within all budgets passes whatever the previous build measured. The
 * numbers come from the merged spec (specs/admin-bundle/spec.md, R-3); the
 * founder amends them there at review, and this file follows the spec.
 *
 * Usage: node scripts/check-bundle-budgets.mjs
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatKB, measureBundle } from "./bundle-report.mjs";

export const BUDGETS = {
  // Spec R-3: the measured baseline at 55cbb55c7 (3,392 KB) plus headroom.
  totalMinifiedKB: 3500,
  // Spec R-3: a proposal against the pre-lazy-load 247 KB gzipped entry.
  routeDirectVisitGzipKB: 200,
};

/**
 * Every budget the report breaches, each naming what was measured and the
 * budget it exceeded. An empty list is a passing build.
 */
export function budgetBreaches(report, budgets = BUDGETS) {
  const breaches = [];

  const totalMinKB = report.totals.browser.minifiedBytes / 1024;
  if (totalMinKB > budgets.totalMinifiedKB) {
    breaches.push({
      kind: "total",
      name: "shipped total (all browser-loaded chunks)",
      measured: `${formatKB(report.totals.browser.minifiedBytes)} KB minified`,
      budget: `${budgets.totalMinifiedKB} KB minified`,
    });
  }

  for (const route of report.routes) {
    const directVisitKB = route.directVisit.gzippedBytes / 1024;
    if (directVisitKB > budgets.routeDirectVisitGzipKB) {
      breaches.push({
        kind: "route",
        name: `direct visit to ${route.root}`,
        measured: `${formatKB(route.directVisit.gzippedBytes)} KB gzipped`,
        budget: `${budgets.routeDirectVisitGzipKB} KB gzipped`,
      });
    }
  }

  return breaches;
}

/**
 * Render the breaches the way the gate prints them: one line per breach,
 * measured size and budget together.
 */
export function describeBreaches(breaches) {
  return breaches.map(
    ({ kind, name, measured, budget }) =>
      `${kind === "total" ? "total" : "route"}: ${name} — measured ${measured}, budget ${budget}`
  );
}

async function main() {
  const report = measureBundle();
  const breaches = budgetBreaches(report);

  console.log(
    `Shipped total: ${formatKB(report.totals.browser.minifiedBytes)} KB minified ` +
      `(${report.totals.browser.count} chunks); ` +
      `${report.routes.length} built-in routes measured.`
  );

  if (breaches.length === 0) {
    console.log("Bundle budgets: every measured set is within its budget.");
    return;
  }

  console.error(`Bundle budgets exceeded (${breaches.length}):`);
  for (const line of describeBreaches(breaches)) {
    console.error(`  - ${line}`);
  }
  process.exitCode = 1;
}

// Whether this module is the entry the command named. Compared on real
// paths too: Node canonicalizes `import.meta.url` through a symlink while
// `process.argv[1]` stays lexical, and a lexical-only compare would let the
// command exit silently, having produced no verdict at all.
function invokedAsScript() {
  if (!process.argv[1]) return false;
  const named = resolve(process.argv[1]);
  const self = resolve(fileURLToPath(import.meta.url));
  if (named === self) return true;
  try {
    return realpathSync(named) === realpathSync(self);
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  await main();
}
