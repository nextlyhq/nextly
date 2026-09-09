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
  getReleaseManifest,
  readPreState,
  waitForCompleteRelease,
} from "./lib.mjs";

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  const manifest = getReleaseManifest();
  const preState = readPreState();
  const expectedVersion = manifest[0].version;

  const { registry, problems } = await waitForCompleteRelease({
    manifest,
    preState,
    fetchStates: fetchAllRegistryStates,
    sleep,
    now: () => Date.now(),
  });

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
