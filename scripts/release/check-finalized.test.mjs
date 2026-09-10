/**
 * The three facts a finished release consists of, and what each combination means.
 *
 * The state this exists to name actually happened twice: packages on the
 * registry, no tag, no GitHub Release, and nothing saying so. The cases below
 * include that exact combination, because a check written after an incident
 * should be able to fail on the incident.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANCHOR_PACKAGE,
  channelDecision,
  manifestAtRef,
  publishState,
  releaseState,
  remedyFor,
  shouldAssertChannel,
  unsettledPackages,
  remoteTagState,
  tagFor,
  verdict,
  versionAtRef,
} from "./check-finalized.mjs";
// The bootstrap placeholder is what makes a package NOT `only-pre`, which is
// what makes the prerelease tag the expected one below. Imported rather than
// spelled, so the fixture cannot drift from the rule it depends on.
import { PLACEHOLDER_VERSION } from "./lib.mjs";

const ALL = { kind: "all", published: 20, total: 20 };
const NONE = { kind: "none", published: 0, total: 20 };
const TAG = sha => ({ kind: "present", sha });
const NO_TAG = { kind: "absent" };

const VERSION = "0.0.2-alpha.64";
const SHA = "12523acb80b174e6cd24d813ab8abeb7a347fbb5";

describe("what a finished release consists of", () => {
  it("passes when the version is published, tagged and released", () => {
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "present",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("finalized");
  });

  it("FAILS on the state that actually happened: on npm, no tag, no release", () => {
    // `0.0.2-alpha.64`, 9 September. Twenty packages live, the tag and the
    // GitHub Release never created because verification had already exited
    // non-zero, and the next commit landed before anyone re-ran it.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: NO_TAG,
      release: "absent",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("unfinalized");
    expect(result.missing).toEqual([
      `the git tag ${tagFor(VERSION)}`,
      `the GitHub Release ${tagFor(VERSION)}`,
    ]);
  });

  it("fails when only the tag is missing", () => {
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: NO_TAG,
      release: "present",
    });

    expect(result.code).toBe(1);
    expect(result.missing).toEqual([`the git tag ${tagFor(VERSION)}`]);
    // Re-running does not repair this one, so it must not be prescribed.
    expect(result.steps).toEqual(["push-tag"]);
    expect(remedyFor(result, VERSION)).toContain("does NOT restore it");
    expect(remedyFor(result, VERSION)).toContain(`git push origin refs/tags/${tagFor(VERSION)}`);
  });

  it("fails when only the GitHub Release is missing", () => {
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "absent",
    });

    expect(result.code).toBe(1);
    expect(result.missing).toEqual([`the GitHub Release ${tagFor(VERSION)}`]);
    // Here a re-run DOES repair it, because the finalize branch runs.
    expect(result.steps).toEqual(["rerun"]);
    expect(remedyFor(result, VERSION)).toContain("gh run rerun");
  });
});

describe("states that are not this check's business", () => {
  it("passes when the version is not on the registry", () => {
    // A publish in flight looks like this, and so does a commit that precedes
    // one. Failing here would turn every push between a version bump and its
    // publish into a red cross about nothing.
    const result = verdict({
      version: VERSION,
      publish: NONE,
      tag: NO_TAG,
      release: "absent",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("unpublished");
  });

  it("does not report a missing release it could not ask about", () => {
    // 🔴 The distinction that keeps this from failing a correct repository: a
    // query that cannot run is not a release that is absent. Without it, an
    // expired token or an API outage reads as an unfinalized release.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "unknown",
    });

    expect(result.code).toBe(2);
    expect(result.state).toBe("unknown");
    expect(result.message).toContain("could not be established");
  });

  it("still fails on a missing TAG even when the release is unknowable", () => {
    // The control for the case above: "unknown" must soften only the claim it
    // is about, or an unreachable API would excuse a missing tag too.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: NO_TAG,
      release: "unknown",
    });

    expect(result.code).toBe(1);
    expect(result.missing).toEqual([`the git tag ${tagFor(VERSION)}`]);
  });
});

describe("reading the version from git rather than the workspace", () => {
  it("asks git for the manifest at the ref it was given", () => {
    // The trap this avoids: on the version-PR path the changesets action
    // switches the checkout to `changeset-release/main` and bumps every
    // manifest in it, so the working tree holds the NEXT version, which is
    // deliberately unpublished.
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      return JSON.stringify({ name: ANCHOR_PACKAGE, version: VERSION });
    };

    expect(versionAtRef("abc123", run)).toBe(VERSION);
    expect(calls[0]).toEqual([
      "git",
      "show",
      `abc123:packages/nextly/package.json`,
    ]);
  });

  it("refuses a manifest that declares no version", () => {
    const run = () => JSON.stringify({ name: ANCHOR_PACKAGE });
    expect(() => versionAtRef("abc123", run)).toThrow(/declares no version/);
  });

  it("names the tag the release workflow creates", () => {
    expect(tagFor("0.0.2-alpha.65")).toBe("v0.0.2-alpha.65");
  });
});

describe("asking the remote about a tag", () => {
  it("prefers the peeled ref, so an annotated tag resolves to its commit", () => {
    const run = (_cmd, args) =>
      args[2].endsWith("^{}") ? `${SHA}\trefs/tags/v1^{}\n` : "deadbeef\trefs/tags/v1\n";

    expect(remoteTagState("v1", run)).toEqual({ kind: "present", sha: SHA });
  });

  it("falls back to the plain ref for a lightweight tag", () => {
    const run = (_cmd, args) =>
      args[2].endsWith("^{}") ? "" : `${SHA}\trefs/tags/v1\n`;

    expect(remoteTagState("v1", run)).toEqual({ kind: "present", sha: SHA });
  });

  it("is absent when the remote answers and has no such tag", () => {
    expect(remoteTagState("v1", () => "")).toEqual({ kind: "absent" });
  });

  it("is unknown when the remote cannot be reached at all", () => {
    // 🔴 An unreachable remote is not a missing tag. Left to throw, this ended
    // the process with exit 1, which this file reserves for "published and
    // unfinalized", so a network blip read as a release-integrity failure.
    const run = () => {
      throw new Error("fatal: unable to access origin");
    };

    expect(remoteTagState("v1", run)).toEqual({ kind: "unknown" });
  });
});

describe("asking GitHub about a release", () => {
  it("is present when the query succeeds", () => {
    expect(releaseState("v1", () => "{}")).toBe("present");
  });

  it("is present when a STABLE release is not marked prerelease", () => {
    // The control: a stable version is supposed to be Latest, so the rule must
    // turn on the version rather than on the flag alone.
    expect(
      releaseState("v1.0.0", () => '{"tagName":"v1.0.0","isDraft":false,"isPrerelease":false}')
    ).toBe("present");
  });

  it("is absent when the query says there is no such release", () => {
    const run = () => {
      const error = new Error("exit 1");
      error.stderr = "release not found";
      throw error;
    };

    expect(releaseState("v1", run)).toBe("absent");
  });

  it("is unknown when the query could not run at all", () => {
    const run = () => {
      const error = new Error("exit 4");
      error.stderr = "gh: authentication failed";
      throw error;
    };

    expect(releaseState("v1", run)).toBe("unknown");
  });
});

describe("grading how much of the train shipped", () => {
  const manifest = [
    { name: "nextly", version: VERSION },
    { name: "@nextlyhq/admin", version: VERSION },
    { name: "@nextlyhq/ui", version: VERSION },
  ];
  // A package missing THIS version has still shipped before it, and the
  // fixture has to say so: a version list holding nothing but the `0.0.0`
  // placeholder means a package awaiting its first publish, which is a
  // different state and is graded differently.
  const PRIOR = "0.0.2-alpha.62";
  const PRE = { tag: "alpha" };
  /*
   * 🔴 The dist-tag is part of the fixture because it is part of the question.
   * A version sitting on the registry that `nextly@alpha` does not resolve to
   * has not reached anyone, and `collectProblems` (which `verify.mjs` gates the
   * release on) says so; grading it published here would report a release
   * healthy that verification would refuse.
   */
  const shipped = {
    versions: ["0.0.0", PRIOR, VERSION],
    distTags: { alpha: VERSION },
  };
  const notYet = { versions: ["0.0.0", PRIOR], distTags: { alpha: PRIOR } };
  const staleTag = {
    versions: ["0.0.0", PRIOR, VERSION],
    distTags: { alpha: PRIOR },
  };
  const placeholderOnly = { versions: ["0.0.0"], distTags: {} };
  const live = names => async name => (names.includes(name) ? shipped : notYet);

  it("is `all` when every package reached the registry", async () => {
    const state = await publishState(manifest, live(manifest.map(e => e.name)), PRE);
    expect(state.kind).toBe("all");
    expect(state.published).toBe(3);
  });

  it("is `none` when none did", async () => {
    const state = await publishState(manifest, live([]), PRE);
    expect(state.kind).toBe("none");
  });

  it("is `partial` when some did, which the anchor alone could not see", async () => {
    // 🔴 `changeset publish` is not atomic. Asking only about `nextly` reported
    // "nothing published yet" for a train that stranded halfway, which is the
    // same lingering state this check exists to surface.
    const state = await publishState(manifest, live(["@nextlyhq/admin", "@nextlyhq/ui"]), PRE);
    expect(state.kind).toBe("partial");
    expect(state.missing).toEqual(["nextly"]);
  });

  it("separates a stale channel tag from a version that never published", async () => {
    /*
     * 🔴 Two facts, not one. A version is on the registry forever; a channel
     * tag legitimately moves on to the next release. Folding them together
     * made a superseded release read as "not on the registry", which is false,
     * and pointed the reader at a re-run when the fix is one `npm dist-tag
     * add`. `verify.mjs` refuses a stale tag too, so ignoring it would call a
     * release healthy that verification rejects.
     */
    const state = await publishState(
      manifest,
      async name => (name === "nextly" ? staleTag : shipped),
      PRE
    );

    // Published: the version IS on the registry.
    expect(state.kind).toBe("all");
    expect(state.published).toBe(3);
    // But not installable, and said separately.
    expect(state.channelStale).toHaveLength(1);
    expect(state.channelStale[0]).toContain("nextly");
    expect(state.channelStale[0]).toContain(PRIOR);
  });

  it("does not judge a historical release by today's channel tag", async () => {
    /*
     * 🔴 `alpha` legitimately advances, so an older release fails a
     * present-time comparison for the reason it is supposed to. Judging one
     * anyway produced a remedy telling the maintainer to move consumers BACK to
     * the old version, which is worse than saying nothing at all.
     */
    const state = await publishState(
      manifest,
      async () => staleTag,
      PRE,
      { assertChannel: false }
    );

    expect(state.kind).toBe("all");
    expect(state.channelStale).toEqual([]);
  });

  it("does not count a package awaiting its first publish as missing", async () => {
    // 🔴 `@nextlyhq/eslint-plugin` was added to the repository declaring
    // `0.0.2-alpha.58` while npm held only its `0.0.0` placeholder, and first
    // published at `0.0.2-alpha.60`. Grading it as missing calls every release
    // in that window a stranded train, which is a healthy repository reported
    // as broken for as long as it takes to ship the new package.
    const withNewcomer = [
      ...manifest,
      { name: "@nextlyhq/eslint-plugin", version: VERSION },
    ];
    const state = await publishState(
      withNewcomer,
      async name =>
        name === "@nextlyhq/eslint-plugin" ? placeholderOnly : shipped,
      PRE
    );

    expect(state.kind).toBe("all");
    expect(state.pending).toEqual(["@nextlyhq/eslint-plugin"]);
    // Graded over the three that have shipped, not over all four.
    expect(state.total).toBe(3);
  });

  it("still counts a package that HAS shipped before as missing", async () => {
    // The control for the rule above. Exempting a newcomer must not exempt a
    // package that stranded, or `partial` stops meaning anything at all.
    const state = await publishState(
      manifest,
      async name => (name === "nextly" ? notYet : shipped),
      PRE
    );

    expect(state.kind).toBe("partial");
    expect(state.missing).toEqual(["nextly"]);
    expect(state.pending).toEqual([]);
  });

  it("treats a package the registry has never heard of as awaiting its first publish", async () => {
    const state = await publishState(manifest, async () => null, PRE);
    expect(state.kind).toBe("none");
    expect(state.pending).toEqual(manifest.map(entry => entry.name));
  });
});


