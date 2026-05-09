// What: fails the build if drizzle-kit's dependency declaration drifts
// away from the F1-mandated shape (exact pin in `dependencies`, NOT in
// `peerDependencies`).
// Why: F1 hardens the lazy-import contract by pinning drizzle-kit
// exactly. A caret/tilde would let semver pull in a patch that changes
// the pushSchema output format, silently breaking the F4 RenameDetector
// regex when it lands. F21-Q4 also locked the pin location to
// `dependencies` only (no `peerDependencies` entry); this script
// enforces that decision in CI so a future PR cannot accidentally drift.

const fs = require("node:fs");
const path = require("node:path");

const pkgPath = path.join(
  __dirname,
  "..",
  "packages",
  "nextly",
  "package.json"
);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

const errors = [];

const depVersion = pkg.dependencies && pkg.dependencies["drizzle-kit"];
if (!depVersion) {
  errors.push(
    "drizzle-kit is not in `dependencies`. F1 spec section 3 / F21-Q4 " +
      "require it there as an exact pin."
  );
} else if (/^[\^~]/.test(depVersion)) {
  errors.push(
    `drizzle-kit version uses a caret or tilde (got "${depVersion}"). ` +
      "F1 spec requires an exact pin (e.g. \"0.31.10\")."
  );
}

if (pkg.peerDependencies && pkg.peerDependencies["drizzle-kit"]) {
  errors.push(
    "drizzle-kit must NOT be listed in `peerDependencies` " +
      "(per F21-Q4 in the F1 design spec). Move it to `dependencies` only."
  );
}

if (errors.length > 0) {
  for (const e of errors) console.error(`drizzle-kit pin check: ${e}`);
  process.exit(1);
}

console.log(`drizzle-kit pin OK: ${depVersion}`);
