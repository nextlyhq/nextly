// Runs after `changeset publish` and answers one question: did the whole train
// land, on the channel consumers actually install from? Only when it did may the
// consolidated git tag and GitHub release be created, because a tag that points
// at a release the registry never received is worse than no tag: it makes an
// incomplete release look finished.
//
// Checking that a version merely exists is not enough. A package can publish
// successfully while its dist-tag still points at an older version, so
// `pkg@alpha` keeps resolving to the previous release (or to nothing at all) even
// though the new version is on the registry.
//
// Exit codes: 0 = registry matches the workspace, 1 = incomplete.

import {
  fetchAllRegistryStates,
  getExpectedDistTag,
  getReleaseManifest,
  readPreState,
} from "./lib.mjs";

// npm's read replicas trail a publish by a few seconds, so a package that is
// genuinely live can 404 immediately afterwards. Retry before calling it missing.
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 6000;

const sleep = ms => new Promise(done => setTimeout(done, ms));

/**
 * Packages that are not yet fully released, each with the reason. A missing
 * version and a stale dist-tag are reported separately because they need
 * different fixes: the first is a failed publish, the second a tag that was
 * never moved.
 */
function collectProblems(manifest, registry, preState) {
  const problems = [];

  for (const entry of manifest) {
    const state = registry.get(entry.name);

    if (state === null) {
      problems.push({
        name: entry.name,
        reason: "package not found on registry",
      });
      continue;
    }

    if (!state.versions.includes(entry.version)) {
      problems.push({
        name: entry.name,
        reason: `version ${entry.version} not published`,
      });
      continue;
    }

    const expectedTag = getExpectedDistTag(state, preState);
    const actual = state.distTags[expectedTag];
    if (actual !== entry.version) {
      problems.push({
        name: entry.name,
        reason:
          `dist-tag "${expectedTag}" points at ${actual ?? "nothing"}, ` +
          `so ${entry.name}@${expectedTag} does not resolve to ${entry.version}`,
      });
    }
  }

  return problems;
}

async function main() {
  const manifest = getReleaseManifest();
  const preState = readPreState();
  const expectedVersion = manifest[0].version;

  let problems = [];
  let registry;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    registry = await fetchAllRegistryStates(manifest);
    problems = collectProblems(manifest, registry, preState);
    if (problems.length === 0) break;
    if (attempt < ATTEMPTS) {
      console.log(
        `Waiting for ${problems.length} package(s) to settle on the registry ` +
          `(attempt ${attempt}/${ATTEMPTS})...`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.log(`Release verification for ${expectedVersion}`);
  console.log(`  expected packages: ${manifest.length}`);
  console.log(`  fully released:    ${manifest.length - problems.length}`);
  if (preState) {
    console.log(`  prerelease channel: ${preState.tag}`);
  }

  // Printing the tags keeps "which version does an install actually get?"
  // answerable from the release log itself. `latest` is moved by a separate
  // deliberate step, never automatically, so during prereleases it is expected
  // to trail the active channel.
  const distTagReport = manifest
    .map(entry => {
      const tags = registry.get(entry.name)?.distTags ?? {};
      const rendered = Object.entries(tags)
        .map(([tag, version]) => `${tag}=${version}`)
        .join(" ");
      return `  ${entry.name}: ${rendered || "(no dist-tags)"}`;
    })
    .join("\n");
  console.log("\nDist-tags:\n" + distTagReport);

  if (problems.length > 0) {
    console.error(
      `\nIncomplete release: ${problems.length} package(s) are not fully released`
    );
    for (const { name, reason } of problems) {
      console.error(`  ${name}: ${reason}`);
    }
    console.error(
      "\n  Packages that did publish are already live and cannot be unpublished.\n" +
        "  Fix the cause, then re-run the release: publishing is resumable because\n" +
        "  versions already on the registry are skipped."
    );
    process.exit(1);
  }

  console.log(
    `\nComplete release: all ${manifest.length} packages are live at ${expectedVersion}` +
      `${preState ? ` on the ${preState.tag} channel` : ""}.`
  );
}

main().catch(error => {
  console.error(`verification failed: ${error.message}`);
  process.exit(1);
});
