// Shared helpers for the release preflight and post-publish verification steps.
// Both need the same answer to "which packages is this repo supposed to publish,
// at which version, on which dist-tag, and what does the registry currently
// hold?", and that answer must be derived from the workspace rather than
// hand-maintained: package counts written into prose have drifted from reality
// repeatedly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getPackagesSync } from "@manypkg/get-packages";

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
  { path: ["engines", "node"], label: "engines.node", equalsRootEngines: true },
];

/**
 * The Node range the repository itself supports, read from the root manifest.
 *
 * Published packages must advertise THIS range rather than one of their own. A package that
 * advertises more says it supports versions nothing in CI ever runs — `package-smoke.yml` derives
 * its Node legs from this same field, so the range and the tested versions are one question — and
 * the user finds out at runtime instead of at install time. Read rather than restated for the
 * reason `.claude/rules/derived-checks.md` gives: a second copy agrees on the day it is written.
 */
export function rootEnginesRange() {
  return readJson(join(REPO_ROOT, "package.json")).engines.node;
}

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
 *
 * Exported so that "is this a prerelease" is asked in ONE place. A second
 * spelling of it, however obvious, is a second answer waiting to disagree with
 * this one about a build-metadata suffix.
 */
export function firstPrereleaseId(version) {
  const withoutBuildMetadata = version.split("+")[0];
  const separator = withoutBuildMetadata.indexOf("-");
  if (separator === -1) return undefined;
  return withoutBuildMetadata.slice(separator + 1).split(".")[0];
}

/**
 * Whether a version is a prerelease OF a given active tag.
 *
 * 🔴 Deliberately not `firstPrereleaseId(version) === tag`, and deliberately
 * different from the comparison inside `getExpectedDistTag`. That one mirrors
 * Changesets, which classifies with `semver.parse(v).prerelease[0] === tag`
 * and so reads `1.2.3-next.1.0` as belonging to `next` rather than to
 * `next.1`. It has to keep that quirk: its job is to predict what
 * `changeset publish` will do, and predicting something better than the tool
 * does is still predicting wrong.
 *
 * This answers a different question, which is whether `pre.json` and the
 * manifests describe the same release. A dotted tag is where the two answers
 * part company, and borrowing the mirror here would switch the channel check
 * off for the whole of a `next.1` cycle rather than answer it incorrectly.
 * Both spellings are correct, for their own question, which is why they are
 * two functions with this note between them.
 */
