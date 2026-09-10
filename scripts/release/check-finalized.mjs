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

import {
  REGISTRY,
  fetchAllRegistryStates,
  fetchRegistryState,
  getExpectedDistTag,
  isBootstrapPlaceholderOnly,
  readPreMode,
  readPreState,
  waitForCompleteRelease,
} from "./lib.mjs";

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

/**
 * Packages whose version the registry has not served YET, which is the only
 * thing waiting can fix.
 *
 * 🔴 Narrower than `collectProblems` on purpose. That predicate decides whether
 * to FINALIZE, so it is right for it to refuse a stale dist-tag and a package
 * that never published. This one decides whether to keep WAITING, and neither
 * of those clears with time: a tag nobody moved stays unmoved, and a package
 * awaiting its first publish never appears. Using the strict predicate here
 * spends the whole budget every run during a prerelease exit or while a
 * bootstrapped package is pending, and then reports the same verdict it would
 * have reported immediately.
 */
export function unsettledPackages(manifest, registry) {
  return manifest
    .filter(entry => {
      const state = registry.get(entry.name) ?? null;
      // Never published is not "not yet": there is nothing on its way.
      if (neverReleased(state)) return false;
      return !state.versions.includes(entry.version);
    })
    .map(entry => ({
      name: entry.name,
      reason: `version ${entry.version} not readable yet`,
    }));
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

  /*
   * 🔴 A train is ONE version. Changesets bumps every publishable package
   * through its `fixed` group, so a package left behind means the ref declares
   * no single release at all. Without this the drifted package is simply asked
   * about at its own version: if that version and its channel tag happen to
   * exist on npm, every check passes and a repository that never cut this
   * release is reported finalized.
   */
  const anchor = manifest.find(entry => entry.name === ANCHOR_PACKAGE);
  if (anchor) {
    const drifted = manifest.filter(entry => entry.version !== anchor.version);
    if (drifted.length > 0) {
      throw new Error(
        `${ref} declares no single release: ${ANCHOR_PACKAGE} is at ` +
          `${anchor.version} while ` +
          drifted.map(e => `${e.name} is at ${e.version}`).join(", ") +
          ". Every publishable package versions in lockstep."
      );
    }
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
 * Whether a package has never shipped a real version.
 *
 * Three ways to have nothing: absent from the registry, present with no
 * versions at all, or carrying only the name-claiming placeholder. The last is
 * `isBootstrapPlaceholderOnly` rather than a second copy of the same rule,
 * which also answers `false` for an absent package because "placeholder only"
 * and "not there" are different facts to its own callers.
 */
function neverReleased(state) {
  if (state === null) return true;
  if ((state.versions ?? []).length === 0) return true;
  return isBootstrapPlaceholderOnly(state);
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
export async function publishState(
  manifest,
  fetchState = fetchRegistryState,
  preState = readPreState(),
  { assertChannel = true } = {}
) {
  const states = await Promise.all(manifest.map(entry => fetchState(entry.name)));

  const pending = [];
  const missing = [];
  const channelStale = [];
  let published = 0;
  let total = 0;

  manifest.forEach((entry, index) => {
    const state = states[index] ?? null;
    if (neverReleased(state)) {
      pending.push(entry.name);
      return;
    }
    total += 1;

    if (!state.versions.includes(entry.version)) {
      missing.push(entry.name);
      return;
    }
    published += 1;

    /*
     * 🔴 Being on the registry is not the same as being installable. The
     * channel tag is what `npm install <pkg>@alpha` resolves, and `verify.mjs`
     * withholds finalization when it does not point at the release, so a check
     * that ignored it would call a release healthy that verification refuses.
     * `getExpectedDistTag` is the shared rule rather than a second one.
     *
     * ⚠️ Kept SEPARATE from `missing` rather than folded into it, because the
     * two are different facts with different remedies and different lifetimes.
     * A version is on the registry forever; a channel tag legitimately moves on
     * to the next release. Folding them together made a superseded release read
     * as "not on the registry", which is false, and sent the reader to a
     * re-run when the fix is one `npm dist-tag add`.
     */
    /*
     * 🔴 Only for the release `main` declares NOW. A channel tag is a
     * present-time fact: `alpha` legitimately advances from alpha.64 to
     * alpha.65, so a correctly finished older release fails this comparison for
     * the very reason it is supposed to. Judging one anyway produced a remedy
     * telling the maintainer to move consumers BACK to the old version, which
     * is worse than saying nothing. The caller decides, because only it knows
     * whether the ref it was handed is the current train.
     */
    if (!assertChannel) return;

    const tag = getExpectedDistTag(state, preState);
    const actual = state.distTags?.[tag];
    if (actual !== entry.version) {
      channelStale.push(
        `${entry.name} (${tag} resolves to ${actual ?? "nothing"})`
      );
    }
  });

  const shape = { published, total, pending, channelStale };
  if (published === 0) return { kind: "none", ...shape };
  if (missing.length > 0) return { kind: "partial", missing, ...shape };
  return { kind: "all", ...shape };
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
    run(
      "gh",
      ["release", "view", tag, "--repo", "nextlyhq/nextly", "--json", "tagName"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return "present";
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
    /*
     * 🔴 A stale channel tag survives a re-run. Publishing skips versions the
     * registry already has, so a package whose version is live but whose tag
     * never moved is untouched by the recovery this branch prescribes: the
     * re-run publishes the genuinely missing package and then fails
     * verification again on the same tag. Both defects are reported, in the
     * order they have to be repaired.
     */
    const stale = publish.channelStale ?? [];
    return {
      code: 1,
      state: "partial",
      missing: publish.missing,
      steps: stale.length > 0 ? ["move-dist-tag", "rerun"] : ["rerun"],
      message:
        `Only ${publish.published} of ${publish.total} packages reached the ` +
        `registry at ${version}. Publishing is not atomic, so a run can strand ` +
        `a train halfway: ${publish.missing.join(", ")} ` +
        `${publish.missing.length === 1 ? "is" : "are"} still missing.` +
        (stale.length > 0
          ? ` The channel tag also does not resolve to it for: ${stale.join(", ")}.`
          : "") +
        pendingNote(publish.pending),
    };
  }

  /*
   * 🔴 Defects are COLLECTED, never selected. A chain that returns the first
   * one it finds names a single fix for a release that needs several: the
   * maintainer follows it, the check still fails, and they come back for the
   * next. Naming the combinations instead is worse, and is what was here: the
   * states are a PRODUCT of three axes (the channel tag, the git tag, the
   * GitHub Release), so ten hand-written names covered forty cells and every
   * round of review found another pair nobody had written down.
   */
  const steps = [];
  const missing = [];

  const channelStale = publish.channelStale ?? [];
  if (channelStale.length > 0) {
    missing.push(`a channel tag that resolves to ${version}`);
    steps.push("move-dist-tag");
  }

  if (tag.kind === "absent") missing.push(`the git tag ${tagFor(version)}`);

  /*
   * 🔴 Anything that is not explicitly a known version is unknown. `verdict` is
   * exported and untyped, so a caller that omits `tagVersion`, or passes the
   * bare string an earlier shape used, must not fall through to `finalized`:
   * that is a tag whose target was never established being reported as one
   * that was.
   */
  const tagVersionKnown =
    tagVersion?.kind === "known" && typeof tagVersion.version === "string";
  /*
   * 🔴 Two ways the tag is unestablished, and both must stop the same things.
   * `tag.kind === "unknown"` means `git ls-remote` could not answer at all, so
   * nobody knows whether a tag exists or what it names; `present` with an
   * unreadable target means it exists and nobody knows what it names. Acting on
   * the GitHub Release from either state edits or publishes a release whose git
   * tag was never established.
   */
  const tagUnestablished =
    tag.kind === "unknown" || (tag.kind === "present" && !tagVersionKnown);
  const tagTargetUnknown = tag.kind === "present" && !tagVersionKnown;
  const mistagged =
    tag.kind === "present" && tagVersionKnown && tagVersion.version !== version;

  if (mistagged) {
    missing.push(
      `a git tag that identifies ${version} (${tagFor(version)} points at a ` +
        `commit declaring ${tagVersion.version})`
    );
  }

  if (release === "absent") missing.push(`the GitHub Release ${tagFor(version)}`);

  // The tag, before anything that edits or publishes the release.
  if (tagTargetUnknown) steps.push("establish-tag-target");
  else if (tag.kind === "unknown") steps.push("establish-tag-existence");
  else if (tag.kind === "absent") steps.push("push-tag");
  else if (mistagged) steps.push("retag");

  /*
   * 🔴 Nothing that edits or publishes the GitHub Release runs while the tag's
   * target is unknown. Publishing a draft makes it public, and a release whose
   * tag nobody could read may be announcing a commit that was never shipped.
   * Establishing the target is a precondition, not a parallel repair.
   */
  if (!tagUnestablished) {
    if (release === "absent") steps.push("rerun");
    else if (release === "unknown") steps.push("check-release");
  }

  /*
   * 🔴 An unanswered question is not a clean bill of health. Reporting one as
   * `finalized` is how a network blip, an expired token or a tag whose target
   * cannot be read would each close this check with the release still broken.
   * Exit 2 is what this file reserves for a question it could not ask.
   *
   * ⚠️ Only when nothing else was ESTABLISHED, though. A release with a real
   * defect and an unanswered question beside it is still a broken release, and
   * returning 2 there would file it as a transient blip and drop the defect on
   * the floor. The unknown is reported alongside the defect instead, and the
   * steps stop short of anything that would act on the part nobody could read.
   */
  const unknowns = [];
  if (tag.kind === "unknown") unknowns.push("whether the git tag exists");
  if (release === "unknown") unknowns.push("whether the GitHub Release exists");
  if (tagTargetUnknown) {
    unknowns.push(`which version ${tagFor(version)} points at`);
  }

  if (missing.length === 0) {
    if (unknowns.length > 0) {
      return {
        code: 2,
        state: "unknown",
        steps,
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

  /*
   * The most severe defect names the state, because a caller renders it as one
   * issue title. The message carries all of them.
   */
  const state =
    channelStale.length > 0 ? "channel-stale" : mistagged ? "mistagged" : "unfinalized";

  return {
    code: 1,
    state,
    missing,
    steps,
    message:
      `${ANCHOR_PACKAGE}@${version} is on the registry and is missing ` +
      `${missing.join(", and ")}.` +
      (channelStale.length > 0
        ? ` The channel tag does not resolve to it, so an install still serves ` +
          `the previous release: ${channelStale.join(", ")}.`
        : "") +
      (unknowns.length > 0
        ? ` ${unknowns.join(" and ")} could not be established, so nothing here acts on that.`
        : "") +
      pendingNote(publish.pending),
  };
}

/**
 * How to re-run a release run, and which form to use.
 *
 * 🔴 `--failed` re-runs only the jobs that FAILED. When a release run went
 * green and its GitHub Release was deleted afterwards, there are none, so
 * `--failed` re-runs nothing at all and reports success. The finalization steps
 * are idempotent, so the whole-job form is always safe and is the one to reach
 * for whenever the run is not red.
 */
const RERUN_STEPS = [
  "      gh run list --workflow=release.yml --branch main",
  "      gh run rerun <id> --failed      # if that run went red",
  "      gh run rerun <id>               # if it went green (nothing failed to re-run)",
];

/**
 * Put a tag on a chosen commit and push it.
 *
 * 🔴 `-f`, because plain `git tag -a` ABORTS with "tag already exists" when the
 * clone already has it, and having fetched the bad tag is the normal state for
 * anyone here to fix one. Reproduced: the plain form fails after the remote tag
 * has already been deleted, which leaves the release with no tag at all and the
 * maintainer mid-recovery.
 */
const tagSteps = (tag) => [
  `      git tag -f -a ${tag} <commit> -m "${tag}"`,
  `      git push origin refs/tags/${tag}`,
];

/** Move a tag that names the wrong release. The remote copy goes first. */
const retagSteps = (tag) => [
  `      git push origin :refs/tags/${tag}`,
  ...tagSteps(tag),
];


/**
 * One repair step, as the lines a maintainer reads.
 *
 * Keyed by defect rather than by combination: a release needing three of these
 * gets three of them, in order, and a defect nobody has paired with another
 * still renders. That is what the combination names could not do.
 */
const STEP_TEXT = {
  "move-dist-tag": (tag, version) => [
    "The packages are published; the channel tag was never moved to them, so",
    "an install still serves the previous release. Re-running does NOT fix",
    "this and fails the same check, because publishing skips versions the",
    "registry already has:",
    "",
    `    npm dist-tag add <package>@${version} <tag>`,
    "",
    "`scripts/release/manifest.mjs` lists every publishable package.",
  ],
  "establish-tag-target": (tag) => [
    `${tag} exists but the commit it points at could not be read, so nothing`,
    "below should be acted on yet: publishing or editing the release would",
    "announce a commit nobody has established. Find out what it names first:",
    "",
    `    git fetch origin refs/tags/${tag}`,
    `    git show ${tag}:packages/nextly/package.json`,
  ],
  "push-tag": (tag, version) => [
    "The tag is gone. Re-running does NOT restore it when a GitHub Release",
    "exists: the release workflow sees the release, reports nothing to",
    "finalize, and skips the branch that pushes the tag. Push it at the commit",
    `that introduced ${version}:`,
    "",
    ...tagSteps(tag).map((line) => line.trim().padStart(line.trim().length + 4)),
  ],
  retag: (tag) => [
    "The tag names a different release. Move it deliberately, after checking",
    "which commit the packages were built from:",
    "",
    ...retagSteps(tag).map((line) => line.trim().padStart(line.trim().length + 4)),
  ],
  rerun: () => [
    "The GitHub Release is missing. Re-run the release run that published this",
    "version: it checks out the commit that was published, and publishing is",
    "resumable, so versions already on the registry are skipped.",
    "",
    ...RERUN_STEPS.map((line) => line.trim().padStart(line.trim().length + 4)),
  ],
  "establish-tag-existence": (tag) => [
    "The remote could not be asked whether the tag exists, so nothing below",
    "should be acted on yet: editing or publishing the release would act on a",
    "version whose tag nobody has established. Ask again first:",
    "",
    `    git ls-remote origin refs/tags/${tag}`,
  ],
  "check-release": (tag) => [
    "The GitHub Release could not be read, and the two possible answers need",
    "opposite remedies, so establish which one is true first:",
    "",
    `    gh release view ${tag} --repo nextlyhq/nextly`,
    "",
    "If it EXISTS, there is nothing more to do about the release: any other",
    "step above is the whole repair. Re-running would not help, because the",
    "workflow finds the release and reports nothing to finalize.",
    "",
    "If it does NOT exist, re-run and it is created:",
    "",
    ...RERUN_STEPS.map((line) => line.trim().padStart(line.trim().length + 4)),
  ],
};

/**
 * Whether the channel tag should be asserted for this subject.
 *
 * 🔴 Two situations answer "no", and they are easy to collapse into one.
 *
 * A HISTORICAL subject is not the release `main` declares now, so today's
 * channel tag has moved past it and was never meant to point at it.
 *
 * A repository EXITING prerelease mode is mid-transition: `pre.json` says
 * `mode: "exit"` from the exit commit until the Version PR lands, and the
 * manifests still declare the last alpha for that whole window. `readPreState`
 * answers null there, exactly as it does when the repository was never in pre
 * mode, so the expected tag comes out as `latest`. Asserting it yields a remedy
 * that says to move `latest` onto a prerelease, serving an alpha to every
 * stable install.
 *
 * Exported because the command-line block below has no test, and a rule that
 * lives only inside it is a rule nothing can exercise.
 */
export function shouldAssertChannel(currentTrain, preMode) {
  return currentTrain && preMode !== "exit";
}

/**
 * What to tell a reader to do about a verdict, kept beside the rules it follows.
 *
 * Composed from the steps the verdict collected, numbered when there is more
 * than one, so a release with three defects gets three instructions in the
 * order they have to be performed rather than the first one that matched.
 */
export function remedyFor(result, version) {
  const tag = tagFor(version);
  const steps = result.steps ?? [];
  if (steps.length === 0) return "";

  const lines = [];
  steps.forEach((step, index) => {
    const body = STEP_TEXT[step](tag, version);
    const label = steps.length > 1 ? `${index + 1}. ` : "";
    lines.push(`  ${label}${body[0]}`);
    for (const line of body.slice(1)) {
      lines.push(line === "" ? "" : `  ${steps.length > 1 ? "   " : ""}${line}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/*
 * Four minutes. The measured worst case for a package becoming readable after a
 * publish is 186 seconds, so this covers it with margin, and it leaves room
 * inside the health job's ten-minute timeout for the install that precedes it.
 * The release path's own budget is longer because failing there withholds a
 * release; failing here only delays a report.
 */
const SETTLE_BUDGET_MS = 4 * 60 * 1000;

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

  /*
   * 🔴 Is this the release `main` declares NOW? Only that one can be judged by
   * a channel tag, which moves on with every release. The workflow hands this
   * the commit a finished Release run used, which is usually but not always the
   * current train: a manual re-run of an older run is exactly the case that is
   * finished correctly and would fail a present-time comparison.
   *
   * Read from the checkout rather than passed in, because the checkout IS the
   * default branch: the workflow deliberately runs the current checker against
   * whatever subject it was given.
   */
  let currentTrain = true;
  try {
    currentTrain = versionAtRef("HEAD") === version;
  } catch {
    // Unreadable HEAD is not a reason to refuse; it only costs the channel
    // assertion, which is the narrowest of the checks here.
    currentTrain = false;
  }

  let publish;
  try {
    /*
     * 🔴 One fetch is not an answer right after a release. npm accepts the
     * tarballs before the packument serves them, measured at up to 186 seconds
     * for the last package of a train, and this runs on the heels of the
     * Release workflow. A single read there sees the PREVIOUS state, every
     * package looks unpublished, and `verdict` exits 0 as "nothing to describe
     * yet" while finalization never happened: the silent failure this whole
     * check exists to end.
     *
     * `waitForCompleteRelease` is the same settle the release path uses, with a
     * budget sized for this caller: long enough to cover the measured 186s,
     * short enough that a genuinely stranded release still reports inside the
     * job's own timeout.
     */
    /*
     * 🔴 Only for the CURRENT train. `waitForCompleteRelease` is complete when
     * `collectProblems` is satisfied, and that compares the manifest against
     * TODAY'S dist-tags. For an older release those tags have moved on and can
     * never move back, so the wait can never succeed: it burns the whole budget
     * every time, on a question the channel assertion below is already going to
     * skip. A historical subject reads the registry once.
     */
    const registry = currentTrain
      ? (
          await waitForCompleteRelease({
            manifest,
            preState: readPreState(),
            fetchStates: fetchAllRegistryStates,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            now: () => Date.now(),
            budgetMs: SETTLE_BUDGET_MS,
            problemsFor: unsettledPackages,
          })
        ).registry
      : await fetchAllRegistryStates(manifest);
    publish = await publishState(
      manifest,
      (name) => registry.get(name) ?? null,
      readPreState(),
      { assertChannel: shouldAssertChannel(currentTrain, readPreMode()) }
    );
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

  /*
   * A machine-readable line, last so it cannot displace the diagnosis a reader
   * (or the issue title) takes from the top. A caller that reported every
   * failure with one hard-coded sentence would name a tag or a release when the
   * defect is an incomplete train or a stale channel, sending the maintainer to
   * the wrong layer entirely.
   */
  const announceState = () =>
    console.log(`check-finalized: state=${result.state}`);

  if (result.code === 0) {
    console.log(`check-finalized: ok - ${result.message}`);
    announceState();
    process.exit(0);
  }

  // Kept apart from a failure so a caller can act on the difference. An
  // unreachable registry or remote should not file a release-integrity report
  // that a human then has to close by hand.
  if (result.code === 2) {
    console.error(`check-finalized: UNKNOWN\n\n  ${result.message}\n`);
    announceState();
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
  announceState();
  process.exit(1);
}