describe("a mistagged release, by what its GitHub Release is", () => {
  const mistagged = (release) =>
    verdict({
      version: VERSION,
      publish: { kind: "all", published: 20, total: 20, pending: [], channelStale: [] },
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: "0.0.2-alpha.62" },
      release,
    });

  it("uses a forced local tag in every retag, whatever the release state", () => {
    /*
     * 🔴 Plain `git tag -a` ABORTS with "tag already exists" when the clone has
     * it, which is the normal state after fetching the bad tag. Reproduced. It
     * fails AFTER the remote tag has been deleted, leaving no tag at all.
     */
    for (const release of ["present", "draft", "not-prerelease", "absent", "unknown"]) {
      const text = remedyFor(mistagged(release), VERSION);
      expect(text, release).toContain(`git tag -f -a ${tagFor(VERSION)}`);
      expect(text, release).not.toMatch(/git tag -a /);
    }
  });
});

describe("a release the channel tag never reached", () => {
  it("fails, and prescribes moving the tag rather than re-running", () => {
    // Re-running does not fix this and fails the same check, because
    // publishing skips versions the registry already has.
    const result = verdict({
      version: VERSION,
      publish: {
        kind: "all",
        published: 20,
        total: 20,
        pending: [],
        channelStale: [`nextly (alpha resolves to 0.0.2-alpha.62)`],
      },
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "present",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("channel-stale");
    expect(result.message).toContain("an install still serves the previous");
    expect(remedyFor(result, VERSION)).toContain("npm dist-tag add");
  });

  it("still reports a finished release when the channel does resolve", () => {
    // The control: the case above would pass on a rule that failed whenever
    // channelStale was merely present as a field.
    const result = verdict({
      version: VERSION,
      publish: { kind: "all", published: 20, total: 20, pending: [], channelStale: [] },
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "present",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("finalized");
  });
});

describe("how to re-run a release", () => {
  it("gives both forms, because --failed re-runs nothing on a green run", () => {
    /*
     * 🔴 `--failed` re-runs only the jobs that failed. A release run that went
     * green and had its GitHub Release deleted afterwards has none, so the
     * command re-runs nothing and reports success while the release stays
     * missing. Finalization is idempotent, so the whole-job form is the one
     * that works in that case.
     */
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "absent",
    });

    const text = remedyFor(result, VERSION);
    expect(text).toContain("gh run rerun <id> --failed");
    expect(text).toMatch(/gh run rerun <id> +# if it went green/);
  });
});


describe("what a verdict could not speak for", () => {
  it("names the packages it left out of a finished release", () => {
    // A reader told a release is finished should know it was graded over
    // nineteen packages and not twenty.
    const result = verdict({
      version: VERSION,
      publish: {
        kind: "all",
        published: 19,
        total: 19,
        pending: ["@nextlyhq/eslint-plugin"],
      },
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "present",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("finalized");
    expect(result.message).toContain("@nextlyhq/eslint-plugin");
    expect(result.message).toContain("never published a real version");
  });
});

describe("a train that stranded halfway", () => {
  it("fails rather than reporting nothing to describe", () => {
    const result = verdict({
      version: VERSION,
      publish: { kind: "partial", published: 17, total: 20, missing: ["nextly"] },
      tag: NO_TAG,
      release: "absent",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("partial");
    expect(result.message).toContain("17 of 20");
  });
});

describe("an answer that was never established", () => {
  it("treats a tag version in any other shape as unknown", () => {
    /*
     * 🔴 `verdict` is exported and untyped. A caller that omits `tagVersion`,
     * or passes the bare string an earlier shape used, must not fall through
     * to `finalized`: nothing established what the tag points at, and a tag on
     * an unrelated commit is the corruption this rule exists to catch.
     */
    for (const shape of [undefined, VERSION, {}, { kind: "known" }]) {
      const result = verdict({
        version: VERSION,
        publish: ALL,
        tag: TAG(SHA),
        tagVersion: shape,
        release: "present",
      });

      expect(result.code, `shape ${JSON.stringify(shape)}`).toBe(2);
      expect(result.state).toBe("unknown");
    }
  });

  it("still reports a finished release when the tag version IS known", () => {
    // The control: the loop above would pass on a rule that called every tag
    // unknown.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "present",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("finalized");
  });

  it("does not prescribe a re-run when the release could not be read", () => {
    // A re-run repairs a missing tag only when the release is missing too. If
    // the release exists after all, `release.yml` reports nothing to finalize
    // and skips the branch that pushes the tag, so the advice would succeed
    // while repairing nothing.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: NO_TAG,
      release: "unknown",
    });

    expect(result.code).toBe(1);
    /*
     * BOTH, because both were established: the tag is definitely gone, and the
     * release could not be read. An earlier shape returned whichever defect it
     * reached first, so the maintainer restored one and came back for the next.
     */
    expect(result.steps).toEqual(["push-tag", "check-release"]);
    const text = remedyFor(result, VERSION);
    expect(text).toContain(`gh release view ${tagFor(VERSION)}`);
    expect(text).toContain("there is nothing more to do about the release");
    expect(text).toContain("gh run rerun");
  });
});

describe("a tag that does not identify this release", () => {
  it("fails when the tagged commit declares a different version", () => {
    // A tag by the right name is not the same as a tag on this release. This is
    // what an erroneous manual recovery leaves behind.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: "0.0.2-alpha.62" },
      release: "present",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("mistagged");
    expect(result.steps).toEqual(["retag"]);
  });

  it("does not claim the release is missing when it could not be read", () => {
    // Saying "and the GitHub Release is missing" when it may well exist sends
    // the maintainer to a re-run that repairs nothing, because `release.yml`
    // finds the release and skips finalization.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: "0.0.2-alpha.62" },
      release: "unknown",
    });

    // The retag is established; the release is not. Both are reported, and the
    // remedy for the unknown one is to find out rather than to act.
    expect(result.steps).toEqual(["retag", "check-release"]);
    const text = remedyFor(result, VERSION);
    expect(text).toContain(`gh release view ${tagFor(VERSION)}`);
    expect(text).toContain("could not be read");
  });

  it("also re-runs when the release is missing as well as mistagged", () => {
    // Moving a tag does not create a GitHub Release; `release.yml` writes one
    // only on a run of its own. Advising the retag alone leaves this failing
    // and the next scheduled check reports the same state again.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: "0.0.2-alpha.62" },
      release: "absent",
    });

    expect(result.steps).toEqual(["retag", "rerun"]);
    const text = remedyFor(result, VERSION);
    expect(text).toContain(`git push origin refs/tags/${tagFor(VERSION)}`);
    expect(text).toContain("gh run rerun");
  });

  it("passes when the tagged commit declares this version", () => {
    // The control: the case above would pass on a rule that failed whenever a
    // tag version was supplied at all.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "present",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("finalized");
  });

  it("reports an unreadable tagged commit as unknown, not as finalized", () => {
    // 🔴 The tag exists and the release exists, so nothing is absent - but what
    // the tag POINTS AT could not be read, and a tag on an unrelated commit is
    // exactly the corruption this rule is here to catch. Reporting it as
    // finalized would close the check over a release nobody has verified.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "unknown" },
      release: "present",
    });

    expect(result.code).toBe(2);
    expect(result.state).toBe("unknown");
    expect(result.message).toContain(`which version ${tagFor(VERSION)} points at`);
  });
});

