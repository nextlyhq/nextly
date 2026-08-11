// Shared helpers for the release preflight and post-publish verification steps.
// Both need the same answer to "which packages is this repo supposed to publish,
// at which version, on which dist-tag, and what does the registry currently
// hold?", and that answer must be derived from the workspace rather than
// hand-maintained: package counts written into prose have drifted from reality
// repeatedly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const PRE_STATE_PATH = join(REPO_ROOT, ".changeset", "pre.json");
const FIRST_PUBLISH_PATH = join(
  REPO_ROOT,
  "scripts",
  "release",
  "first-publish-acknowledged.json"
);
const REGISTRY = "https://registry.npmjs.org";

/**
 * Publish metadata every public package must carry. Missing `publishConfig.access`
 * is fatal for a scoped package: npm defaults scoped publishes to `restricted`,
 * which a public-only org cannot complete, and the failure surfaces late (during
 * the publish call) rather than at validation time.
 */
const REQUIRED_FIELDS = [
  { path: ["license"], label: "license" },
  { path: ["repository", "directory"], label: "repository.directory" },
  {
    path: ["publishConfig", "access"],
    label: "publishConfig.access",
    equals: "public",
  },
  { path: ["engines", "node"], label: "engines.node" },
];

/** Parses a JSON file, surfacing the path in the error so callers can report it. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not readable JSON: ${error.message}`);
  }
}

/** Reads a nested value by key path, tolerating missing intermediate objects. */
function getPath(object, path) {
  return path.reduce(
    (value, key) => (value == null ? undefined : value[key]),
    object
  );
}

/**
 * The first prerelease identifier of a SemVer string, or `undefined` for a
 * stable version: `1.0.0-alpha.4` -> `"alpha"`, `1.0.0` -> `undefined`. Mirrors
 * `semver.parse(v).prerelease[0]` for the shapes npm accepts, without pulling in
 * a dependency for one field.
 */
function firstPrereleaseId(version) {
  const withoutBuildMetadata = version.split("+")[0];
  const separator = withoutBuildMetadata.indexOf("-");
  if (separator === -1) return undefined;
  return withoutBuildMetadata.slice(separator + 1).split(".")[0];
}

/**
 * The Changesets prerelease state, or `null` outside prerelease mode. The active
 * tag decides which dist-tag consumers install from, so verification has to read
 * it rather than assume `latest`.
 */
export function readPreState() {
  if (!existsSync(PRE_STATE_PATH)) return null;
  const state = readJson(PRE_STATE_PATH);
  return state.mode === "pre" ? state : null;
}

/**
 * Every workspace package that `changeset publish` is expected to push to npm:
 * the contents of `packages/*` minus anything marked private. Private packages
 * still belong to the Changesets `fixed` group (their internal versions track the
 * train) but they are never publishable artifacts, so counting them as part of a
 * release is how "N packages published" claims go wrong.
 *
 * A manifest that exists but cannot be parsed is an error rather than a silent
 * skip: dropping it here would also drop it from every check below.
 */
/**
 * Every package name under `packages/`, private ones included.
 *
 * Deliberately wider than {@link getReleaseManifest}, which answers "what do we
 * publish". Changesets versions private workspace packages too unless told
 * otherwise, so the set it has to be told about is every package in the
 * directory rather than only the publishable ones — and a checker comparing the
 * `fixed` group against the narrower list would report the config-only packages
 * as errors on every run.
 */
export function getWorkspacePackageNames() {
  const names = [];
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PACKAGES_DIR, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const pkg = readJson(manifestPath);
    if (typeof pkg.name === "string") names.push(pkg.name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export function getReleaseManifest() {
  const manifest = [];

  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(PACKAGES_DIR, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;

    const pkg = readJson(manifestPath);
    if (pkg.private === true) continue;

    manifest.push({
      name: pkg.name,
      version: pkg.version,
      dir: dirname(manifestPath),
      manifestPath,
      pkg,
    });
  }

  return manifest.sort((a, b) => a.name.localeCompare(b.name));
}

/** Fields a package is missing, so preflight can name them all in one pass. */
export function findMissingPublishFields(pkg) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const value = getPath(pkg, field.path);
    if (value == null || value === "") {
      missing.push(field.label);
      continue;
    }
    if (field.equals && value !== field.equals) {
      missing.push(
        `${field.label} (expected "${field.equals}", found "${value}")`
      );
    }
  }
  return missing;
}

