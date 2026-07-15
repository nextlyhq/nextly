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

const ROOT = path.join(__dirname, "..");

// package.json path (relative to repo root) → packages that must be exact-pinned there.
const TARGETS = [
  ["packages/nextly/package.json", ["drizzle-kit", "drizzle-orm"]],
  ["packages/adapter-drizzle/package.json", ["drizzle-orm"]],
  ["packages/adapter-postgres/package.json", ["drizzle-orm"]],
  ["packages/adapter-mysql/package.json", ["drizzle-orm"]],
  ["packages/adapter-sqlite/package.json", ["drizzle-orm"]],
  ["apps/playground/package.json", ["drizzle-orm"]],
];

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
    } else if (/^[\^~]/.test(depVersion)) {
      errors.push(
        `${relPath}: ${dep} version uses a caret or tilde (got "${depVersion}"). ` +
          'The pin policy requires an exact pin (e.g. "1.0.0-rc.4").'
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