describe("deriving the train from git", () => {
  it("reads every publishable manifest at the ref and skips private ones", () => {
    const files = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/admin/package.json": { name: "@nextlyhq/admin", version: VERSION },
      "packages/playground/package.json": { name: "playground", version: "1.0.0", private: true },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      const path = args[1].split(":")[1];
      return JSON.stringify(files[path]);
    };

    expect(manifestAtRef("abc123", run)).toEqual([
      { name: "nextly", version: VERSION },
      { name: "@nextlyhq/admin", version: VERSION },
    ]);
  });

  it("refuses a publishable manifest it cannot read, rather than dropping it", () => {
    /*
     * 🔴 Dropping it shrinks the question. The package would leave the train,
     * the registry would never be asked about it, and the release could be
     * reported finished while that package was never published. Only an
     * entirely empty manifest was refused before, so one malformed package
     * among valid ones passed silently.
     */
    const files = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/broken/package.json": { name: "@nextlyhq/broken" },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(() => manifestAtRef("abc123", run)).toThrow(/packages\/broken/);
  });

  it("refuses a public package whose name is EMPTY, not just missing", () => {
    /*
     * 🔴 `""` is a string, so a type check passes it through. The registry is
     * then asked about a package that cannot exist, that answer reads as never
     * published, and the package leaves the train without a word: the same
     * silent shrink the malformed-manifest refusal above exists to stop,
     * reached through a value of the correct type.
     */
    const files = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/blank/package.json": { name: "", version: VERSION },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(() => manifestAtRef("abc123", run)).toThrow(/packages\/blank/);
  });

  it("refuses a whitespace-only name, and an empty version too", () => {
    // Whitespace reaches the registry exactly as emptiness does, and a version
    // is asked of the registry in the same breath as the name, so both fields
    // have to clear the same bar.
    const spaced = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/spaced/package.json": { name: "   ", version: VERSION },
    };
    const versionless = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/unversioned/package.json": { name: "@nextlyhq/unversioned", version: "" },
    };
    const runner = files => (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(() => manifestAtRef("abc123", runner(spaced))).toThrow(/packages\/spaced/);
    expect(() => manifestAtRef("abc123", runner(versionless))).toThrow(
      /packages\/unversioned/
    );
  });

  it("refuses an ANCHOR with an empty name, which defeats the lockstep check", () => {
    /*
     * 🔴 The worst shape. With no readable `nextly` in the manifest the
     * lockstep comparison finds no anchor and compares nothing, so a ref where
     * every other package has drifted to a different version is graded as a
     * single coherent release.
     */
    const files = {
      "packages/nextly/package.json": { name: "", version: VERSION },
      "packages/admin/package.json": { name: "@nextlyhq/admin", version: "9.9.9" },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(() => manifestAtRef("abc123", run)).toThrow(/packages\/nextly/);
  });

  it("still skips a PRIVATE manifest that declares no version", () => {
    // The control: refusing every unreadable manifest would refuse the private
    // ones this deliberately ignores, and no release would ever be gradable.
    const files = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/playground/package.json": { private: true },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(manifestAtRef("abc123", run)).toEqual([
      { name: "nextly", version: VERSION },
    ]);
  });

  it("ignores paths that are not a package manifest", () => {
    const run = (_cmd, args) =>
      args[0] === "ls-tree"
        ? "packages/nextly/src/index.ts\npackages/nextly/package.json\npackages/a/b/package.json"
        : JSON.stringify({ name: "nextly", version: VERSION });

    expect(manifestAtRef("abc123", run)).toEqual([
      { name: "nextly", version: VERSION },
    ]);
  });
});

