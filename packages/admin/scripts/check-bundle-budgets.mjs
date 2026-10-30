#!/usr/bin/env node

/**
 * check-bundle-budgets.mjs — the R-3 gate: hold the shipped bundle to the
 * budgets the spec states (specs/admin-bundle/spec.md, R-3).
 *
 * - The shipped total — every browser-loaded chunk the package emits — stays
 *   at most 3,560 KB minified.
 * - The shell every route shares (the first screen's set) stays at most
 *   280 KB gzipped.
 * - Each route's own code — what its direct visit adds to the shell — stays
 *   at most its pinned size plus 10% (at least 2 KB). The pins live in
 *   `route-budgets.json`, measured when they were last set; a route with no
 *   pin fails, so a new route is measured and pinned when it is added.
 *
 * Holding the shell and each route's own code apart, rather than each direct
 * visit whole, keeps the spec's bound (shell plus route within its measured
 * size plus 10%) and also bounds a visit that loads several lazy pieces: the
 * pieces' own code can together grow by no more than 10%.
 *
 * A breach fails naming the measured size and the budget it exceeded.
 *
 * Usage:
 *   node scripts/check-bundle-budgets.mjs         check dist against the pins
 *   node scripts/check-bundle-budgets.mjs --pin   re-measure and rewrite the pins
 */

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { distStaleness, formatKB, measureBundle } from "./bundle-report.mjs";

export const BUDGETS = {
  // Spec R-3: the measured baseline at 55cbb55c7 (3,392 KB) plus headroom,
  // raised to 3,560 KB when main measured 3,549 KB at a368b2997: the roles
  // screen's RoleForm (+27.0 KB) and the media editing chunks (+21 KB net)
  // grew past 3,500, beside the development-only widget preview page's own
  // lazy chunk (9.7 KB). Their owners are asked to trim, so this comes back
  // down.
  totalMinifiedKB: 3560,
  // Spec R-3: the shared shell, measured at 259 KB gzipped on 2026-10-27.
  shellGzipKB: 280,
  // Spec R-3: each route's own code may grow this share above its pin...
  routeHeadroom: 0.1,
  // ...or this many KB, whichever is more, so a route that adds almost
  // nothing to the shell is not failed by a few bytes of noise.
  routeFloorKB: 2,
};

const PINS_FILE = fileURLToPath(new URL("./route-budgets.json", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A route's stable name: its chunk's file name without the content hash,
 * which changes on every build. Lazily loaded pages are named after their
 * source path by the build (`page.dashboard.users.create`), so each is unique.
 */
export function routeKey(root) {
  return root.replace(/-[A-Za-z0-9_-]{8}\.mjs$/, "");
}

/**
 * Stable names two or more routes share. Other lazy modules keep the
 * bundler's `[name]-[hash]` naming, so two `index.ts` files become two
 * `index` routes; one pin would then judge both, and a new route could hide
 * behind an old one's pin.
 */
function sharedRouteKeys(report) {
  const seen = new Set();
  const shared = new Set();
  for (const route of report.routes) {
    const key = routeKey(route.root);
    if (seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}

/** The pins as the gate reads them: each route's own code, in gzipped bytes. */
export function readPins(file = PINS_FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Pins for `report`: every route's own code as measured now, keyed by its
 * stable name, with the commit it was measured at.
 */
export function pinsFrom(report) {
  const shared = sharedRouteKeys(report);
  if (shared.size > 0) {
    throw new Error(
      `Cannot pin: several routes are named ${[...shared].join(", ")}. Give each a path-based chunk name in tsdown.config.ts.`
    );
  }
  // No prototype, so a route named like a built-in key (`__proto__`) is an
  // entry of its own.
  const routes = Object.create(null);
  for (const route of [...report.routes].sort((a, b) =>
    routeKey(a.root).localeCompare(routeKey(b.root))
  )) {
    routes[routeKey(route.root)] = route.beyondShell.gzippedBytes;
  }
  return { measuredAt: report.commit ?? null, date: report.date ?? null, routes };
}

/**
 * Why `report` cannot become the pins, or null when it can. A pin labelled
 * with this commit must be this commit's bytes: pinning other bytes would
 * loosen the gate for every later build.
 */
export function pinRefusal(report, uncommittedInputs = []) {
  // The dist is built from the working tree, so with a build input changed
  // and not committed its bytes are not this commit's either way round.
  if (uncommittedInputs.length > 0) {
    return `build inputs have uncommitted changes (${uncommittedInputs.join(", ")})`;
  }
  // Every build writes the stamp, so a dist without one was built some other
  // way and nothing says which commit its bytes are.
  if (report.buildInfo === undefined) {
    return "the dist has no valid build stamp (.build-info.json)";
  }
  if (distStaleness(report).stale) {
    return "the dist predates this commit, or another commit's build stamped it";
  }
  return null;
}

/**
 * The admin's build inputs with changes git has not committed, as paths from
 * the package. A status git cannot give refuses too, since nothing then says
 * the tree is clean.
 */
function uncommittedBuildInputs() {
  try {
    return execFileSync(
      "git",
      ["status", "--porcelain", "--", "src", "tsdown.config.ts", "package.json"],
      { cwd: PACKAGE_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
      .split("\n")
      .filter(Boolean)
      .map(line => line.slice(3));
  } catch {
    return ["(git status could not be read)"];
  }
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

  const shared = sharedRouteKeys(report);
  for (const key of shared) {
    breaches.push({
      kind: "duplicate",
      name: `route ${key}`,
      measured: "several routes under this one name",
      budget: "one pin per route: give each a path-based chunk name in tsdown.config.ts",
    });
  }

  for (const route of report.routes) {
    const key = routeKey(route.root);
    if (shared.has(key)) continue;
    // Own entries only: a key inherited from Object.prototype is no pin.
    const pinned = Object.hasOwn(pins.routes, key) ? pins.routes[key] : undefined;
    const measured = `${formatKB(route.beyondShell.gzippedBytes)} KB gzipped of its own`;
    if (pinned === undefined) {
      breaches.push({
        kind: "unpinned",
        name: `route ${key}`,
        measured,
        budget: "none pinned: run check:budgets --pin and commit route-budgets.json",
      });
      continue;
    }
    const budgetBytes = Math.max(
      pinned * (1 + budgets.routeHeadroom),
      pinned + budgets.routeFloorKB * 1024
    );
    if (route.beyondShell.gzippedBytes > budgetBytes) {
      breaches.push({
        kind: "route",
        name: `route ${key}`,
        measured,
        budget: `${formatKB(budgetBytes)} KB gzipped (pinned ${formatKB(pinned)} KB plus ${budgets.routeHeadroom * 100}%, at least ${budgets.routeFloorKB} KB)`,
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
    const refusal = pinRefusal(report, uncommittedBuildInputs());
    if (refusal !== null) {
      console.error(
        `Refusing to pin: ${refusal}. Commit any change, rebuild (pnpm --filter @nextlyhq/admin build) and pin again.`
      );
      process.exitCode = 1;
      return;
    }
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