/**
 * The dist-tag `changeset publish` will move for a package, mirroring its
 * `getReleaseTag`: in prerelease mode the configured tag is used, EXCEPT for a
 * package classified `only-pre`, which goes to `latest` instead "because there
 * has not been a regular release of it yet".
 *
 * `only-pre` is narrower than "has no stable version". Changesets requires EVERY
 * published version to be a prerelease of the *active* tag, so a package
 * carrying only `-beta.N` versions while the active tag is `alpha` is NOT
 * only-pre and publishes to `alpha`. Approximating this with "no stable version"
 * would expect `latest` for such a package and reject a correct publish on every
 * retry, permanently blocking the consolidated tag.
 */
export function getExpectedDistTag(registryState, preState) {
  if (!preState) return "latest";

  const versions = registryState?.versions ?? [];
  const onlyPre =
    versions.length > 0 &&
    versions.every(version => firstPrereleaseId(version) === preState.tag);

  return onlyPre ? "latest" : preState.tag;
}

/**
 * The version `bootstrap-package.mjs` publishes to claim a name.
 *
 * A package sitting at exactly this and nothing else has had its NAME claimed
 * and has never completed a real publish, which is a distinct state from both
 * "unknown to npm" and "released": the trusted publisher may or may not have
 * been attached, and nothing observable from here can tell the difference.
 */
export const PLACEHOLDER_VERSION = "0.0.0";

/**
 * Whether a package exists on the registry but has only ever been bootstrapped.
 *
 * npm requires a package to exist before a Trusted Publisher can be attached to
 * it, so claiming the name and configuring the publisher are two separate acts
 * by a human, and only the first leaves a trace the registry will show. A
 * package in this state therefore has an UNPROVEN publish path: `npm publish`
 * over OIDC answers 404 when the publisher is missing, and that answer is
 * indistinguishable from the package not existing.
 *
 * It matters because a multi-package publish is not atomic. One package failing
 * this way leaves every other package in the train already live, with no tag and
 * no release describing them.
 */
export function isBootstrapPlaceholderOnly(state) {
  if (state === null) return false;
  return (
    state.versions.length === 1 && state.versions[0] === PLACEHOLDER_VERSION
  );
}

/**
 * Registry state for one package. Returns `null` when the package name has never
 * been published, which is a materially different situation from "published, but
 * not at this version": a first publish cannot authenticate through a trusted
 * publisher that does not exist yet, so it needs a deliberate bootstrap.
 */
export async function fetchRegistryState(name) {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `registry lookup failed for ${name}: ${response.status} ${response.statusText}`
    );
  }

  const body = await response.json();
  return {
    versions: Object.keys(body.versions ?? {}),
    distTags: body["dist-tags"] ?? {},
  };
}

/**
 * Packages a maintainer has confirmed are configured for trusted publishing.
 *
 * Read from a file in the repository rather than an environment variable so the
 * acknowledgement arrives through review, in the same change that adds the
 * package, instead of being typed once into a workflow run nobody can see
 * afterwards.
 */
export function readFirstPublishAcknowledgements() {
  if (!existsSync(FIRST_PUBLISH_PATH)) return [];
  const contents = readJson(FIRST_PUBLISH_PATH);
  return Array.isArray(contents.packages) ? contents.packages : [];
}

/**
 * Everything preflight needs to decide whether a release may start.
 *
 * Pure, and separate from the script that prints it, so each rule can be tested
 * against a constructed registry instead of against npm.
 */
export function classifyPreflight(
  manifest,
  registry,
  expectedVersion,
  acknowledged = []
) {
  const metadataErrors = [];
  const versionMismatch = [];
  const bootstrapNeeded = [];
  const unprovenPublisher = [];
  const staleAcknowledgements = [];
  const alreadyPublished = [];
  const toPublish = [];

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

    const state = registry.get(entry.name) ?? null;
    const isAcknowledged = acknowledged.includes(entry.name);

    if (state === null) {
      bootstrapNeeded.push(entry.name);
      continue;
    }

    if (isBootstrapPlaceholderOnly(state)) {
      // Claimed but never really published: the publish path is unproven, and
      // finding out by trying is what strands the rest of the train.
      if (!isAcknowledged) unprovenPublisher.push(entry.name);
    } else if (isAcknowledged) {
      // The entry has done its job and now only invites confusion about which
      // packages still need attention.
      staleAcknowledgements.push(entry.name);
    }

    if (state.versions.includes(entry.version)) {
      alreadyPublished.push(entry.name);
    } else {
      toPublish.push(entry.name);
    }
  }

  return {
    metadataErrors,
    versionMismatch,
    bootstrapNeeded,
    unprovenPublisher,
    staleAcknowledgements,
    alreadyPublished,
    toPublish,
  };
}

/** Resolves registry state for the whole manifest concurrently. */
export async function fetchAllRegistryStates(manifest) {
  const states = await Promise.all(
    manifest.map(async entry => [
      entry.name,
      await fetchRegistryState(entry.name),
    ])
  );
  return new Map(states);
}

export { REGISTRY, REPO_ROOT };
