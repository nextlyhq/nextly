// Shared helpers for the release preflight and post-publish verification steps.
// Both need the same answer to "which packages is this repo supposed to publish,
// at which version, and what does the registry currently hold?", and that answer
// must be derived from the workspace rather than hand-maintained: package counts
// written into prose have drifted from reality repeatedly.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function getPath(object, path) {
  return path.reduce(
    (value, key) => (value == null ? undefined : value[key]),
    object
  );
}

/**
 * Every workspace package that `changeset publish` is expected to push to npm:
 * the contents of `packages/*` minus anything marked private. Private packages
 * still belong to the Changesets `fixed` group (their internal versions track the
 * train) but they are never publishable artifacts, so counting them as part of a
 * release is how "N packages published" claims go wrong.
 */
export function getReleaseManifest() {
  const entries = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(PACKAGES_DIR, entry.name, "package.json"));

  const manifest = [];
  for (const manifestPath of entries) {
    let pkg;
    try {
      pkg = readJson(manifestPath);
    } catch {
      continue;
    }
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

export { REPO_ROOT };