describe("a release with more than one thing wrong", () => {
  /*
   * 🔴 The reason this block exists. The remedy used to be chosen by a chain of
   * early returns and a lookup keyed on the GitHub Release alone, with names
   * like `retag-then-publish-draft` written for the pairs someone thought of.
   * The states are a PRODUCT of three axes, so ten names covered forty cells,
   * and each round of review found another pair that fell through: the
   * maintainer followed the one fix it named, saw the check still failing, and
   * came back for the next.
   */

  it("moves the channel tag AND finishes the release", () => {
    // The channel-stale case used to return before it looked at the tag or the
    // release at all, so a train that needed both was told only to move a tag.
    const result = verdict({
      version: VERSION,
      publish: { ...ALL, channelStale: ["nextly", "@nextlyhq/admin"] },
      tag: NO_TAG,
      release: "absent",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("channel-stale");
    expect(result.steps).toEqual(["move-dist-tag", "push-tag", "rerun"]);

    const text = remedyFor(result, VERSION);
    expect(text).toContain("npm dist-tag add");
    expect(text).toContain("gh run rerun");
  });

  it("refuses to publish a draft while the tag's target is unknown", () => {
    /*
     * 🔴 Publishing makes the release public. A tag whose target nobody could
     * read may be announcing a commit that was never shipped, so establishing
     * it is a precondition rather than a parallel repair.
     */
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "unknown" },
      release: "draft",
    });

    expect(result.steps).toEqual(["establish-tag-target"]);
    expect(result.steps).not.toContain("publish-draft");
    expect(remedyFor(result, VERSION)).toContain("below should be acted on yet");
  });

  it("still reports one step when only one thing is wrong", () => {
    // The control. A rule that always emitted several steps would satisfy every
    // case above while telling a maintainer to repair things that are fine.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: NO_TAG,
      release: "present",
    });

    expect(result.steps).toEqual(["push-tag"]);
  });
});


