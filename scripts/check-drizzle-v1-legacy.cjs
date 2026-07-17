#!/usr/bin/env node
/**
 * Drizzle V1 zero-legacy exit gate (Phase 9 of the drizzle-v1 migration).
 *
 * Fails (exit 1) if any pre-v1 Drizzle API, removed kit symbol, or forbidden
 * escape hatch survives in source. Runs next to check-drizzle-kit-pin.cjs in
 * CI and on every future Drizzle pin bump.
 *
 * Scoping is deliberate: `hasDataLoss` / `.warnings` are common identifiers
 * elsewhere in the codebase, so those checks are narrowed to the kit wrapper
 * rather than blanket-banned.
 */

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC_GLOBS = ["packages", "apps", "templates"];

let failures = 0;

function grep(label, pattern, opts = {}) {
  const {
    include = ["*.ts", "*.tsx", "*.js", "*.cjs", "*.mjs"],
    paths = SRC_GLOBS,
    extraFilters = [],
    allowMatches = [],
  } = opts;
  const args = [
    "-rEn",
    pattern,
    ...paths,
    ...include.map(i => `--include=${i}`),
  ];
  let out = "";
  try {
    out = execFileSync("grep", args, { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    // grep exits 1 on "no matches" — that's the pass case.
    if (e.status !== 1) throw e;
  }
  const lines = out
    .split("\n")
    .filter(Boolean)
    .filter(l => !l.includes("node_modules"))
    .filter(l => !/\/(dist|\.next|\.turbo)\//.test(l))
    .filter(l => extraFilters.every(f => !f.test(l)))
    .filter(l => !allowMatches.some(a => a.test(l)));
  if (lines.length > 0) {
    failures++;
    console.error(`✗ ${label} (${lines.length} hit(s)):`);
    for (const l of lines.slice(0, 12)) console.error(`    ${l}`);
    if (lines.length > 12) console.error(`    … ${lines.length - 12} more`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// 1. The removed single-module kit entrypoint — comments included, raw zero.
grep("no drizzle-kit/api mentions", "drizzle-kit/api\\b", {
  include: ["*.ts", "*.tsx", "*.js", "*.cjs", "*.mjs", "*.json"],
});

// 2. Renamed/removed kit symbols.
grep(
  "no renamed kit symbols",
  "pushMySQLSchema|pushSQLiteSchema|upPgSnapshot|generateMySQLDrizzleJson|generateSQLiteDrizzleJson"
);

// 3. getTableColumns is deprecated-but-compiles on v1 — the compiler will
// not catch it, so the gate must.
grep("no getTableColumns", "\\bgetTableColumns\\b");

// 4. The v1-removed relations() API. defineRelations is the v1 surface;
// type-only helpers (AnyRelations, RelationsBuilder, ExtractTablesFromSchema)
// are fine.
grep(
  "no relations() imports from drizzle-orm",
  "import \\{[^}]*\\brelations\\b[^}]*\\} from \"drizzle-orm\"",
  {
    allowMatches: [/defineRelations|AnyRelations|RelationsBuilder/],
  }
);

// 5. The pre-v1 kit result field, kit-only name — nextly source only.
grep("no statementsToExecute in nextly src", "statementsToExecute", {
  paths: ["packages/nextly/src"],
  // The contract test ASSERTS the field's absence — that is the tripwire
  // working, not a legacy usage.
  allowMatches: [/not\.toHaveProperty\("statementsToExecute"\)/],
});

// 6. The wrapper must not re-expose the removed hasDataLoss field.
{
  const wrapper = readFileSync(
    path.join(ROOT, "packages/nextly/src/database/drizzle-kit-lazy.ts"),
    "utf8"
  );
  const hits = wrapper
    .split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /hasDataLoss/.test(l) && !l.trim().startsWith("//"));
  if (hits.length > 0) {
    failures++;
    console.error("✗ drizzle-kit-lazy re-exposes hasDataLoss:");
    for (const { l, n } of hits) console.error(`    ${n}: ${l.trim()}`);
  } else {
    console.log("✓ wrapper does not re-expose hasDataLoss");
  }
}

// 7. Forbidden escape hatches. `drizzle-orm/_relations` still RESOLVES in
// rc.4 — this is a policy grep, not a compile error.
grep("no _relations/_query escape hatches", "drizzle-orm/_relations|\\b_query\\b", {
  extraFilters: [/\.test\.tsx?:/],
});

// 8. Exact drizzle pins. `keywords` arrays legitimately contain "drizzle".
{
  const pinScript = path.join(ROOT, "scripts/check-drizzle-kit-pin.cjs");
  try {
    execFileSync("node", [pinScript], { cwd: ROOT, stdio: "pipe" });
    console.log("✓ drizzle pins exact (via check-drizzle-kit-pin.cjs)");
  } catch (e) {
    failures++;
    console.error("✗ check-drizzle-kit-pin.cjs failed:");
    console.error(String(e.stdout || e.message).slice(0, 500));
  }
}

// 9. No codegen relations emission under src/domains.
grep(
  "no relations() codegen in domains",
  "import \\{ relations \\}|Relations = relations\\(",
  { paths: ["packages/nextly/src/domains"] }
);

// 10. No positional drizzle() constructors — v1 removed BOTH positional
// forms; the single-arg form silently connects to the WRONG database.
grep(
  "no positional drizzle() constructors",
  "drizzle(Pg|Mysql|Sqlite)?\\((pool|sqlite|client|connection|db)[,)]",
  {
    extraFilters: [/\/\//],
  }
);

if (failures > 0) {
  console.error(`\ndrizzle v1 legacy gate: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\ndrizzle v1 legacy gate: all checks passed");
