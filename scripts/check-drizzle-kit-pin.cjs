// What: fails the build if the drizzle dependency declarations drift away
// from the mandated shape (exact pins in `dependencies`, NOT in
// `peerDependencies`).
// Why: F1 hardened the lazy-import contract by pinning drizzle-kit exactly —
// a caret/tilde would let semver pull in a patch that changes the pushSchema
// output format, silently breaking the pipeline's statement handling.
// F21-Q4 locked the pin location to `dependencies` only.
// Drizzle V1 migration (2026-07, plan Step 0.3) extends the same rule to
// drizzle-orm across EVERY workspace package that declares it: during the
// v1 RC window a patch-level RC drift can change DDL emission or RQB
// behavior, so both packages stay exact-pinned until GA stabilizes.

const fs = require("node:fs");
const path = require("node:path");

const { REQUIRED_DRIZZLE_VERSION } = require("./drizzle-version.cjs");

const ROOT = path.join(__dirname, "..");

// Exact semver (optionally with prerelease/build) — rejects *, latest,
// ranges, 1.x, workspace:*, git/file specs, and anything else non-exact.
const EXACT_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// The drizzle deps this gate governs. A package is subject to the pin the
// moment it DECLARES either of these in any dependency section.
const GOVERNED_DEPS = ["drizzle-kit", "drizzle-orm"];
const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

// Discover every workspace package.json rather than hard-coding a list: a new
// package that starts depending on drizzle-orm would otherwise silently escape
// the pin. The workspace globs are apps/*, packages/*, and e2e
// (pnpm-workspace.yaml); expand them here without a YAML parser.
function discoverPackageJsons() {
  const found = [];
  const globDirs = ["apps", "packages"];
  for (const base of globDirs) {
    const baseAbs = path.join(ROOT, base);
    if (!fs.existsSync(baseAbs)) continue;
    for (const entry of fs.readdirSync(baseAbs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = path.join(base, entry.name, "package.json");
      if (fs.existsSync(path.join(ROOT, rel))) found.push(rel);
    }
  }
  // e2e is a single named workspace member, not a glob.
  if (fs.existsSync(path.join(ROOT, "e2e", "package.json"))) {
    found.push(path.join("e2e", "package.json"));
  }
  return found;
}

// Only the packages that actually declare a governed dep are enforced, so an
// unrelated workspace member never trips the gate.
const TARGETS = discoverPackageJsons()
  .map(relPath => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
    const declared = GOVERNED_DEPS.filter(dep =>
      DEP_SECTIONS.some(section => pkg[section] && pkg[section][dep])
    );
    return declared.length > 0 ? [relPath, declared] : null;
  })
  .filter(Boolean);

const errors = [];

for (const [relPath, deps] of TARGETS) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
  for (const dep of deps) {
    const depVersion = pkg.dependencies && pkg.dependencies[dep];
    if (!depVersion) {
      errors.push(
        `${relPath}: ${dep} is not in \`dependencies\`. The pin policy ` +
          "(F1 §3 / F21-Q4 / drizzle-v1 Step 0.3) requires it there as an exact pin."
      );
    } else if (!EXACT_SEMVER.test(depVersion)) {
      // Not just ^/~: *, latest, >=, 1.x, workspace:*, git/file specs are
      // all non-exact and must fail the gate.
      errors.push(
        `${relPath}: ${dep} version is not an exact semver (got "${depVersion}"). ` +
          'The pin policy requires an exact pin (e.g. "1.0.0-rc.4").'
      );
    } else if (depVersion !== REQUIRED_DRIZZLE_VERSION) {
      // "Exact and consistent" is not enough — a consistent WRONG version
      // (rc.3 everywhere, or kit/orm skew) would otherwise pass. The single
      // source of truth lives in scripts/drizzle-version.cjs.
      errors.push(
        `${relPath}: ${dep} is pinned to "${depVersion}" but the required ` +
          `version is "${REQUIRED_DRIZZLE_VERSION}" (scripts/drizzle-version.cjs). ` +
          "Bump the constant in a dedicated pin-bump PR that re-runs Phase 7."
      );
    }
    if (pkg.peerDependencies && pkg.peerDependencies[dep]) {
      errors.push(
        `${relPath}: ${dep} must NOT be listed in \`peerDependencies\` ` +
          "(per F21-Q4). Keep it in `dependencies` only."
      );
    }
  }
}

// All packages must agree on ONE drizzle-orm version (a mixed workspace would
// dedupe into two ORM instances and break `is()` cross-instance checks).
const ormVersions = new Set(
  TARGETS.map(([relPath]) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
    return pkg.dependencies && pkg.dependencies["drizzle-orm"];
  }).filter(Boolean)
);
if (ormVersions.size > 1) {
  errors.push(
    `drizzle-orm versions disagree across the workspace: ${[...ormVersions].join(", ")}. ` +
      "All packages must pin the same exact version."
  );
}

if (errors.length > 0) {
  for (const e of errors) console.error(`drizzle pin check: ${e}`);
  process.exit(1);
}

const nextlyPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages/nextly/package.json"), "utf8")
);
console.log(
  `drizzle pin OK: drizzle-kit ${nextlyPkg.dependencies["drizzle-kit"]}, ` +
    `drizzle-orm ${[...ormVersions][0]} (exact, deps-only, workspace-consistent)`
);