describe("a ref that declares no single release", () => {
  it("refuses a manifest whose packages are not in lockstep", () => {
    /*
     * 🔴 Changesets bumps every publishable package through its `fixed` group,
     * so a package left behind means the ref declares no release at all.
     * Without this the drifted package is simply asked about at its own
     * version: if that version happens to exist on npm, every check passes and
     * a repository that never cut this release reads as finalized.
     */
    const files = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/admin/package.json": {
        name: "@nextlyhq/admin",
        version: "0.0.2-alpha.63",
      },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(() => manifestAtRef("abc123", run)).toThrow(/no single release/);
  });

  it("accepts a manifest that is in lockstep", () => {
    // The control: refusing every manifest would refuse every real release.
    const files = {
      "packages/nextly/package.json": { name: "nextly", version: VERSION },
      "packages/admin/package.json": { name: "@nextlyhq/admin", version: VERSION },
    };
    const run = (_cmd, args) => {
      if (args[0] === "ls-tree") return Object.keys(files).join("\n");
      return JSON.stringify(files[args[1].split(":")[1]]);
    };

    expect(manifestAtRef("abc123", run)).toHaveLength(2);
  });
});

describe("when the channel tag is worth asserting", () => {
  /*
   * 🔴 This rule used to live only inside the command-line block, which no test
   * enters. Two separate mutations of it passed the whole suite: the historical
   * case and the pre-exit case were both proven on `publishState` directly,
   * which shows the MECHANISM works and says nothing about whether the caller
   * chooses correctly.
   */
  const STABLE = "0.0.2";
  const IN_ALPHA = { mode: "pre", tag: "alpha" };
  const IN_BETA = { mode: "pre", tag: "beta" };
  const LEAVING = { mode: "exit", tag: "alpha" };
  const OUTSIDE = null;

  it("asserts it when pre.json and the manifests agree", () => {
    // The two settled states. Both files say the same thing about this release,
    // so the tag derived from one can be held against the other.
    expect(shouldAssertChannel(true, IN_ALPHA, VERSION)).toBe(true);
    expect(shouldAssertChannel(true, OUTSIDE, STABLE)).toBe(true);
  });

  it("does not assert it for a historical subject", () => {
    // Today's channel tag moved past an older release and was never meant to
    // point at it. Independent of the mode, so both settled states are shown.
    expect(shouldAssertChannel(false, IN_ALPHA, VERSION)).toBe(false);
    expect(shouldAssertChannel(false, OUTSIDE, STABLE)).toBe(false);
  });

  it("does not assert it while prerelease mode is being EXITED", () => {
    // `readPreState` answers null for `mode: "exit"` just as it does for "never
    // in pre mode", so the expected tag becomes `latest` and the remedy says to
    // move `latest` onto the alpha still in the manifests.
    expect(shouldAssertChannel(true, LEAVING, VERSION)).toBe(false);
  });

  it("does not assert it while prerelease mode is being ENTERED", () => {
    /*
     * 🔴 The mirror of the exit. `pnpm changeset pre enter alpha` writes
     * `mode: "pre"` in its own commit, and `release.yml` runs on it while every
     * manifest still declares the preceding STABLE release. A mode test alone
     * answers "assert" here, the new prerelease dist-tag is expected of a
     * stable version, and the remedy prescribes moving `alpha` onto the last
     * stable build.
     */
    expect(shouldAssertChannel(true, IN_ALPHA, STABLE)).toBe(false);
  });

  it("does not assert it when pre mode was RE-ENTERED under a different tag", () => {
    /*
     * 🔴 Why this compares identifiers rather than asking "is it a prerelease".
     * Changesets allows an exit and a re-entry under a new tag before the
     * Version PR lands, so `pre.json` can say `beta` while the manifests still
     * carry `-alpha.N`. Both claims agree that this is a prerelease and still
     * disagree about which one, and asserting there expects `beta` to resolve
     * to the old alpha build.
     */
    expect(shouldAssertChannel(true, IN_BETA, VERSION)).toBe(false);
  });

  it("does not answer the same way for every input", () => {
    /*
     * The control. A rule that never fires satisfies every case above that
     * expects false, and a rule that always fires satisfies the two that expect
     * true, so neither group proves anything on its own.
     */
    const answers = [
      shouldAssertChannel(true, IN_ALPHA, VERSION),
      shouldAssertChannel(true, IN_ALPHA, STABLE),
      shouldAssertChannel(true, IN_BETA, VERSION),
      shouldAssertChannel(true, LEAVING, VERSION),
      shouldAssertChannel(true, OUTSIDE, STABLE),
    ];
    expect(new Set(answers).size).toBe(2);
  });

  it("refuses prerelease mode with no usable tag, rather than answering no", () => {
    /*
     * 🔴 `{ "mode": "pre" }` survives a merge or a hand edit, and a null tag
     * compares unequal to every version there is. Answering "do not assert"
     * there switches the channel check off and reports nothing, which reads
     * exactly like a check that ran and found nothing wrong. The question
     * cannot be asked, so it leaves by the unanswerable door.
     */
    for (const tag of [null, undefined, "", "   "]) {
      expect(() => shouldAssertChannel(true, { mode: "pre", tag }, VERSION)).toThrow(
        /no usable tag/
      );
    }

    // And it reaches the caller as exit-2 material rather than as a crash.
    const decision = channelDecision(true, VERSION, () => ({ mode: "pre", tag: null }));
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain("no usable tag");
  });

  it("reports an unreadable pre.json as unanswerable, not as a defect", () => {
    /*
     * 🔴 The exit code carries this distinction and nothing else does.
     * `release-health.yml` treats exit 1 as a CONFIRMED unfinished release and
     * opens an issue from the report, so a parse error escaping here becomes an
     * issue whose headline is a stack trace and whose remedy is nonsense. The
     * question could not be asked; that is exit 2.
     */
    const unreadable = () => {
      throw new SyntaxError("Unexpected token } in JSON at position 4");
    };

    const decision = channelDecision(true, VERSION, unreadable);

    expect(decision.ok).toBe(false);
    expect(decision.message).toContain("pre.json");
    expect(decision.message).toContain("unknown rather than wrong");
  });

  it("passes the decision through when pre.json can be read", () => {
    // The control. A decision that reported every read as unanswerable would
    // satisfy the case above and switch the channel check off permanently.
    const decision = channelDecision(true, VERSION, () => IN_ALPHA);

    expect(decision).toEqual({ ok: true, assertChannel: true });
  });

  it("recognises a DOTTED tag, whose versions carry more than one identifier", () => {
    /*
     * 🔴 `pnpm changeset pre enter next.1` produces `1.2.3-next.1.0`, whose
     * first prerelease identifier is `next`. Comparing that against the tag
     * `next.1` is false for every version the cycle will ever produce, so the
     * channel check would report nothing for the whole cycle while looking
     * exactly like a check that ran and found nothing wrong.
     *
     * `getExpectedDistTag` keeps the first-identifier comparison, because it
     * exists to mirror what Changesets does and Changesets classifies that way.
     * These are two questions, not one rule spelled twice.
     */
    const DOTTED = { mode: "pre", tag: "next.1" };

    expect(shouldAssertChannel(true, DOTTED, "1.2.3-next.1.0")).toBe(true);
    // Still discriminating: a different cycle's build does not pass.
    expect(shouldAssertChannel(true, DOTTED, "1.2.3-next.2.0")).toBe(false);
    // And a tag is not a prefix of an unrelated identifier that starts the same.
    expect(shouldAssertChannel(true, { mode: "pre", tag: "next" }, "1.2.3-nextly.1")).toBe(
      false
    );
  });

  it("reads build metadata as part of the version, not as a prerelease", () => {
    // Shares `firstPrereleaseId` with the tag rule rather than re-deciding what
    // a prerelease looks like, so `+build` cannot be mistaken for `-alpha`.
    expect(shouldAssertChannel(true, OUTSIDE, "0.0.2+build.7")).toBe(true);
    expect(shouldAssertChannel(true, IN_ALPHA, "0.0.2+build.7")).toBe(false);
  });
});

