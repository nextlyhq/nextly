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
 * ## 🔴 What a PASS here does NOT mean
 *
 * Stated rather than left to be inferred, because the next reader's honest reading of a green run
 * decides whether they look further. A scan reports on the forms it can see, and these are the
 * forms it cannot:
 *
 * - **A spelling assembled at runtime** — `"_component" + "Type"`, a template literal, or the key
 *   reached through a variable or a constant defined elsewhere. Nothing textual can follow that.
 * - **TEST files and `__tests__/`**, exempted wholesale. A test that asserts concrete stored bytes
 *   cannot describe them indirectly without asserting nothing, so the exemption is deliberate —
 *   but it is broad, and a stored-row FIXTURE written with the raw key is one of the ways a
 *   completed rename gets quietly reverted later. There is currently no automatic way to tell a
 *   fixture from an assertion about the format, so this stays a review-time concern.
 * - **Comment and doc-block lines**, filtered on purpose: prose describing the format does not read
 *   it, and requiring the docs to avoid naming the thing they document makes them worse.
 *
 *   🔴 That justification covers PROSE; the filter's effect covers ALL comments, and the two are
 *   the same set only until someone parks code or writes an example. A commented-out assignment is
 *   an executable site the moment it is uncommented, and a doc-block code EXAMPLE is worse than an
 *   executable occurrence — it teaches the spelling to everyone who copies it, in the documents
 *   most likely to be describing the rename. Neither announces itself later, because the gate
 *   stays green while the gap widens. Distinguishing them mechanically means parsing comment
 *   bodies, which is more machinery than this is worth; the limit is stated instead.
 *
 * What a pass DOES mean is narrower and still worth having: no product source line outside the
 * catalog, the accessor and the migration engine names either spelling of the table, the column or
 * the content key, and none reads that key from the catalog instead of through the accessor.
 *
 * The gate is also only as current as the run: a file that gains its first occurrence after a
 * sweep is not exempt, so this is worth running against the merge target immediately before
 * merging rather than trusting the state at branch time.
 */

const { execFileSync } = require("node:child_process");
const { existsSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

let failures = 0;

/**
 * Plant a known hit for EVERY pattern and run each through the real scan.
 *
 * 🔴 An earlier version planted one literal and checked one pattern. That certifies one scan: if
 * any other pattern is mistyped or stops matching, its own check reports no hits, the fixture stays
 * green, and part of the gate is silently switched off while the run still prints a tick for it. A
 * control that samples cannot speak for the cases it did not sample.
 *
 * Each case is evaluated with the exact expression its production check uses, read from the same
 * array, so a pattern edited in one place cannot be verified against a different one.
 */
function assertScanSeesEveryPattern() {
  const relativePath = "packages/nextly/src/__storage-gate-selfcheck-fixture.ts";
  const fixture = path.join(ROOT, relativePath);
  const blind = [];

  // 🔴 Refuse rather than overwrite. This writes to a fixed path and deletes it afterwards, so a
  // real file sitting there — tracked, or someone's uncommitted work — would be replaced and then
  // removed by merely RUNNING the gate. A check that destroys source to verify itself is a worse
  // defect than the one it looks for, and the name being improbable is not a guarantee.
  if (existsSync(fixture)) {
    console.error(
      `✗ ${relativePath} already exists.\n` +
        "  The self-check writes and deletes that path, so it refuses to touch a file it did not\n" +
        "  create. Move or remove it and run again."
    );
    process.exit(1);
  }

  try {
    for (const check of CHECKS) {
      // Not a comment, not a test file, not an allowlisted path: none of the deliberate exemptions
      // apply, so the only reason this could go unseen is a scan that stopped working.
      writeFileSync(fixture, `${check.plant}\n`);
      const hits = collectHits(check.pattern);
      if (!hits.some(line => line.includes(relativePath))) blind.push(check.label);
    }
  } finally {
    if (existsSync(fixture)) rmSync(fixture);
  }

  if (blind.length > 0) {
    console.error(
      "✗ the scan did not see a planted hit for these checks, so each would pass below\n" +
        "  without examining anything:"
    );
    for (const label of blind) console.error(`    ${label}`);
    process.exit(1);
  }

  console.log(
    `scan self-check passed: ${CHECKS.length} patterns each saw a planted hit\n`
  );
}


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
  // The catalogs themselves, where the strings are DEFINED.
  /packages\/nextly\/src\/schemas\/storage-format\.ts:/,
  // 🔴 Named FILE by file, not by directory. A directory exemption covers whatever is added to it
  // later, so a new reader dropped beside these would inherit their licence to hardcode and the
  // gate would report success — the exact regression it exists to catch. Adding a file here should
  // require justifying it, which a folder pattern silently skips.
  /packages\/nextly\/src\/domains\/field-groups\/storage\/field-group-type-key\.ts:/,
  /packages\/nextly\/src\/domains\/field-groups\/storage\/resolve-storage-names\.ts:/,
  // The migration engine is exempt as a DIRECTORY, and that one is deliberate: renaming one
  // spelling to the other is the whole of its job, so every file in it names both by construction.
  // Narrowing it to a file list would be a list that has to be edited for each new step, which is
  // the same failure in slower form.
  /packages\/nextly\/src\/domains\/field-groups\/migration\//,
  /__tests__\//,
  /\.test\.tsx?:/,
  /\.test-d\.ts:/,
];


