#!/usr/bin/env node
/**
 * Storage-spelling gate: the field-group storage format is named in ONE place.
 *
 * `schemas/storage-format.ts` exists so that renaming the stored spelling is a change to a
 * catalog rather than a search across the codebase. That only holds while everything asks the
 * catalog, and nothing enforced it — 43 mentions of the raw spellings had accumulated in product
 * code by the time this gate was written.
 *
 * ## Why this is a gate and not a convention
 *
 * The storage migration renames tables, columns and a JSON key on a live database. Table and
 * column names survive a literal, badly but visibly, because `storage/resolve-storage-names.ts`
 * reads the CATALOG and addresses whichever name is really there.
 *
 * 🔴 **A JSON key inside a row has no catalog.** Nothing can observe it, so nothing can resolve
 * it, so a literal is the whole exposure: after the flip a hardcoded reader looks for a key the
 * migrated document no longer has and finds nothing. The instance is intact and untyped — which
 * the editor cannot render and a diff cannot tag. The write side is worse: a literal in a SAVE
 * path keeps stamping the legacy spelling onto new documents behind a completed migration, so the
 * divergence grows for as long as the app runs.
 *
 * ## Why a source scan, given a scan is the weaker kind of control
 *
 * A boundary the system cannot cross would be better, and there isn't one available: the key is a
 * property name on an author's own JSON, so no type, module graph or manifest can prevent an
 * access. Between an unenforced convention and a scan, the scan is what exists — and it is the
 * same shape as `check-drizzle-v1-legacy.cjs`, which guards a comparable "compiles fine, wrong at
 * runtime" class.
 *
 * Its limit is worth stating rather than discovering: a spelling assembled at runtime
 * (`"_component" + "Type"`) passes. That is not the failure mode this exists for — the 43 sites it
 * was written against are all plain literals — but it is why the catalog remains the rule and this
 * is only what makes the rule hold.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

let failures = 0;

/**
 * Paths that legitimately name both spellings.
 *
 * - the catalog itself, which is where the strings are DEFINED;
 * - the migration engine, whose entire job is to rename one to the other, so it must name both;
 * - the storage-name resolver, which decides from the catalog which of the two a database uses;
 * - tests, which assert concrete stored bytes and would otherwise have to describe them
 *   indirectly — a test that cannot say `_componentType` cannot pin the storage format.
 */
const ALLOWED = [
  /packages\/nextly\/src\/schemas\/storage-format\.ts:/,
  /packages\/nextly\/src\/domains\/field-groups\/migration\//,
  /packages\/nextly\/src\/domains\/field-groups\/storage\//,
  /__tests__\//,
  /\.test\.tsx?:/,
  /\.test-d\.ts:/,
];

/**
 * Known-outstanding sites: reported every run, but not yet failing.
 *
 * `packages/admin` cannot reach the catalog — `STORAGE_FORMAT` is not exported from any surface
 * admin imports — so fixing these needs a public accessor export, which is an API decision rather
 * than a mechanical edit. They are listed here instead of allowlisted so every run states that
 * they exist and how many remain: an allowlist would make them disappear, and a gate whose output
 * shrinks silently is how the original 43 accumulated.
 *
 * This list must reach empty. It is not a place to move an inconvenient hit to.
 */
const PENDING = [/^packages\/admin\//];
const PENDING_TRACKED_IN =
  "tasks/left-tasks/2026-08-12-0800-storage-key-read-by-literal-blocks-b2.md";

function grep(label, pattern, opts = {}) {
  const {
    include = ["*.ts", "*.tsx"],
    paths = ["packages", "apps", "templates"],
    allowMatches = [],
  } = opts;
  const args = [
    "-rEn",
    pattern,
    ...paths,
    ...include.map(i => `--include=${i}`),
    // Excluded at the grep level rather than filtered afterwards: scanning node_modules can
    // overflow execFileSync's buffer and crash the gate with ENOBUFS, which is not a verdict.
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
    // grep exits 1 for "no matches", which is the pass case.
    if (e.status !== 1) throw e;
  }
  const lines = out
    .split("\n")
    .filter(Boolean)
    .filter(l => !l.includes("node_modules"))
    .filter(l => !/\/(dist|\.next|\.turbo)\//.test(l))
    .filter(l => !ALLOWED.some(a => a.test(l)))
    .filter(l => !allowMatches.some(a => a.test(l)))
    // Comments and doc blocks describe the format; they do not read it.
    .filter(l => !/:\s*(\/\/|\*|\/\*)/.test(l.replace(/^[^:]*:\d+:/, ":")));

  const pending = lines.filter(l => PENDING.some(p => p.test(l)));
  const failing = lines.filter(l => !PENDING.some(p => p.test(l)));

  if (failing.length > 0) {
    failures++;
    console.error(`✗ ${label} (${failing.length} hit(s)):`);
    for (const l of failing.slice(0, 20)) console.error(`    ${l}`);
    if (failing.length > 20)
      console.error(`    … ${failing.length - 20} more`);
  } else {
    console.log(`✓ ${label}`);
  }

  if (pending.length > 0) {
    console.log(
      `  ⧗ ${pending.length} known-outstanding site(s) not yet failing — ${PENDING_TRACKED_IN}`
    );
    for (const l of pending) console.log(`      ${l}`);
  }
}

// 🔴 BOTH generations are banned, not only the legacy one.
//
// The target spellings are what a migrated database actually uses, so a literal reading
// `_fieldGroupType` is wrong on precisely the installs the migration has already reached — and it
// is the spelling someone writing new code AFTER the flip would naturally reach for. Guarding only
// the legacy names would enforce the single-catalog rule on the generation that is on its way out
// while leaving the incoming one unguarded, which is the wrong half.
//
// 1. The content key, in both generations. No catalog can describe a key inside a row, so a
// literal here is the one spelling a database cannot be asked about — read it wrong and the
// instance loses its type.
grep(
  "content type key goes through the catalog (legacy spelling)",
  "_componentType"
);
grep(
  "content type key goes through the catalog (target spelling)",
  "_fieldGroupType"
);

// 2. The discriminator column. Catalog-resolvable, so a literal degrades rather than breaks —
// but it degrades on exactly the databases that have migrated.
grep(
  "type column goes through the catalog (legacy spelling)",
  "[\"'`]_component_type[\"'`]"
);
grep(
  "type column goes through the catalog (target spelling)",
  "[\"'`]_field_group_type[\"'`]"
);

// 3. The registry table. Same shape as the column.
grep(
  "registry table goes through the catalog (legacy spelling)",
  "[\"'`]dynamic_components[\"'`]"
);
grep(
  "registry table goes through the catalog (target spelling)",
  "[\"'`]dynamic_field_groups[\"'`]"
);

if (failures > 0) {
  console.error(
    `\n${failures} storage-spelling gate failure(s).\n` +
      `Read the spelling from schemas/storage-format.ts instead of writing it out. ` +
      `The catalog is what makes the storage migration a rename rather than a search.`
  );
  process.exit(1);
}
console.log("\nStorage-spelling gate passed.");