describe("a repository part-way out of prerelease mode", () => {
  it("does not expect a channel tag while pre mode is being exited", async () => {
    /*
     * 🔴 `pre.json` says `mode: "exit"` from the exit commit until the Version
     * PR lands, and the manifests still declare the last alpha for that whole
     * window. `readPreState` answers null there, exactly as it does when the
     * repository was never in pre mode, so the expected tag comes out as
     * `latest`. Asserting it produces `channel-stale` and a remedy that says to
     * move `latest` onto a prerelease, serving an alpha to every stable
     * install.
     */
    const manifest = [{ name: "nextly", version: VERSION }];
    const state = {
      versions: ["0.0.0", "0.0.2-alpha.62", VERSION],
      distTags: { alpha: VERSION, latest: "0.0.2-alpha.62" },
    };

    const asserted = await publishState(manifest, async () => state, null, {
      assertChannel: true,
    });
    // What the old behaviour produced: `latest` expected, found on the previous
    // alpha, and a remedy that would move it onto this one.
    expect(asserted.channelStale).toHaveLength(1);
    expect(asserted.channelStale[0]).toContain("latest");

    const skipped = await publishState(manifest, async () => state, null, {
      assertChannel: false,
    });
    expect(skipped.kind).toBe("all");
    expect(skipped.channelStale ?? []).toEqual([]);
  });
});

