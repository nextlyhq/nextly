#!/usr/bin/env node

/**
 * check-bundle-budgets.mjs — the R-3 gate: hold the shipped bundle to the
 * budgets the spec states (specs/admin-bundle/spec.md, R-3).
 *
 * - The shipped total — every browser-loaded chunk the package emits — stays
 *   at most 3,500 KB minified.
 * - The shell every route shares (the first screen's set) stays at most
 *   280 KB gzipped.
 * - Each built-in route's direct visit — the shell plus that route's own
 *   remainder — stays at most its pinned size plus 10%. The pins live in
 *   `route-budgets.json`, measured when they were last set; a route with no
 *   pin fails, so a new route is measured and pinned when it is added.
 *
 * A breach fails naming the measured size and the budget it exceeded.
 *
 * Usage:
 *   node scripts/check-bundle-budgets.mjs         check dist against the pins
 *   node scripts/check-bundle-budgets.mjs --pin   re-measure and rewrite the pins
 */

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

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatKB, measureBundle } from "./bundle-report.mjs";

export const BUDGETS = {
  // Spec R-3: the measured baseline at 55cbb55c7 (3,392 KB) plus headroom.
  totalMinifiedKB: 3500,
  // Spec R-3: the shared shell, measured at 259 KB gzipped on 2026-10-27.
  shellGzipKB: 280,
  // Spec R-3: each route may grow this share above its pinned size.
  routeHeadroom: 0.1,
};

const PINS_FILE = fileURLToPath(new URL("./route-budgets.json", import.meta.url));

/**
 * A route's stable name: its chunk's file name without the content hash,
 * which changes on every build. Lazily loaded pages are named after their
 * source path by the build (`page.dashboard.users.create`), so each is unique.
 */
export function routeKey(root) {
  return root.replace(/-[A-Za-z0-9_-]{8}\.mjs$/, "");
}

/** The pins as the gate reads them: each route's measured direct visit, in bytes. */
export function readPins(file = PINS_FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Pins for `report`: every route's direct visit as measured now, keyed by its
 * stable name, with the commit it was measured at.
 */
export function pinsFrom(report) {
  const routes = {};
  for (const route of [...report.routes].sort((a, b) =>
    routeKey(a.root).localeCompare(routeKey(b.root))
  )) {
    routes[routeKey(route.root)] = route.directVisit.gzippedBytes;
  }
  return { measuredAt: report.commit ?? null, date: report.date ?? null, routes };
}

/**
 * Every budget the report breaches, each naming what was measured and the
 * budget it exceeded. An empty list is a passing build.
 */
export function budgetBreaches(report, pins, budgets = BUDGETS) {
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

  const shellBytes = report.totals.firstScreen.gzippedBytes;
  if (shellBytes / 1024 > budgets.shellGzipKB) {
    breaches.push({
      kind: "shell",
      name: "the shell every route shares",
      measured: `${formatKB(shellBytes)} KB gzipped`,
      budget: `${budgets.shellGzipKB} KB gzipped`,
    });
  }

  for (const route of report.routes) {
    const key = routeKey(route.root);
    const pinned = pins.routes[key];
    const measured = `${formatKB(route.directVisit.gzippedBytes)} KB gzipped`;
    if (pinned === undefined) {
      breaches.push({
        kind: "unpinned",
        name: `direct visit to ${key}`,
        measured,
        budget: "none pinned: run check:budgets --pin and commit route-budgets.json",
      });
      continue;
    }
    const budgetBytes = pinned * (1 + budgets.routeHeadroom);
    if (route.directVisit.gzippedBytes > budgetBytes) {
      breaches.push({
        kind: "route",
        name: `direct visit to ${key}`,
        measured,
        budget: `${formatKB(budgetBytes)} KB gzipped (pinned ${formatKB(pinned)} KB plus ${budgets.routeHeadroom * 100}%)`,
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
      `${kind}: ${name} — measured ${measured}, budget ${budget}`
  );
}

async function main() {
  const report = measureBundle();

  if (process.argv.includes("--pin")) {
    writeFileSync(PINS_FILE, `${JSON.stringify(pinsFrom(report), null, 2)}\n`);
    console.log(`Pinned ${report.routes.length} routes in route-budgets.json.`);
    return;
  }

  const breaches = budgetBreaches(report, readPins());

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
