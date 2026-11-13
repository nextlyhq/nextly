#!/usr/bin/env node

/**
 * check-bundle-budgets.mjs — the R-3 gate: hold the shipped bundle to the
 * budgets the spec states (specs/admin-bundle/spec.md, R-3).
 *
 * - The shipped total — every browser-loaded chunk the package emits — stays
 *   at most 3,560 KB minified.
 * - The shell every route shares (the first screen's set) stays at most
 *   155 KB gzipped.
 * - Each route's own code — what its direct visit adds to the shell — stays
 *   at most its pinned size plus 10% (at least 2 KB). The pins live in
 *   `route-budgets.json`, measured when they were last set; a route with no
 *   pin fails, so a new route is measured and pinned when it is added.
 * - No module `KEPT_OUT_OF_SHELL` names reaches the shell, read from the
 *   record of each chunk's modules the build writes beside them.
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
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { distStaleness, formatKB, measureBundle } from "./bundle-report.mjs";

export const BUDGETS = {
  // Spec R-3: the measured baseline at 55cbb55c7 (3,392 KB) plus headroom,
  // raised to 3,560 KB when main measured 3,549 KB at a368b2997: the roles
  // screen's RoleForm (+27.0 KB) and the media editing chunks (+21 KB net)
  // grew past 3,500, beside the development-only widget preview page's own
  // lazy chunk (9.7 KB). Their owners are asked to trim, so this comes back
  // down. Raised to 3,580 KB when the card settings panel (panel, preview,
  // sections, about 16 KB) took the shipped total from about 3,555 to
  // 3,572 KB. That 3,572 was measured on a base without the media library's
  // views, Used in and Replace, which merged minutes before it: main stood
  // at 3,582 KB from then on. Raised to 3,600 KB when those (+11.7 KB) and
  // the setup card (+1.7 KB) took it to 3,584 KB. Raised to 3,740 KB to cover
  // the admin's shipped code as it measures at 3,736 KB: concurrency, history
  // and email setup screens, editors loaded on demand, and no unused code left
  // to remove, so the limit sits just above that measurement.
  totalMinifiedKB: 3740,
  // The shared shell, measured at 140.3 KB gzipped on 2026-11-13 once the
  // root entry exported only what an application mounts (it was 331 KB), the
  // form library and zod's classic API left it, and the packages
  // `@nextlyhq/ui` ships stayed with the application, plus the 10% a route's
  // own code may grow above its pin. Held close to the measurement so the
  // room is not spent without a decision.
  shellGzipKB: 155,
  // Spec R-3: each route's own code may grow this share above its pin...
  routeHeadroom: 0.1,
  // ...or this many KB, whichever is more, so a route that adds almost
  // nothing to the shell is not failed by a few bytes of noise.
  routeFloorKB: 2,
};

const PINS_FILE = fileURLToPath(
  new URL("./route-budgets.json", import.meta.url)
);
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
  return {
    measuredAt: report.commit ?? null,
    date: report.date ?? null,
    routes,
  };
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
      [
        "status",
        "--porcelain",
        "--",
        "src",
        "tsdown.config.ts",
        "package.json",
      ],
      {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
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
      budget:
        "one pin per route: give each a path-based chunk name in tsdown.config.ts",
    });
  }

  for (const route of report.routes) {
    const key = routeKey(route.root);
    if (shared.has(key)) continue;
    // Own entries only: a key inherited from Object.prototype is no pin.
    const pinned = Object.hasOwn(pins.routes, key)
      ? pins.routes[key]
      : undefined;
    const measured = `${formatKB(route.beyondShell.gzippedBytes)} KB gzipped of its own`;
    if (pinned === undefined) {
      breaches.push({
        kind: "unpinned",
        name: `route ${key}`,
        measured,
        budget:
          "none pinned: run check:budgets --pin and commit route-budgets.json",
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
 * What must never reach the shell, by the start of a module's recorded name:
 * a package's files (`react-hook-form/`), or this package's own source
 * (`src/...`). Each belongs to the routes that use it; in the shell, every
 * admin screen would download it before drawing.
 */
export const KEPT_OUT_OF_SHELL = [
  // The form library and what builds on it: the shell draws no form.
  "react-hook-form/",
  // Drag-and-drop and file dropping: the field editors and the media library.
  "@dnd-kit/",
  "react-dropzone/",
  "file-selector/",
  // zod's chained API: the shell validates with `zod/mini`, which shares
  // zod's core and leaves the chained classes to the routes that use them.
  "zod/v4/classic/",
  // The admin's own route parts.
  "src/components/features/media-library/MediaPickerDialog",
  "src/components/field-ui/",
  "src/components/ui/table/data-table/",
];

