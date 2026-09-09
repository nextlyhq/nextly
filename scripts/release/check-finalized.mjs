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
 * Every publishable package the ref declares, read out of git.
 *
 * 🔴 The anchor package alone is not the release. `changeset publish` pushes
 * packages one at a time and is not atomic, so a run can leave some live and
 * others not. Asking only about `nextly` reports "nothing published yet" for a
 * train that stranded halfway, which is the same lingering state this exists to
 * surface.
 */
export function manifestAtRef(ref, run = execFileSync) {
  const listed = run("git", ["ls-tree", "-r", "--name-only", ref, "--", "packages"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  const manifest = [];
  for (const path of listed.split("\n")) {
    if (!/^packages\/[^/]+\/package\.json$/.test(path)) continue;
    const pkg = JSON.parse(
      run("git", ["show", `${ref}:${path}`], { encoding: "utf8" })
    );
    if (pkg.private === true) continue;
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
    manifest.push({ name: pkg.name, version: pkg.version });
  }
  return manifest;
}

/**
 * How much of the train reached the registry: none, some, or all.
 *
 * "Some" is its own answer rather than a shade of the other two, because it
 * needs a different response: nothing to do yet, finish the release, or repair
 * a partial one.
 */
export async function publishState(manifest, fetchState = fetchRegistryState) {
  const live = await Promise.all(
    manifest.map(async entry => {
      const state = await fetchState(entry.name);
      return state !== null && state.versions.includes(entry.version);
    })
  );

  const missing = manifest.filter((_, index) => !live[index]).map(e => e.name);
  const published = manifest.length - missing.length;

  if (published === 0) return { kind: "none", published, total: manifest.length };
  if (missing.length > 0)
    return { kind: "partial", published, total: manifest.length, missing };
  return { kind: "all", published, total: manifest.length };
}

/**
 * Whether a tag exists on the remote, and what it points at.
 *
 * The peeled ref is asked for first so an annotated tag resolves to its commit
 * rather than to the tag object, which is what makes the comparison below about
 * the same kind of thing on both sides.
 */
export function remoteTagState(tag, run = execFileSync) {
  /*
   * 🔴 An unreachable remote is not a missing tag. Letting `execFileSync` throw
   * here ended the process with a stack trace and exit 1, which this file's own
   * contract reserves for "published and unfinalized" - so a network blip read
   * as a release-integrity failure. The registry and the GitHub Release queries
   * already separate the two; this one does now as well.
   */
  const lookup = ref => {
    try {
      return run("git", ["ls-remote", "origin", ref], { encoding: "utf8" }).trim();
    } catch {
      return undefined;
    }
  };

  // Peeled first, so an annotated tag resolves to its commit rather than to the
  // tag object, which is what makes the comparison below like-for-like.
  const peeled = lookup(`refs/tags/${tag}^{}`);
  if (peeled === undefined) return { kind: "unknown" };
  if (peeled) return { kind: "present", sha: peeled.split(/\s+/)[0] };

  const plain = lookup(`refs/tags/${tag}`);
  if (plain === undefined) return { kind: "unknown" };
  if (plain) return { kind: "present", sha: plain.split(/\s+/)[0] };
  return { kind: "absent" };
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
 *
 * `tagVersion` is the version the TAGGED COMMIT declares. It is what turns "a
 * tag by that name exists" into something about the release: a tag pushed at an
 * unrelated commit declares a different version and is reported.
 *
 * ⚠️ The boundary, stated rather than covered badly. Several commits declare one
 * version - every commit between a version bump and the next - so this proves
 * the tag sits on a commit that declares this release, not that it sits on the
 * exact commit whose artifacts were published. Establishing that would mean
 * identifying the publishing commit from history, which is a guess this refuses
 * to make when the consequence is failing a correct repository.
 */
export function verdict({ version, publish, tag, tagVersion, release }) {
  if (publish.kind === "none") {
    return {
      code: 0,
      state: "unpublished",
      message:
        `${ANCHOR_PACKAGE}@${version} is not on the registry, so there is no ` +
        "finished release to describe yet. A publish in flight looks like this, " +
        "and so does a commit that precedes one.",
    };
  }

  if (publish.kind === "partial") {
    return {
      code: 1,
      state: "partial",
      missing: publish.missing,
      message:
        `Only ${publish.published} of ${publish.total} packages reached the ` +
        `registry at ${version}. Publishing is not atomic, so a run can strand ` +
        `a train halfway: ${publish.missing.join(", ")} ` +
        `${publish.missing.length === 1 ? "is" : "are"} still missing.`,
      remedy: "rerun",
    };
  }

  // Everything below is about a train that is fully live.
  const missing = [];
  if (tag.kind === "absent") missing.push(`the git tag ${tagFor(version)}`);
  if (release === "absent") missing.push(`the GitHub Release ${tagFor(version)}`);

  if (tag.kind === "present" && tagVersion && tagVersion !== version) {
    return {
      code: 1,
      state: "mistagged",
      message:
        `${tagFor(version)} points at a commit that declares ${tagVersion}, ` +
        `not ${version}, so the tag does not identify this release.`,
      remedy: "retag",
    };
  }

  if (missing.length === 0) {
    const unknowns = [];
    if (tag.kind === "unknown") unknowns.push("the git tag");
    if (release === "unknown") unknowns.push("the GitHub Release");

    return {
      code: 0,
      state: unknowns.length > 0 ? "partly-unknown" : "finalized",
      message:
        unknowns.length > 0
          ? `${ANCHOR_PACKAGE}@${version} is published. Whether ` +
            `${unknowns.join(" and ")} exists could not be established, so it ` +
            "is not reported either way."
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
    /*
     * 🔴 The remedy depends on WHICH artifact is missing, because re-running is
     * not always one. `release.yml` skips its whole tag-and-release branch when
     * `gh release view` succeeds, so a re-run repairs nothing when the release
     * exists and only the tag is gone: it prints "already exists; nothing to
     * finalize" and goes green while this keeps failing.
     */
    remedy: release === "present" ? "tag-only" : "rerun",
  };
}

/** What to tell a reader to do about a verdict, kept beside the rules it follows. */
export function remedyFor(result, version) {
  const tag = tagFor(version);

  if (result.remedy === "tag-only") {
    return [
      "  The GitHub Release exists and only the tag is gone, so re-running the",
      "  release does NOT repair this: it sees the release, reports nothing to",
      "  finalize, and skips the branch that pushes the tag.",
      "",
      "  Push the tag at the commit the packages were built from, which is the",
      `  commit that introduced ${version}:`,
      "",
      `      git tag -a ${tag} <commit> -m "${tag}"`,
      `      git push origin refs/tags/${tag}`,
      "",
    ].join("\n");
  }

  if (result.remedy === "retag") {
    return [
      "  Move the tag deliberately rather than re-running anything, and check",
      "  which commit the packages were built from before deleting a published",
      "  tag:",
      "",
      `      git push origin :refs/tags/${tag}`,
      `      git tag -a ${tag} <commit> -m "${tag}"`,
      `      git push origin refs/tags/${tag}`,
      "",
    ].join("\n");
  }

  return [
    "  Re-run the release run that published this version:",
    "",
    "      gh run list --workflow=release.yml --branch main",
    "      gh run rerun <id> --failed",
    "",
    "  A re-run checks out the commit that was published, so the tag lands on",
    "  the right one. Publishing is resumable, so versions already on the",
    "  registry are skipped rather than republished.",
    "",
  ].join("\n");
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-finalized.mjs");

if (invokedDirectly) {
  const ref = process.argv[2] || "HEAD";

  let version;
  let manifest;
  try {
    version = versionAtRef(ref);
    manifest = manifestAtRef(ref);
  } catch (error) {
    console.error(
      `check-finalized: could not read the release ${ref} declares, so nothing ` +
        `could be judged: ${error.message}`
    );
    process.exit(2);
  }

  if (manifest.length === 0) {
    console.error(
      `check-finalized: ${ref} declares no publishable packages, which would ` +
        "make every release vacuously finished rather than actually finished."
    );
    process.exit(2);
  }

  let publish;
  try {
    publish = await publishState(manifest);
  } catch (error) {
    console.error(
      `check-finalized: ${REGISTRY} could not be asked about this release, so ` +
        `whether it shipped is unknown rather than false: ${error.message}`
    );
    process.exit(2);
  }

  const tag = publish.kind === "all" ? remoteTagState(tagFor(version)) : { kind: "absent" };

  // Only asked when there is a tag to ask about, and failure to read it leaves
  // the version undefined rather than wrong, which `verdict` treats as nothing
  // to report rather than as a mismatch.
  let tagVersion;
  if (tag.kind === "present") {
    try {
      tagVersion = versionAtRef(tag.sha);
    } catch {
      tagVersion = undefined;
    }
  }

  const result = verdict({
    version,
    publish,
    tag,
    tagVersion,
    release: publish.kind === "all" ? releaseState(tagFor(version)) : "absent",
  });

  if (result.code === 0) {
    console.log(`check-finalized: ok - ${result.message}`);
    process.exit(0);
  }

  console.error(`check-finalized: FAILED\n\n  ${result.message}\n`);
  console.error(
    "  A release is three facts: the packages are on the registry, a git tag\n" +
      "  points at the commit they were built from, and a GitHub Release\n" +
      "  describes it. Publishing writes the first; a later step writes the\n" +
      "  other two, and it is skipped when verification fails. A release left\n" +
      "  that way is invisible: npm serves it, git does not know it happened.\n"
  );
  console.error(remedyFor(result, version));
  process.exit(1);
}