export function isPrereleaseOfTag(version, tag) {
  const withoutBuildMetadata = version.split("+")[0];
  const separator = withoutBuildMetadata.indexOf("-");
  if (separator === -1) return false;
  const identifiers = withoutBuildMetadata.slice(separator + 1);
  if (!identifiers.startsWith(`${tag}.`)) return false;
  /*
   * 🔴 Exactly ONE counter after the tag, not merely the tag as a prefix.
   * `changeset version` in pre mode writes `<version>-<tag>.<n>`, so a `next`
   * cycle produces `-next.0` and a `next.1` cycle produces `-next.1.0`. A
   * prefix test alone reads that second one as an artifact of `next` too, and
   * a cycle exited under `next.1` and re-entered under `next` would then have
   * its old builds accepted as the new channel's.
   */
  return /^\d+$/.test(identifiers.slice(tag.length + 1));
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
 * `.changeset/pre.json` as it stands, or `null` when there is no such file.
 *
 * 🔴 Deliberately NOT `readPreState`, which answers `null` for `mode: "exit"`
 * and for no file at all. Those are different situations. Exiting prerelease
 * mode is a transition the repository is IN: the manifests still declare the
 * last alpha until the Version PR lands, so anything that cannot tell the two
 * apart treats that alpha as a stable release and expects `latest` to resolve
 * to it. The remedy that follows from believing this says to move `latest` onto
 * a prerelease, which is a worse outcome than the check not running at all.
 *
 * The whole record rather than the mode alone, because the ACTIVE TAG is half
 * of what makes a mode and a version agree: prerelease mode re-entered under a
 * new tag leaves manifests declaring the old one, and a reader holding only
 * `mode` cannot see the difference.
 */
export function readPreConfig() {
  if (!existsSync(PRE_STATE_PATH)) return null;
  const state = readJson(PRE_STATE_PATH);
  // A plain reader. Whether a mode and a tag make SENSE together is a question
  // for whoever is asking, and it is asked in `shouldAssertChannel`, where a
  // test can reach it.
  return { mode: state.mode ?? null, tag: state.tag ?? null };
}

/**
 * The workspace as the release tooling sees it, in two lists that are NOT the
 * same and must not be swapped:
 *
 * - `all` — every package Changesets resolves, private ones included. This is
 *   what a `fixed` entry is expanded against, so a pattern here has to match
 *   against exactly this list or the group this repository checks is not the
 *   group the release builds.
 * - `underPackagesDir` — those sitting directly in `packages/`. This is what the
 *   group is supposed to CONTAIN, which is a different question: `apps/*` is in
 *   the workspace and deliberately outside the release train.
 *
 * Both come from one walk rather than two, because they only mean anything
 * relative to each other: enumerated separately they could disagree about which
 * packages exist, and every comparison below would then be reading two different
 * workspaces.
 *
 * Resolved by `@manypkg/get-packages` rather than by reading a directory or a
 * workspace file, because that is the library Changesets itself enumerates
 * through — so what expands here and what expands at release time agree by
 * construction. The distinction is not academic in this repository: the root
 * manifest carries a `workspaces` field, which that library prefers over
 * `pnpm-workspace.yaml`, so the two files describe different sets and only one
 * of them is the one Changesets acts on.
 *
 * A package whose manifest has no `name` throws rather than being skipped: it is
 * a member of the workspace that no list here can report on, and dropping it
 * would make every check below quietly answer a smaller question.
 */
export function getWorkspacePackages() {
  const { packages } = getPackagesSync(REPO_ROOT);
  const all = [];
  const underPackagesDir = [];

  for (const entry of packages) {
    const name = entry.packageJson.name;
    all.push(name);
    if (dirname(entry.dir) === PACKAGES_DIR) underPackagesDir.push(name);
  }

  const byName = (a, b) => a.localeCompare(b);
  return {
    all: all.sort(byName),
    underPackagesDir: underPackagesDir.sort(byName),
  };
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
export function findMissingPublishFields(pkg, rootEngines = rootEnginesRange()) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const value = getPath(pkg, field.path);
    if (value == null || value === "") {
      missing.push(field.label);
      continue;
    }
    const expected = field.equalsRootEngines ? rootEngines : field.equals;
    if (expected && value !== expected) {
      missing.push(`${field.label} (expected "${expected}", found "${value}")`);
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
 *
 * A CONSEQUENCE worth stating where it will be read, because it makes the
 * bootstrap placeholder load-bearing long after it has stopped looking useful.
 * `firstPrereleaseId("0.0.0")` is `undefined` rather than the active tag, so the
 * stable `0.0.0` in a package's version list is exactly what makes it NOT
 * only-pre:
 *
 *     ["0.0.0", "0.0.2-alpha.52"] -> alpha      (the placeholder decides this)
 *     ["0.0.2-alpha.52"]          -> latest     (`latest` onto a prerelease)
 *
 * So removing a package's `0.0.0` once it has real versions — which reads as
 * tidying away a thing that has done its job — reclassifies it as only-pre and
 * points `latest` at an alpha build on the next publish. The placeholder claims
 * the name AND holds the dist-tag; only the first of those is obvious.
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
    headers: {
      accept: "application/vnd.npm.install-v1+json",
      /*
       * The registry sits behind a CDN, and every caller of this function is
       * asking what is true NOW rather than what was true recently: the
       * preflight decides what still needs publishing, the bootstrap check
       * decides whether a package exists, and the verification decides whether
       * a release is complete. A cached packument answers all three with the
       * state before the publish, and the verification would then spend its
       * whole budget re-reading one stale copy and conclude the packages never
       * arrived. Revalidation is what makes waiting meaningful.
       */
      "cache-control": "no-cache",
    },
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


/*
 * How long to keep asking the registry before calling a package missing.
 *
 * A publish is not one event. `changeset publish` returns once npm has accepted
 * every tarball, but a package becomes readable on the packument endpoint some
 * time later, and for a train this size that lag is measured in minutes rather
 * than in the "few seconds" a per-package view of it suggests: across twenty
 * packages accepted within one second of each other, the last four became
 * readable 47s, 125s, 179s and 186s afterwards. A budget shorter than that
 * reports a complete release as incomplete.
 *
 * The cost of the two mistakes is not symmetric, which is what sets the size.
 * Publishing has already succeeded by the time this runs, so waiting too long
 * spends CI minutes and nothing else. Giving up too early withholds the tag and
 * the GitHub release from a release npm accepted, leaving npm, git and the
 * releases page describing different things, and it does so on a step whose red
 * cross means "look again later" rather than "something is wrong" — which is
 * the kind of red that teaches a reader to wave the next one through.
 *
 * Ten minutes is roughly three times the longest settle observed, and the job
 * that runs it allows forty-five.
 */
const SETTLE_BUDGET_MS = 10 * 60 * 1000;

/*
 * Backoff rather than a fixed interval: a release that settles immediately is
 * the common case and should not pay a long first wait, while one that needs
 * minutes should not ask the registry a hundred times to find out.
 */
const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30_000;

/**
 * Packages that are not yet fully released, each with the reason. A missing
 * version and a stale dist-tag are reported separately because they need
 * different fixes: the first is a failed publish, the second a tag that was
 * never moved.
 */
export function collectProblems(manifest, registry, preState) {
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

/**
 * Ask the registry until it agrees the release is complete, or the budget runs out.
 *
 * The clock, the sleeper and the fetch are parameters so the waiting can be
 * exercised without one: a test that actually slept would have to choose
 * between a slow suite and a budget too small to describe the behaviour.
 *
 * Returns the last answer either way. A caller reports the problems; deciding
 * that an incomplete release is a failure is not this function's job, because
 * the same wait is the right one whether the caller exits or reports.
 */
export async function waitForCompleteRelease({
  manifest,
  preState,
  fetchStates,
  sleep: wait,
  now,
  budgetMs = SETTLE_BUDGET_MS,
  firstDelayMs = FIRST_DELAY_MS,
  maxDelayMs = MAX_DELAY_MS,
  /*
   * What "not settled yet" means, so a caller can ask a narrower question than
   * the release gate does. The default is the full predicate, which is right
   * for `verify`: it decides whether to finalize, so anything short of a whole
   * release is worth waiting on.
   *
   * 🔴 A caller that only reports must not wait on conditions that can never
   * clear. A dist-tag that was never moved is a real defect, not a delay, and a
   * package awaiting its first publish will not appear however long anyone
   * waits; waiting on either turns the budget into a guaranteed stall before
   * the same verdict.
   */
  problemsFor = collectProblems,
}) {
  const deadline = now() + budgetMs;
  let delay = firstDelayMs;
  let registry;
  let problems;
  let attempts = 0;

  for (;;) {
    registry = await fetchStates(manifest);
    problems = problemsFor(manifest, registry, preState);
    attempts += 1;
    if (problems.length === 0) break;

    // Measured against the deadline rather than counted, so the budget states a
    // duration and stays true however long a registry round trip takes.
    const remaining = deadline - now();
    if (remaining <= 0) break;

    const pause = Math.min(delay, remaining);
    console.log(
      `Waiting for ${problems.length} package(s) to settle on the registry ` +
        `(attempt ${attempts}, ${Math.round(remaining / 1000)}s of budget left)...`
    );
    await wait(pause);
    delay = Math.min(delay * 2, maxDelayMs);
  }

  return { registry, problems, attempts };
}

export { REGISTRY, REPO_ROOT };
