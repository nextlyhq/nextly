// Runs before `changeset publish` and refuses to start a release that cannot
// finish. A multi-package npm publish is not atomic: when one package fails
// mid-run the others are already live, which leaves the registry, the git tags
// and the GitHub release describing three different releases. Everything checked
// here is knowable before the first byte is published.
//
// Exit codes: 0 = safe to publish, 1 = blocked.

import {
  classifyPreflight,
  fetchAllRegistryStates,
  getReleaseManifest,
  readFirstPublishAcknowledgements,
} from "./lib.mjs";

async function main() {
  const manifest = getReleaseManifest();
  if (manifest.length === 0) {
    console.error("preflight: no publishable packages found under packages/");
    process.exit(1);
  }

  const expectedVersion = manifest[0].version;
  const registry = await fetchAllRegistryStates(manifest);
  const {
    metadataErrors,
    versionMismatch,
    bootstrapNeeded,
    unprovenPublisher,
    staleAcknowledgements,
    alreadyPublished,
    toPublish,
  } = classifyPreflight(
    manifest,
    registry,
    expectedVersion,
    readFirstPublishAcknowledgements()
  );

  console.log(`Release preflight for ${expectedVersion}`);
  console.log(`  publishable packages: ${manifest.length}`);
  console.log(`  to publish:           ${toPublish.length}`);
  console.log(
    `  already on registry:  ${alreadyPublished.length} (publish skips these)`
  );
  if (bootstrapNeeded.length > 0) {
    console.log(`  never published:      ${bootstrapNeeded.length}`);
  }

  let blocked = false;

  if (metadataErrors.length > 0) {
    blocked = true;
    console.error("\nBlocked: incomplete publish metadata");
    for (const { name, missing } of metadataErrors) {
      console.error(`  ${name}: missing ${missing.join(", ")}`);
    }
  }

  if (versionMismatch.length > 0) {
    blocked = true;
    console.error(
      `\nBlocked: packages are not in lockstep at ${expectedVersion}`
    );
    for (const { name, version } of versionMismatch) {
      console.error(`  ${name}: ${version}`);
    }
  }

  // Blocking here is deliberate and cannot be waived from CI. npm requires a
  // package to exist before a trusted publisher can be attached to it, and OIDC
  // cannot perform a package's first publish, so this release genuinely cannot
  // succeed until the name is claimed once by a maintainer. Letting it start
  // anyway would publish the rest of the train and strand this package.
  if (bootstrapNeeded.length > 0) {
    blocked = true;
    console.error("\nBlocked: package has never been published to npm");
    for (const name of bootstrapNeeded) {
      console.error(`  ${name}`);
    }
    console.error(
      "\n  Claim each name once, then add its trusted publisher:\n" +
        bootstrapNeeded
          .map(
            name =>
              `    node scripts/release/bootstrap-package.mjs ${name} --publish`
          )
          .join("\n") +
        "\n\n  See the release-and-changesets skill for the full procedure."
    );
  }

  // Claimed on npm, never actually published. The registry cannot show whether
  // a Trusted Publisher was attached, and a publish attempt without one answers
  // 404 — the same answer as a package that does not exist. Discovering that
  // during `changeset publish` is what leaves the rest of the train live with
  // no tag and no release, so it is settled here instead.
  if (unprovenPublisher.length > 0) {
    blocked = true;
    console.error(
      "\nBlocked: package exists on npm but has only its bootstrap placeholder"
    );
    for (const name of unprovenPublisher) {
      console.error(`  ${name}`);
    }
    console.error(
      "\n  Confirm each one's Trusted Publisher at npmjs.com (repository\n" +
        "  nextlyhq/nextly, workflow release.yml, environment Production), then\n" +
        "  add it to scripts/release/first-publish-acknowledged.json:\n" +
        unprovenPublisher.map(name => `    "${name}"`).join("\n")
    );
  }

  if (staleAcknowledgements.length > 0) {
    // Not a failure: the acknowledgement did its job and now only obscures
    // which packages still need one.
    console.log(
      "\nAcknowledgements no longer needed (these have published real versions):"
    );
    for (const name of staleAcknowledgements) {
      console.log(`  ${name} — remove from first-publish-acknowledged.json`);
    }
  }

  if (blocked) {
    console.error(
      "\nRelease aborted before publishing. Nothing was pushed to npm."
    );
    process.exit(1);
  }

  if (toPublish.length === 0) {
    console.log(
      "\nNothing new to publish; the registry already has this version."
    );
  } else {
    console.log(`\nReady to publish: ${toPublish.join(", ")}`);
  }
}

main().catch(error => {
  console.error(`preflight failed: ${error.message}`);
  process.exit(1);
});