describe("a repository part-way INTO prerelease mode", () => {
  it("does not expect a channel tag while pre mode is being entered", async () => {
    /*
     * 🔴 The mirror of the exit above, and it goes wrong in the opposite
     * direction. `pnpm changeset pre enter alpha` writes `mode: "pre"` in its
     * own commit, so `readPreState` answers with the new tag while every
     * manifest still declares the preceding STABLE release, and `release.yml`
     * runs on exactly that commit.
     *
     * `getExpectedDistTag` reads the REGISTRY to decide `only-pre`, and a
     * package with real stable versions is not only-pre, so `alpha` is expected
     * to point at the stable version the manifests name. It points at the last
     * prerelease instead, and the remedy that follows says to move `alpha` onto
     * a stable build.
     */
    const STABLE = "0.0.2";
    const manifest = [{ name: "nextly", version: STABLE }];
    const state = {
      versions: [PLACEHOLDER_VERSION, "0.0.2-alpha.65", STABLE],
      distTags: { latest: STABLE, alpha: "0.0.2-alpha.65" },
    };
    const entering = { mode: "pre", tag: "alpha" };

    const asserted = await publishState(manifest, async () => state, entering, {
      assertChannel: true,
    });
    // What a mode-only rule produced here: `alpha` expected of a stable
    // version, and a remedy that would move the prerelease channel onto it.
    expect(asserted.channelStale).toHaveLength(1);
    expect(asserted.channelStale[0]).toContain("alpha");

    const skipped = await publishState(manifest, async () => state, entering, {
      assertChannel: false,
    });
    expect(skipped.kind).toBe("all");
    expect(skipped.channelStale ?? []).toEqual([]);
  });
});

