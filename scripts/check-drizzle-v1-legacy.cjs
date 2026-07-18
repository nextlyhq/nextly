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
    lineTest = null,
  } = opts;
  const args = [
    "-rEn",
    pattern,
    ...paths,
    ...include.map(i => `--include=${i}`),
    // Exclude at the grep level: scanning node_modules/.next can overflow
    // execFileSync's buffer and crash the gate with ENOBUFS instead of a
    // verdict (the JS-side filters below stay as a second line of defense).
    "--exclude-dir=node_modules",
    "--exclude-dir=dist",
    "--exclude-dir=.next",
    "--exclude-dir=.turbo",
    "--exclude-dir=build",
  ];
  let out = "";
  try {
    out = execFileSync("grep", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
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
    .filter(l => !allowMatches.some(a => a.test(l)))
    .filter(l => (lineTest ? lineTest(l) : true));
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
// A same-line `import { relations, defineRelations }` must still be caught,
// so parse the import clause instead of allowlisting whole lines.
grep(
  "no relations() imports from drizzle-orm",
  "import [^;]*\\{[^}]*relations[^}]*\\} from \"drizzle-orm\"",
  {
    lineTest: l => {
      const m = l.match(/import[^;]*\{([^}]*)\}/);
      if (!m) return true;
      return m[1]
        .split(",")
        .map(n => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
        .includes("relations");
    },
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
// v1 removed BOTH positional client forms; only `drizzle({ ... })` (or the
// documented connection-string form) is legal. Grep broadly, then JS-filter:
// flag identifier arguments (a client variable) while allowing object form,
// string literals, and url/connection-string variable names. Pure comment
// lines are skipped by content, never by "contains //" (which used to hide
// real hits carrying trailing comments or :// inside strings).
grep("no positional drizzle() constructors", "\\bdrizzle(Pg|Mysql|Sqlite)?\\s*\\(", {
  lineTest: l => {
    const code = l.replace(/^[^:]+:\d+:/, "");
    if (/^\s*(\/\/|\*|\/\*)/.test(code)) return false; // comment line
    const call = code.match(/\bdrizzle(?:Pg|Mysql|Sqlite)?\s*\(\s*([A-Za-z_$][\w$]*|[{"'`)])/);
    if (!call) return false;
    const arg = call[1];
    if (arg === "{" || arg === '"' || arg === "'" || arg === "`" || arg === ")")
      return false; // object form / string literal / no-arg
    if (/url|connectionstring|dsn/i.test(arg)) return false; // string config var
    return true; // positional client variable
  },
});

// 10b. The same ban, but for MULTILINE constructor calls. Check #10 is
// line-based (grep -n), so `drizzle(\n  client,\n)` — the argument on a later
// line — slips past its same-line regex. Re-scan each candidate file's FULL
// text: in JS `\s` spans newlines, so one regex catches both single- and
// multi-line forms. Same allow-list as #10 (object form, string literal,
// url/dsn variable). Comments are stripped first so a commented example
// doesn't trip the gate.
{
  let fileList = "";
  try {
    fileList = execFileSync(
      "grep",
      [
        "-rlE",
        "\\bdrizzle(Pg|Mysql|Sqlite)?\\s*\\(",
        ...SRC_GLOBS,
        "--include=*.ts",
        "--include=*.tsx",
        "--include=*.js",
        "--include=*.cjs",
        "--include=*.mjs",
        "--exclude-dir=node_modules",
        "--exclude-dir=dist",
        "--exclude-dir=.next",
        "--exclude-dir=.turbo",
        "--exclude-dir=build",
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (e) {
    // grep exits 1 when no file matches — the pass case.
    if (e.status !== 1) throw e;
  }
  const files = fileList.split("\n").filter(Boolean);
  const hits = [];
  for (const rel of files) {
    const code = readFileSync(path.join(ROOT, rel), "utf8")
      // Strip block then line comments so `// drizzle(client)` examples and
      // JSDoc snippets are ignored. Over-stripping only risks a false
      // NEGATIVE (a missed hit), never a false failure.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/([^:])\/\/[^\n]*/g, "$1");
    const callRe =
      /\bdrizzle(?:Pg|Mysql|Sqlite)?\s*\(\s*([A-Za-z_$][\w$]*|[{"'`)])/g;
    let m;
    while ((m = callRe.exec(code)) !== null) {
      const arg = m[1];
      if (arg === "{" || arg === '"' || arg === "'" || arg === "`" || arg === ")")
        continue; // object form / string literal / no-arg
      if (/url|connectionstring|dsn/i.test(arg)) continue; // string config var
      hits.push(`${rel}: drizzle(${arg} …)`);
    }
  }
  if (hits.length > 0) {
    failures++;
    console.error(
      `✗ no positional drizzle() constructors — multiline (${hits.length} hit(s)):`
    );
    for (const h of hits.slice(0, 12)) console.error(`    ${h}`);
  } else {
    console.log("✓ no positional drizzle() constructors (multiline scan)");
  }
}

// 11. No literal-Date DDL defaults — `.default(new Date())` bakes a
// boot-time timestamp into the schema, and v1's working differ then emits
// default-drift MODIFYs on every boot (the exact bug normalized to
// CURRENT_TIMESTAMP in this migration).
grep("no .default(new Date()) DDL defaults", "\\.default\\(new Date\\(\\)\\)", {
  paths: ["packages"],
});


// 12. The removed RQB callback filter form. v1 silently IGNORES a function
// passed as `where:` (no enumerable keys → no filter), so `findMany` returns
// every row and assertions pass by luck. Banned in src AND tests.
grep("no RQB callback where-filters", "where:\\s*\\(", {
  lineTest: l => {
    const code = l.replace(/^[^:]+:\d+:/, "");
    if (/^\s*(\/\/|\*|\/\*)/.test(code)) return false;
    // Flag the RQB filter SIGNATURE `where: (table, { operators }) =>` —
    // two parameters, the second being the operator bag. Zero-param
    // `where: () => chain` is a select-builder method stub on a mock, and
    // single-param `where: (cond: unknown) => {...}` is a TYPE declaration
    // of the builder's where method — both fine.
    return /where:\s*(?:async\s*)?\(\s*[A-Za-z_$][\w$]*\s*,\s*[{A-Za-z_$]/.test(
      code
    );
  },
});

// 13. The runtime version constant must equal the scripts-side source of
// truth — two constants that can drift are worse than one.
{
  const { REQUIRED_DRIZZLE_VERSION } = require("./drizzle-version.cjs");
  const ts = readFileSync(
    path.join(ROOT, "packages/nextly/src/database/drizzle-version.ts"),
    "utf8"
  );
  const m = ts.match(/REQUIRED_DRIZZLE_VERSION = "([^"]+)"/);
  if (!m || m[1] !== REQUIRED_DRIZZLE_VERSION) {
    failures++;
    console.error(
      `✗ drizzle-version constants out of sync: scripts=` +
        `${REQUIRED_DRIZZLE_VERSION} ts=${m ? m[1] : "<missing>"}`
    );
  } else {
    console.log("✓ drizzle version constants in sync (scripts ⇄ runtime)");
  }
}

if (failures > 0) {
  console.error(`\ndrizzle v1 legacy gate: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\ndrizzle v1 legacy gate: all checks passed");
