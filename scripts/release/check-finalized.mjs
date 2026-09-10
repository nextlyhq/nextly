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
 * 🔴 It reports; it never gates. `release-health.yml` runs it on a schedule and
 * after every release run, and files what it finds as an issue. A detector on
 * the release path itself can only fail closed, and closed here means nobody
 * can ship: it would report a stranded train and then block the
 * `gh run rerun --failed` that repairs it, because the re-run replays this same
 * check against the same state it just refused.
 *
 * ⚠️ THE VERSION COMES FROM A GIT REF, NEVER FROM THE WORKING TREE. `git show
 * <ref>:<path>` answers about a commit; reading the disk answers about whatever
 * the checkout currently holds, and the two agree only while nothing has
 * rewritten it. A ref keeps the answer pinned to what `main` declares even when
 * this runs beside something that bumps manifests.
 *
 * Exit codes: 0 = finalized, or not published yet and so not this check's
 * business. 1 = published and unfinalized. 2 = the question could not be asked.
 *
 * Usage:
 *   node scripts/release/check-finalized.mjs             # HEAD
 *   node scripts/release/check-finalized.mjs <git-ref>   # a specific commit
 */

import { execFileSync } from "node:child_process";

import { PLACEHOLDER_VERSION, REGISTRY, fetchRegistryState } from "./lib.mjs";

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
    /*
     * 🔴 Skipping a malformed PUBLIC manifest would shrink the question. The
     * package would drop out of the train, this check would never ask the
     * registry about it, and a release could be reported finished while that
     * package was never published. An unreadable manifest is a question that
     * cannot be asked, not a package that is not there.
     */
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
      throw new Error(
        `${path} at ${ref} is publishable but declares no usable name and ` +
          "version, so the release it belongs to cannot be graded."
      );
    }
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
/**
 * Whether a package has never shipped a real version, only the name-claiming
 * placeholder. Absent from the registry counts: an unclaimed name is further
 * from released, not closer.
 */
function neverReleased(state) {
  if (state === null) return true;
  return state.versions.every(version => version === PLACEHOLDER_VERSION);
}

/*
 * 🔴 A package awaiting its first publish is not a stranded one, and at the
 * registry the two look identical. `bootstrap-package.mjs` claims a name with a
 * `0.0.0` placeholder, and the PR that adds the package sets its manifest to
 * the CURRENT lockstep version rather than to `0.0.0`: `@nextlyhq/eslint-plugin`
 * was added declaring `0.0.2-alpha.58` and first published at `0.0.2-alpha.60`.
 * Every release in that window had one package `main` declared and npm did not
 * hold, which reads as a train stranded halfway. Counting it as missing reports
 * a healthy repository as broken for as long as it takes to ship the package.
 */