describe("a partial train whose channel tag is also stale", () => {
  it("prescribes moving the tag as well as re-running", () => {
    /*
     * 🔴 Publishing skips versions the registry already has, so a package whose
     * version is live but whose tag never moved is untouched by a re-run: the
     * recovery publishes the genuinely missing package and then fails
     * verification again on the same tag. The old branch returned before it
     * looked at the channel at all.
     */
    const result = verdict({
      version: VERSION,
      publish: {
        kind: "partial",
        published: 19,
        total: 20,
        missing: ["@nextlyhq/ui"],
        channelStale: ["nextly (alpha resolves to 0.0.2-alpha.64)"],
      },
      tag: NO_TAG,
      release: "absent",
    });

    expect(result.steps).toEqual(["move-dist-tag", "rerun"]);
    expect(result.message).toContain("channel tag also does not resolve");
    const text = remedyFor(result, VERSION);
    expect(text).toContain("npm dist-tag add");
    expect(text).toContain("gh run rerun");
  });

  it("prescribes only a re-run when the channel is fine", () => {
    // The control: adding the tag step unconditionally would tell a maintainer
    // to move a tag that already resolves.
    const result = verdict({
      version: VERSION,
      publish: { kind: "partial", published: 19, total: 20, missing: ["@nextlyhq/ui"] },
      tag: NO_TAG,
      release: "absent",
    });

    expect(result.steps).toEqual(["rerun"]);
  });
});

describe("a tag lookup that could not be made at all", () => {
  it("acts on nothing until the tag's existence is established", () => {
    /*
     * `git ls-remote` failing is not the same as a tag being absent, and it is
     * the same validity precondition as an unreadable target: editing or
     * publishing the release would act on a version whose tag nobody has
     * established.
     */
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: { kind: "unknown" },
      release: "absent",
    });

    expect(result.steps).toEqual(["establish-tag-existence"]);
    expect(result.steps).not.toContain("rerun");
    expect(remedyFor(result, VERSION)).toContain("git ls-remote");
  });
});

describe("what the settle actually waits for", () => {
  const manifest = [
    { name: "nextly", version: VERSION },
    { name: "@nextlyhq/ui", version: VERSION },
  ];

  it("waits for a version the registry has not served yet", () => {
    const registry = new Map([
      // Shipped before, but this version is not readable yet: the only thing
      // waiting can fix.
      ["nextly", { versions: ["0.0.0", "0.0.2-alpha.62"], distTags: {} }],
      ["@nextlyhq/ui", { versions: ["0.0.0", VERSION], distTags: {} }],
    ]);

    expect(unsettledPackages(manifest, registry).map(p => p.name)).toEqual([
      "nextly",
    ]);
  });

  it("does not wait on a package that has never published", () => {
    /*
     * 🔴 Nothing is on its way. The strict predicate refuses a placeholder-only
     * package, so waiting on it burns the entire budget every run and then
     * reports the verdict it would have reported immediately.
     */
    const registry = new Map([
      ["nextly", { versions: ["0.0.0", VERSION], distTags: {} }],
      ["@nextlyhq/ui", { versions: ["0.0.0"], distTags: {} }],
    ]);

    expect(unsettledPackages(manifest, registry)).toEqual([]);
  });

  it("does not wait on a dist-tag that was never moved", () => {
    // A tag nobody moved stays unmoved. That is a defect for the verdict to
    // report, not a delay for the wait to absorb.
    const registry = new Map([
      ["nextly", { versions: ["0.0.0", VERSION], distTags: { alpha: "0.0.2-alpha.64" } }],
      ["@nextlyhq/ui", { versions: ["0.0.0", VERSION], distTags: { alpha: "0.0.2-alpha.64" } }],
    ]);

    expect(unsettledPackages(manifest, registry)).toEqual([]);
  });
});

describe("the command-line path, run as a program", () => {
  /*
   * 🔴 The first test that enters `if (invokedDirectly)` at all. Importing the
   * module never does, which is how a rewrite deleted a constant the block
   * still referenced while 1200 unit tests passed, and how two mutations of the
   * channel rule passed the entire suite.
   *
   * This covers the exit-code contract rather than the whole block, because the
   * rest of it reaches the registry. It is the half that matters most to a
   * reader: `.github/workflows/release-health.yml` treats exit 1 as a CONFIRMED
   * unfinished release and files an issue for it, so any question that could
   * not be asked has to leave by a different door.
   */
  const SCRIPT = fileURLToPath(new URL("./check-finalized.mjs", import.meta.url));

  const runProgram = ref =>
    spawnSync(process.execPath, [SCRIPT, ref], { encoding: "utf8" });

  it("exits 2, not 1, when the ref it was given cannot be read", () => {
    // A ref this shape resolves to nothing, so the run ends before any network
    // call: `versionAtRef` throws and the block has to classify that.
    const result = runProgram("0000000000000000000000000000000000000000");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nothing");
  });

  it("says which ref it could not read", () => {
    // The workflow prints this report into an issue body. A diagnosis that does
    // not name its subject is one a reader cannot act on.
    const result = runProgram("refs/heads/no-such-branch-here");

    expect(result.stderr).toContain("refs/heads/no-such-branch-here");
  });
});