/**
 * The scan itself: everything deciding WHICH lines count as hits.
 *
 * Split from the reporting so the self-check can run the real one rather than a lookalike.
 */
function collectHits(pattern, opts = {}) {
  const {
    // 🔴 Every source extension the repository ships, not only TypeScript. A reader or writer of
    // the storage key added to an existing `.js` or `.mjs` file — a CLI bin, a build script, a
    // template's runtime — is product code by every meaning that matters here, and a TS-only
    // include list skips it while still reporting PASS. That is the narrowing failure this gate
    // exists to prevent, committed by the gate itself: a check that cannot read part of its
    // subject answers a smaller question and answers it in the affirmative.
    include = [
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
      "*.mjs",
      "*.cjs",
      "*.mts",
      "*.cts",
    ],
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

  // Every hit fails. The admin sites that were once pinned here are converted, so there is no
  // tolerated set left — and a list that matches nothing is worse than no list, because it would
  // silently re-admit exactly those lines if they came back.
  const failing = lines;

  return failing;
}

/** Run a scan and report its verdict. */
function grep(label, pattern, opts = {}) {
  const failing = collectHits(pattern, opts);

  if (failing.length > 0) {
    failures++;
    console.error(`✗ ${label} (${failing.length} hit(s)):`);
    for (const l of failing.slice(0, 20)) console.error(`    ${l}`);
    if (failing.length > 20)
      console.error(`    … ${failing.length - 20} more`);
  } else {
    console.log(`✓ ${label}`);
  }

}


// 🔴 BOTH generations are banned, not only the legacy one.
//
// The target spellings are what a migrated database actually uses, so a literal reading
// `_fieldGroupType` is wrong on precisely the installs the migration has already reached. Guarding
// only the legacy names enforces the rule on the generation on its way out and leaves the incoming
// one unguarded, which is the wrong half.
//
// Declared as data rather than as seven calls so the self-check can plant a known hit for EVERY
// pattern from this same array. Checking one and trusting the rest is how a mistyped pattern
// retires its own scan while the run still prints a tick for it.
const CHECKS = [
  {
    label: "content type key goes through the catalog (legacy spelling)",
    pattern: "_componentType",
    plant: "export const planted = row._componentType;",
  },
  {
    label: "content type key goes through the catalog (target spelling)",
    pattern: "_fieldGroupType",
    plant: "export const planted = row._fieldGroupType;",
  },
  {
    label: "type column goes through the catalog (legacy spelling)",
    pattern: "\\b_component_type\\b",
    plant: "export const planted = row._component_type;",
  },
  {
    label: "type column goes through the catalog (target spelling)",
    pattern: "\\b_field_group_type\\b",
    plant: "export const planted = row._field_group_type;",
  },
  {
    label: "registry table goes through the catalog (legacy spelling)",
    pattern: "\\bdynamic_components\\b",
    plant: 'export const planted = "dynamic_components";',
  },
  {
    label: "registry table goes through the catalog (target spelling)",
    pattern: "\\bdynamic_field_groups\\b",
    plant: 'export const planted = "dynamic_field_groups";',
  },
  {
    label: "content type key is reached through the accessor",
    pattern: "\\bwireTypeKey\\b",
    plant: "export const planted = CATALOG.wireTypeKey;",
  },
];

assertScanSeesEveryPattern();

for (const check of CHECKS) grep(check.label, check.pattern);

// 🔴 The verdict. Without this the script prints every ✗ and exits 0, which is worse than having
// no gate: CI reports a pass, the output scrolls by in a green job, and the failures read as
// decoration. It was lost when the checks became data — the edit replaced from the array to the
// end of the file and took this with it.
if (failures > 0) {
  console.error(
    `\n${failures} storage-spelling gate failure(s).\n` +
      `Read the spelling from schemas/storage-format.ts instead of writing it out. ` +
      `The catalog is what makes the storage migration a rename rather than a search.`
  );
  process.exit(1);
}
console.log("\nStorage-spelling gate passed.");