export async function publishState(manifest, fetchState = fetchRegistryState) {
  const states = await Promise.all(manifest.map(entry => fetchState(entry.name)));

  const missing = [];
  const pending = [];
  let published = 0;

  manifest.forEach((entry, index) => {
    const state = states[index];
    if (state !== null && state.versions.includes(entry.version)) {
      published += 1;
      return;
    }
    (neverReleased(state) ? pending : missing).push(entry.name);
  });

  // The train is the packages that have shipped before. One still waiting for
  // its first publish was not in the release being judged, so counting it in
  // the total would make a complete release read as incomplete.
  const total = manifest.length - pending.length;

  if (published === 0) return { kind: "none", published, total, pending };
  if (missing.length > 0) return { kind: "partial", published, total, missing, pending };
  return { kind: "all", published, total, pending };
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
    /*
     * 🔴 `isDraft`, not just existence. A draft is saved and not published:
     * `gh release view` finds it for anyone with write access and nobody else
     * can see it, so a train whose release was left in draft would be reported
     * as described when the page it is described on does not exist for a
     * reader. That is the same invisibility this check was written for.
     */
    const out = run(
      "gh",
      ["release", "view", tag, "--repo", "nextlyhq/nextly", "--json", "tagName,isDraft"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return JSON.parse(out).isDraft === true ? "draft" : "present";
  } catch (error) {
    // `gh` exits non-zero both for "no such release" and for "cannot ask".
    // Only the first is an answer about the release.
    const text = `${error.stderr ?? ""}${error.stdout ?? ""}`;
    if (/release not found|not found|HTTP 404/i.test(text)) return "absent";
    return "unknown";
  }
}

/**
 * A sentence naming the packages this verdict could not speak for, or nothing.
 *
 * Said out loud rather than left implicit: a reader who is told a release is
 * finished should know it was graded over nineteen packages and not twenty.
 */
function pendingNote(pending) {
  if (!pending || pending.length === 0) return "";
  const names = pending.join(", ");
  return (
    ` ${names} ${pending.length === 1 ? "is" : "are"} not counted: ` +
    `${pending.length === 1 ? "it has" : "they have"} never published a real ` +
    "version, so no earlier release contained " +
    `${pending.length === 1 ? "it" : "them"}.`
  );
}

/**
 * The verdict, as data, so the reporting and the exit code are decided in one
 * place and the rules can be exercised without a registry or a remote.
 *
 * `tagVersion` describes the version the TAGGED COMMIT declares, and has the
 * same three-way shape as `tag` and `release` for the same reason: `{ kind:
 * "known", version }` when the tagged commit could be read, `{ kind: "unknown" }`
 * when it could not, and absent when there is no tag to ask about. A known
 * mismatch means a tag pushed at an unrelated commit and is reported; an
 * unknown one is reported as unknown rather than waved through.
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
        "and so does a commit that precedes one." +
        pendingNote(publish.pending),
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
        `${publish.missing.length === 1 ? "is" : "are"} still missing.` +
        pendingNote(publish.pending),
      remedy: "rerun",
    };
  }

  // Everything below is about a train that is fully live.
  const missing = [];
  if (tag.kind === "absent") missing.push(`the git tag ${tagFor(version)}`);
  /*
   * A draft counts as missing. It exists for anyone with write access and for
   * nobody else, so the release is described on a page a reader cannot open,
   * which is the invisibility this check exists for rather than an exception
   * to it.
   */
  if (release === "absent" || release === "draft") {
    missing.push(
      release === "draft"
        ? `a published GitHub Release ${tagFor(version)} (it exists as a draft)`
        : `the GitHub Release ${tagFor(version)}`
    );
  }

  /*
   * 🔴 Anything that is not explicitly a known version is unknown. `verdict` is
   * exported and untyped, so a caller that omits `tagVersion`, or passes the
   * bare string an earlier shape used, must not fall through to `finalized`:
   * that is a tag whose target was never established being reported as one
   * that was.
   */
  const tagVersionKnown =
    tagVersion?.kind === "known" && typeof tagVersion.version === "string";

  if (tag.kind === "present" && tagVersionKnown && tagVersion.version !== version) {
    return {
      code: 1,
      state: "mistagged",
      message:
        `${tagFor(version)} points at a commit that declares ` +
        `${tagVersion.version}, not ${version}, so the tag does not identify ` +
        "this release.",
      /*
       * 🔴 Moving a tag does not create a GitHub Release. `release.yml` writes
       * one only on a run of its own, so when the release is missing as well,
       * retagging alone leaves this failing and the next scheduled check
       * reports the same state again.
       */
      remedy:
        release === "present"
          ? "retag"
          : release === "unknown"
            ? "retag-then-check-release"
            : "retag-then-rerun",
    };
  }

  if (missing.length === 0) {
    /*
     * 🔴 An unanswered question is not a clean bill of health. Reporting one as
     * `finalized` is how a network blip, an expired token or a tag whose target
     * cannot be read would each close this check with the release still broken.
     * Exit 2 is what this file reserves for a question it could not ask, and
     * that is what these are.
     */
    const unknowns = [];
    if (tag.kind === "unknown") unknowns.push("whether the git tag exists");
    if (release === "unknown") unknowns.push("whether the GitHub Release exists");
    if (tag.kind === "present" && !tagVersionKnown) {
      unknowns.push(`which version ${tagFor(version)} points at`);
    }

    if (unknowns.length > 0) {
      return {
        code: 2,
        state: "unknown",
        message:
          `${ANCHOR_PACKAGE}@${version} is published, but ` +
          `${unknowns.join(" and ")} could not be established, so whether the ` +
          "release is finished is unknown rather than confirmed.",
      };
    }

    return {
      code: 0,
      state: "finalized",
      message:
        `${ANCHOR_PACKAGE}@${version} is published, tagged and released.` +
        pendingNote(publish.pending),
    };
  }

  return {
    code: 1,
    state: "unfinalized",
    missing,
    message:
      `${ANCHOR_PACKAGE}@${version} is on the registry and is missing ` +
      `${missing.join(" and ")}.` +
      pendingNote(publish.pending),
    /*
     * 🔴 The remedy depends on WHICH artifact is missing, because re-running is
     * not always one. `release.yml` skips its whole tag-and-release branch when
     * `gh release view` succeeds, so a re-run repairs nothing when the release
     * exists and only the tag is gone: it prints "already exists; nothing to
     * finalize" and goes green while this keeps failing.
     */
    /*
     * 🔴 The remedy depends on WHICH artifact is missing, because re-running is
     * not always one. `release.yml` skips its whole tag-and-release branch when
     * `gh release view` succeeds, and a DRAFT satisfies that too, so a re-run
     * repairs neither a present release with a missing tag nor a draft: it
     * prints "already exists; nothing to finalize" and goes green while this
     * keeps failing.
     */
    remedy:
      release === "present"
        ? "tag-only"
        : release === "draft"
          ? "publish-draft"
          : release === "unknown"
            ? "check-release-first"
            : "rerun",
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

  if (result.remedy === "check-release-first") {
    return [
      "  The GitHub Release could not be read, and the two possible answers",
      "  need opposite remedies, so establish which one is true first:",
      "",
      `      gh release view ${tag} --repo nextlyhq/nextly`,
      "",
      "  If it EXISTS, re-running repairs nothing: the release workflow finds",
      "  the release, reports nothing to finalize, and skips the branch that",
      "  pushes the tag. Push the tag at the commit that introduced this",
      "  version instead:",
      "",
      `      git tag -a ${tag} <commit> -m "${tag}"`,
      `      git push origin refs/tags/${tag}`,
      "",
      "  If it does NOT exist, re-run the release run that published this",
      "  version and both artifacts are created together:",
      "",
      "      gh run rerun <id> --failed",
      "",
    ].join("\n");
  }

  if (result.remedy === "publish-draft") {
    return [
      "  The GitHub Release exists as a DRAFT, so re-running repairs nothing:",
      "  `gh release view` finds a draft, and the release workflow then reports",
      "  nothing to finalize. Publish it:",
      "",
      `      gh release edit ${tag} --repo nextlyhq/nextly --draft=false`,
      "",
    ].join("\n");
  }

  if (result.remedy === "retag-then-check-release") {
    return [
      "  The tag names a different release, and whether the GitHub Release",
      "  exists could not be established, so fix the tag first and then find",
      "  out which of the two remaining cases you are in:",
      "",
      `      git push origin :refs/tags/${tag}`,
      `      git tag -a ${tag} <commit> -m "${tag}"`,
      `      git push origin refs/tags/${tag}`,
      `      gh release view ${tag} --repo nextlyhq/nextly`,
      "",
      "  If the release EXISTS, the tag was the only thing wrong and you are",
      "  done. If it does not, re-run the release run that published this",
      "  version so CI creates it:",
      "",
      "      gh run rerun <id> --failed",
      "",
    ].join("\n");
  }

  if (result.remedy === "retag-then-rerun") {
    return [
      "  Two things are wrong: the tag names a different release, and the",
      "  GitHub Release is missing. Move the tag first, deliberately, after",
      "  checking which commit the packages were built from:",
      "",
      `      git push origin :refs/tags/${tag}`,
      `      git tag -a ${tag} <commit> -m "${tag}"`,
      `      git push origin refs/tags/${tag}`,
      "",
      "  Then re-run the release, because moving a tag does not create a",
      "  GitHub Release and nothing else will:",
      "",
      "      gh run rerun <id> --failed",
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

  // Only asked when there is a tag to ask about. A target that cannot be read
  // is an unanswered question rather than a matching version, and the three-way
  // shape is what carries that distinction to `verdict` instead of losing it.
  let tagVersion;
  if (tag.kind === "present") {
    try {
      tagVersion = { kind: "known", version: versionAtRef(tag.sha) };
    } catch {
      tagVersion = { kind: "unknown" };
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

  // Kept apart from a failure so a caller can act on the difference. An
  // unreachable registry or remote should not file a release-integrity report
  // that a human then has to close by hand.
  if (result.code === 2) {
    console.error(`check-finalized: UNKNOWN\n\n  ${result.message}\n`);
    process.exit(2);
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
