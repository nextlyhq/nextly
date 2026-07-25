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
