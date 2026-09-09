#!/usr/bin/env node

/**
 * Does the release `main` declares actually exist everywhere it should?
 *
 * A release is three facts, not one: the packages are on the registry, a git
 * tag points at the commit they were built from, and a GitHub Release describes
 * it. Publishing writes the first. The second and third are written by a later
 * step, and that step can be skipped.
 *
 * 🔴 It has been skipped twice. `verify` gave up on a slow registry, its
 * non-zero exit stopped the tag and the release from being created, and the
 * next commit landed before anyone re-ran it. Both `0.0.2-alpha.64` and
 * `0.0.2-alpha.65` sat on npm for hours with no tag and no release, and nothing
 * said so: the failure was one red cross on one run, in a repository where runs
 * go red for unrelated reasons all day. Both were repaired by hand.
 *
 * This makes that state speak. It does not repair anything, deliberately: the
 * repair is `gh run rerun <id> --failed`, which re-runs at the commit that was
 * published and therefore tags the right one. A checker that tagged whatever it
 * found at HEAD would tag a commit that was never released, which is the
 * failure the release workflow already refuses.
 *
 * ⚠️ THE VERSION COMES FROM A GIT REF, NEVER FROM THE WORKING TREE. On the
 * version-PR path the changesets action switches the checkout to
 * `changeset-release/main` and bumps every manifest in it, so a working-tree
 * read there returns the NEXT version, which is deliberately unpublished. Pass
 * the pushed commit and the answer is about what `main` declares.
 *
 * Exit codes: 0 = finalized, or not published yet and so not this check's
 * business. 1 = published and unfinalized. 2 = the question could not be asked.
 *
 * Usage:
 *   node scripts/release/check-finalized.mjs             # HEAD
 *   node scripts/release/check-finalized.mjs <git-ref>   # a specific commit
 */

import { execFileSync } from "node:child_process";

import { REGISTRY, fetchRegistryState } from "./lib.mjs";

/** The package whose version names the release; every other one is in lockstep. */
export const ANCHOR_PACKAGE = "nextly";
const ANCHOR_MANIFEST = "packages/nextly/package.json";

/**
 * The version `main` declares, read out of git rather than off the disk.
 *
 * `git show <ref>:<path>` answers about the commit rather than about whatever
 * the workspace currently holds, which is the whole point here: the step that
 * would run this shares a checkout with an action that rewrites manifests.
 */
export function versionAtRef(ref, run = execFileSync) {
  const source = run("git", ["show", `${ref}:${ANCHOR_MANIFEST}`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const version = JSON.parse(source).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`${ANCHOR_MANIFEST} at ${ref} declares no version`);
  }
  return version;
}

/** The tag the release workflow creates for a version. */
export function tagFor(version) {
  return `v${version}`;
}

/**
 * Whether a tag exists on the remote, and what it points at.
 *
 * The peeled ref is asked for first so an annotated tag resolves to its commit
 * rather than to the tag object, which is what makes the comparison below about
 * the same kind of thing on both sides.
 */
export function remoteTagSha(tag, run = execFileSync) {
  const peeled = run("git", ["ls-remote", "origin", `refs/tags/${tag}^{}`], {
    encoding: "utf8",
  }).trim();
  if (peeled) return peeled.split(/\s+/)[0];

  const plain = run("git", ["ls-remote", "origin", `refs/tags/${tag}`], {
    encoding: "utf8",
  }).trim();
  return plain ? plain.split(/\s+/)[0] : undefined;
}

/**
 * Whether a GitHub Release exists for the tag.
 *
 * 🔴 Three answers, not two. A query that cannot run is not the same as a
 * release that is absent, and reporting the first as the second would fail a
 * correct repository whenever the token was missing or the API was down. The
 * caller reports what it could not establish rather than guessing.
 */
export function releaseState(tag, run = execFileSync) {
  try {
    run("gh", ["release", "view", tag, "--repo", "nextlyhq/nextly", "--json", "tagName"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "present";
  } catch (error) {
    // `gh` exits non-zero both for "no such release" and for "cannot ask".
    // Only the first is an answer about the release.
    const text = `${error.stderr ?? ""}${error.stdout ?? ""}`;
    if (/release not found|not found|HTTP 404/i.test(text)) return "absent";
    return "unknown";
  }
}

/** Whether the registry has the version at all. */
export async function isPublished(version, fetchState = fetchRegistryState) {
  const state = await fetchState(ANCHOR_PACKAGE);
  if (state === null) return false;
  return state.versions.includes(version);
}

/**
 * The verdict, as data, so the reporting and the exit code are decided in one
 * place and the rules can be exercised without a registry or a remote.
 */
export function verdict({ version, published, tagSha, release }) {
  if (!published) {
    return {
      code: 0,
      state: "unpublished",
      message:
        `${ANCHOR_PACKAGE}@${version} is not on the registry, so there is no ` +
        "finished release to describe yet. A publish in flight looks like this, " +
        "and so does a commit that precedes one.",
    };
  }

  const missing = [];
  if (!tagSha) missing.push(`the git tag ${tagFor(version)}`);
  if (release === "absent") missing.push(`the GitHub Release ${tagFor(version)}`);

  if (missing.length === 0) {
    return {
      code: 0,
      state: release === "unknown" ? "tagged" : "finalized",
      message:
        release === "unknown"
          ? `${ANCHOR_PACKAGE}@${version} is published and tagged. Whether a ` +
            "GitHub Release exists could not be established, so it is not " +
            "reported either way."
          : `${ANCHOR_PACKAGE}@${version} is published, tagged and released.`,
    };
  }

  return {
    code: 1,
    state: "unfinalized",
    missing,
    message:
      `${ANCHOR_PACKAGE}@${version} is on the registry and is missing ` +
      `${missing.join(" and ")}.`,
  };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-finalized.mjs");

if (invokedDirectly) {
  const ref = process.argv[2] || "HEAD";

  let version;
  try {
    version = versionAtRef(ref);
  } catch (error) {
    console.error(
      `check-finalized: could not read a version at ${ref}, so nothing could ` +
        `be judged: ${error.message}`
    );
    process.exit(2);
  }

  let published;
  try {
    published = await isPublished(version);
  } catch (error) {
    console.error(
      `check-finalized: ${REGISTRY} could not be asked about ` +
        `${ANCHOR_PACKAGE}@${version}, so whether it is released is unknown ` +
        `rather than false: ${error.message}`
    );
    process.exit(2);
  }

  const tag = tagFor(version);
  const result = verdict({
    version,
    published,
    tagSha: published ? remoteTagSha(tag) : undefined,
    release: published ? releaseState(tag) : "absent",
  });

  if (result.code === 0) {
    console.log(`check-finalized: ok - ${result.message}`);
    process.exit(0);
  }

  console.error(`check-finalized: FAILED\n\n  ${result.message}\n`);
  console.error(
    "  Publishing writes the packages; a later step writes the tag and the\n" +
      "  release. That step is skipped when verification fails, and a release\n" +
      "  left this way is invisible: npm serves it, git does not know it\n" +
      "  happened, and the releases page stops short of it.\n"
  );
  console.error(
    "  Repair it by re-running the release run that published this version:\n" +
      "\n      gh run list --workflow=release.yml --branch main\n" +
      "      gh run rerun <id> --failed\n" +
      "\n  A re-run checks out the commit that was published, so the tag lands on\n" +
      "  the right one. Publishing is resumable, so versions already on the\n" +
      "  registry are skipped rather than republished.\n"
  );
  process.exit(1);
}
