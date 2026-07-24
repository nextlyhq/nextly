// Runs before `changeset publish` and refuses to start a release that cannot
// finish. A multi-package npm publish is not atomic: when one package fails
// mid-run the others are already live, which leaves the registry, the git tags
// and the GitHub release describing three different releases. Everything checked
// here is knowable before the first byte is published.
//
// Exit codes: 0 = safe to publish, 1 = blocked.
//
// Set NEXTLY_RELEASE_ALLOW_BOOTSTRAP=1 for the deliberate first publish of a new
// package name, which is the one case where "this package does not exist on the
// registry" is expected rather than fatal.

import {
  fetchAllRegistryStates,
  findMissingPublishFields,
  getReleaseManifest,
} from "./lib.mjs";

const allowBootstrap = process.env.NEXTLY_RELEASE_ALLOW_BOOTSTRAP === "1";

async function main() {
  const manifest = getReleaseManifest();
  if (manifest.length === 0) {
    console.error("preflight: no publishable packages found under packages/");
    process.exit(1);
  }

  const registry = await fetchAllRegistryStates(manifest);

  const metadataErrors = [];
  const bootstrapNeeded = [];
  const alreadyPublished = [];
  const toPublish = [];
  const versionMismatch = [];

  const expectedVersion = manifest[0].version;

  for (const entry of manifest) {
    const missing = findMissingPublishFields(entry.pkg);
    if (missing.length > 0) {
      metadataErrors.push({ name: entry.name, missing });
    }

    // Every publishable package shares one version through the Changesets
    // `fixed` group; a package that drifts off it means the release is not the
    // lockstep train the changelog and release notes will claim it is.
    if (entry.version !== expectedVersion) {
      versionMismatch.push({ name: entry.name, version: entry.version });
    }

    const state = registry.get(entry.name);
    if (state === null) {
      bootstrapNeeded.push(entry.name);
    } else if (state.versions.includes(entry.version)) {
      alreadyPublished.push(entry.name);
    } else {
      toPublish.push(entry.name);
    }
  }

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

  if (bootstrapNeeded.length > 0 && !allowBootstrap) {
    blocked = true;
    console.error("\nBlocked: package has never been published to npm");
    for (const name of bootstrapNeeded) {
      console.error(`  ${name}`);
    }
    console.error(
      "\n  A trusted publisher can only be configured against a package that exists,\n" +
        "  so the first publish of a new name has to be made deliberately. Publish it\n" +
        "  once, add its trusted publisher entry on npmjs.com, then re-run the release.\n" +
        "  Set NEXTLY_RELEASE_ALLOW_BOOTSTRAP=1 to run that first publish from CI."
    );
  }

  if (blocked) {
    console.error(
      "\nRelease aborted before publishing. Nothing was pushed to npm."
    );
    process.exit(1);
  }

  // A bootstrap run publishes the new names too, so report everything the
  // publish step will attempt rather than only the packages that already exist.
  const attempting = [...toPublish, ...(allowBootstrap ? bootstrapNeeded : [])];

  if (attempting.length === 0) {
    console.log(
      "\nNothing new to publish; the registry already has this version."
    );
  } else {
    console.log(`\nReady to publish: ${attempting.sort().join(", ")}`);
    if (allowBootstrap && bootstrapNeeded.length > 0) {
      console.log(
        `  first publish for: ${bootstrapNeeded.join(", ")} ` +
          "(add each one's trusted publisher on npmjs.com afterwards)"
      );
    }
  }
}

main().catch(error => {
  console.error(`preflight failed: ${error.message}`);
  process.exit(1);
});
