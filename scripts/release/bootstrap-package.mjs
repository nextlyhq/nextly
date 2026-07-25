// Claims a new package name on npm so trusted publishing can be configured for
// it. npm requires a package to exist before a Trusted Publisher entry can be
// attached, and OIDC cannot perform a package's first publish, so a brand-new
// package cannot bootstrap itself from CI. This publishes a minimal 0.0.0
// placeholder containing no code, which is the documented way out of that
// deadlock (`nextly` itself was claimed the same way).
//
// Usage:
//   node scripts/release/bootstrap-package.mjs @nextlyhq/admin-css            # dry run
//   node scripts/release/bootstrap-package.mjs @nextlyhq/admin-css --publish  # for real
//
// After it succeeds, add the package's Trusted Publisher entry on npmjs.com and
// let the normal release workflow publish every real version from then on.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { fetchRegistryState, getReleaseManifest } from "./lib.mjs";

const PLACEHOLDER_VERSION = "0.0.0";

const args = process.argv.slice(2);
const shouldPublish = args.includes("--publish");
const target = args.find(arg => !arg.startsWith("--"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (!target) {
    fail(
      "Usage: node scripts/release/bootstrap-package.mjs <package-name> [--publish]"
    );
  }

  // Refuse to run in CI. Every real release must go through trusted publishing,
  // and wiring this into a workflow would mean putting a long-lived npm token in
  // CI purely to claim a name: a standing credential replacing short-lived OIDC.
  // Claiming a name is a rare, one-time act; it stays a deliberate local one.
  if (shouldPublish && process.env.CI) {
    fail(
      "This script must not publish from CI.\n" +
        "Real versions are published by the release workflow through trusted\n" +
        "publishing (OIDC). Claiming a new package name is a one-time manual step;\n" +
        "run it locally after `npm login`."
    );
  }

  const entry = getReleaseManifest().find(pkg => pkg.name === target);
  if (!entry) {
    fail(
      `${target} is not a publishable package in this workspace.\n` +
        "Publishable packages are the non-private ones under packages/."
    );
  }

  // Refuse to touch a name that already exists: this script exists only to
  // create the very first version, and re-running it against a live package
  // would try to publish a 0.0.0 over real history.
  const state = await fetchRegistryState(target);
  if (state !== null) {
    fail(
      `${target} already exists on npm (versions: ${state.versions.join(", ")}).\n` +
        "Nothing to bootstrap. Configure its Trusted Publisher on npmjs.com instead."
    );
  }

  // The placeholder carries identity only. Publishing real code by hand is what
  // the release workflow is for, and a 0.0.0 keeps the alpha line untouched.
  const placeholder = {
    name: entry.name,
    version: PLACEHOLDER_VERSION,
    description: `Placeholder to claim the ${entry.name} package name. Install a published alpha instead.`,
    license: entry.pkg.license,
    repository: entry.pkg.repository,
    homepage: entry.pkg.homepage,
    bugs: entry.pkg.bugs,
    publishConfig: { access: "public" },
  };

  const readme =
    `# ${entry.name}\n\n` +
    `Placeholder release. This version contains no code: it exists so that npm ` +
    `trusted publishing can be configured for the package name.\n\n` +
    `Install a real release from the alpha channel instead:\n\n` +
    "```sh\n" +
    `npm install ${entry.name}@alpha\n` +
    "```\n";

  console.log(`Bootstrap ${entry.name}@${PLACEHOLDER_VERSION}`);
  console.log("  contents: package.json + README.md only (no code)");
  console.log(`  workspace version (published later by CI): ${entry.version}`);

  if (!shouldPublish) {
    console.log(
      "\nDry run. Nothing was published.\n" +
        "Re-run with --publish to claim the name (requires `npm login` first)."
    );
    return;
  }

  const stageDir = mkdtempSync(join(tmpdir(), "nextly-bootstrap-"));
  writeFileSync(
    join(stageDir, "package.json"),
    `${JSON.stringify(placeholder, null, 2)}\n`
  );
  writeFileSync(join(stageDir, "README.md"), readme);

  console.log(`\nPublishing from ${stageDir} ...`);
  try {
    execFileSync("npm", ["publish", "--access", "public"], {
      cwd: stageDir,
      stdio: "inherit",
    });
  } catch {
    fail(
      "\nPublish failed. Common causes: not logged in (`npm login`), or the\n" +
        "account lacks publish rights on the @nextlyhq scope."
    );
  }

  console.log(
    `\n${entry.name}@${PLACEHOLDER_VERSION} published.\n\n` +
      "Next, before the release workflow can publish it:\n" +
      `  1. Open https://www.npmjs.com/package/${entry.name}/access\n` +
      "  2. Add a Trusted Publisher: repository nextlyhq/nextly, workflow\n" +
      "     release.yml, environment Production (the environment name must match\n" +
      "     the release workflow's `environment:` exactly).\n" +
      "  3. Re-run the release. Publishing is resumable, so only the packages\n" +
      "     still missing from the registry are attempted."
  );
}

main().catch(error => {
  fail(`bootstrap failed: ${error.message}`);
});