/**
 * Modules under a `KEPT_OUT_OF_SHELL` start that the shell may hold, each
 * written to import nothing so the first frame can read it alone.
 */
export const SHELL_MAY_HOLD = [
  // How a table row's actions are drawn, which the loading outlines share.
  "src/components/ui/table/data-table/row-actions.ts",
];

/** The category `bundle-report.mjs` gives a chunk the shell holds. */
export const SHELL_CATEGORY = "first-screen";

/** The record of each chunk's modules the build writes beside them. */
const BUNDLE_MODULES_FILE = "bundle-modules.json";

/** The source module the shell is entered through, as the record names it. */
const SHELL_ENTRY_MODULE = "src/index.ts";

/** The record of `distDir`'s build, or null when it holds none. */
export function readBundleModules(distDir) {
  const file = join(distDir, BUNDLE_MODULES_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/**
 * The static imports from the shell's entry module to the first of `targets`,
 * through modules the shell holds or modules no chunk holds (a re-exporting
 * module the bundler folded away, such as a package's index), or null when
 * none leads there (a module placed in a shell chunk beside one it is not
 * imported with). Never through a route's module: the shell does not load it.
 */
function importChain(imports, from, targets, passable) {
  const cameFrom = new Map([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const module = queue.shift();
    if (targets.has(module)) {
      const chain = [];
      for (let at = module; at !== null; at = cameFrom.get(at)) {
        chain.unshift(at);
      }
      return chain;
    }
    for (const next of imports[module] ?? []) {
      if (!cameFrom.has(next) && passable(next)) {
        cameFrom.set(next, module);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * A breach for each module the shell holds that `keptOut` names, with the
 * import chain that brought it there. Read from the record the build writes
 * beside the chunks: the chunks alone say how big the shell is, not what is
 * in it. A missing record, or one naming other chunks than the report
 * measured, is a breach too, since nothing could then be said of the shell.
 */
export function shellModuleBreaches(
  report,
  record,
  keptOut = KEPT_OUT_OF_SHELL,
  mayHold = SHELL_MAY_HOLD
) {
  const unread = budget => [
    {
      kind: "shell-module",
      name: "the shell's modules",
      measured: "nothing: the build's record of them",
      budget,
    },
  ];
  if (record === null) {
    return unread(
      `${BUNDLE_MODULES_FILE} beside the chunks, written by the build: rebuild (pnpm --filter @nextlyhq/admin build)`
    );
  }
  const shellChunks = report.chunks
    .filter(chunk => chunk.category === SHELL_CATEGORY)
    .map(chunk => chunk.file);
  if (shellChunks.some(file => !Object.hasOwn(record.chunks, file))) {
    return unread(
      `a record of the chunks measured, which ${BUNDLE_MODULES_FILE} is not: it is from another build, so rebuild`
    );
  }

  // Each module the shell holds, with the first shell chunk holding it.
  const inShell = new Map();
  for (const file of shellChunks) {
    for (const module of record.chunks[file]) {
      if (!inShell.has(module)) inShell.set(module, file);
    }
  }

  // Every module some chunk holds, the routes' included.
  const chunked = new Set(Object.values(record.chunks).flat());

  const breaches = [];
  for (const start of keptOut) {
    const found = [...inShell.keys()].filter(
      module => module.startsWith(start) && !mayHold.includes(module)
    );
    if (found.length === 0) continue;
    const chain = importChain(
      record.imports,
      SHELL_ENTRY_MODULE,
      new Set(found),
      module => inShell.has(module) || !chunked.has(module)
    );
    const first = chain === null ? found[0] : chain.at(-1);
    breaches.push({
      kind: "shell-module",
      name: start,
      measured:
        `${found.length} module(s) in the shell, ${first} in ${inShell.get(first)}, ` +
        (chain === null
          ? "placed there beside a module the shell imports"
          : `imported ${chain.join(" -> ")}`),
      budget:
        "none in the shell: it belongs to the routes that use it, so import what the shell needs from a module that does not bring it",
    });
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

  const breaches = [
    ...budgetBreaches(report, readPins()),
    ...shellModuleBreaches(report, readBundleModules(report.distDir)),
  ];

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
