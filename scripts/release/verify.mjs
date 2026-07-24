// Runs after `changeset publish` and answers one question: did the whole train
// land? Only when it did may the consolidated git tag and GitHub release be
// created, because a tag that points at a release the registry never received
// is worse than no tag: it makes an incomplete release look finished.
//
// Exit codes: 0 = registry matches the workspace, 1 = incomplete.

import { fetchAllRegistryStates, getReleaseManifest } from "./lib.mjs";

// npm's read replicas trail a publish by a few seconds, so a package that is
// genuinely live can 404 immediately afterwards. Retry before calling it missing.
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 6000;

const sleep = ms => new Promise(done => setTimeout(done, ms));

function collectMissing(manifest, registry) {
  const missing = [];
  for (const entry of manifest) {
    const state = registry.get(entry.name);
    if (state === null) {
      missing.push({
        name: entry.name,
        reason: "package not found on registry",
      });
    } else if (!state.versions.includes(entry.version)) {
      missing.push({
        name: entry.name,
        reason: `version ${entry.version} not published`,
      });
    }
  }
  return missing;
}

async function main() {
  const manifest = getReleaseManifest();
  const expectedVersion = manifest[0].version;

  let missing = [];
  let registry;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    registry = await fetchAllRegistryStates(manifest);
    missing = collectMissing(manifest, registry);
    if (missing.length === 0) break;
    if (attempt < ATTEMPTS) {
      console.log(
        `Waiting for ${missing.length} package(s) to appear on the registry ` +
          `(attempt ${attempt}/${ATTEMPTS})...`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.log(`Release verification for ${expectedVersion}`);
  console.log(`  expected packages: ${manifest.length}`);
  console.log(`  confirmed on npm:  ${manifest.length - missing.length}`);

  // Surfacing dist-tags here keeps the "which version does a bare install get?"
  // question answerable from the release log itself. `latest` is moved by a
  // separate deliberate step, never automatically, so it is expected to trail
  // the alpha channel during prereleases.
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

  if (missing.length > 0) {
    console.error(
      `\nIncomplete release: ${missing.length} package(s) did not publish`
    );
    for (const { name, reason } of missing) {
      console.error(`  ${name}: ${reason}`);
    }
    console.error(
      "\n  The packages that did publish are already live and cannot be unpublished.\n" +
        "  Fix the cause, then re-run the release: publishing is resumable because\n" +
        "  versions already on the registry are skipped."
    );
    process.exit(1);
  }

  console.log(
    `\nComplete release: all ${manifest.length} packages are live at ${expectedVersion}.`
  );
}

main().catch(error => {
  console.error(`verification failed: ${error.message}`);
  process.exit(1);
});
