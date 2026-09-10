/**
 * The three facts a finished release consists of, and what each combination means.
 *
 * The state this exists to name actually happened twice: packages on the
 * registry, no tag, no GitHub Release, and nothing saying so. The cases below
 * include that exact combination, because a check written after an incident
 * should be able to fail on the incident.
 */
import { describe, expect, it } from "vitest";

import {
  ANCHOR_PACKAGE,
  manifestAtRef,
  publishState,
  releaseState,
  remedyFor,
  remoteTagState,
  tagFor,
  verdict,
  versionAtRef,
} from "./check-finalized.mjs";

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
    expect(result.remedy).toBe("tag-only");
    expect(remedyFor(result, VERSION)).toContain("does NOT repair this");
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
    expect(result.remedy).toBe("rerun");
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

  it("is a draft when the release exists but was never published", () => {
    // 🔴 A draft is visible to anyone with write access and to nobody else, so
    // a train whose release was left in draft reads as described while the
    // page describing it does not exist for a reader.
    expect(releaseState("v1", () => '{"tagName":"v1","isDraft":true}')).toBe(
      "draft"
    );
  });

  it("is present when the release is published", () => {
    // The control: a rule that called every release a draft would satisfy the
    // case above on its own.
    expect(releaseState("v1", () => '{"tagName":"v1","isDraft":false}')).toBe(
      "present"
    );
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
  const shipped = { versions: ["0.0.0", PRIOR, VERSION], distTags: {} };
  const notYet = { versions: ["0.0.0", PRIOR], distTags: {} };
  const placeholderOnly = { versions: ["0.0.0"], distTags: {} };
  const live = names => async name => (names.includes(name) ? shipped : notYet);

  it("is `all` when every package reached the registry", async () => {
    const state = await publishState(manifest, live(manifest.map(e => e.name)));
    expect(state.kind).toBe("all");
    expect(state.published).toBe(3);
  });

  it("is `none` when none did", async () => {
    const state = await publishState(manifest, live([]));
    expect(state.kind).toBe("none");
  });

  it("is `partial` when some did, which the anchor alone could not see", async () => {
    // 🔴 `changeset publish` is not atomic. Asking only about `nextly` reported
    // "nothing published yet" for a train that stranded halfway, which is the
    // same lingering state this check exists to surface.
    const state = await publishState(manifest, live(["@nextlyhq/admin", "@nextlyhq/ui"]));
    expect(state.kind).toBe("partial");
    expect(state.missing).toEqual(["nextly"]);
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
    const state = await publishState(withNewcomer, async name =>
      name === "@nextlyhq/eslint-plugin" ? placeholderOnly : shipped
    );

    expect(state.kind).toBe("all");
    expect(state.pending).toEqual(["@nextlyhq/eslint-plugin"]);
    // Graded over the three that have shipped, not over all four.
    expect(state.total).toBe(3);
  });

  it("still counts a package that HAS shipped before as missing", async () => {
    // The control for the rule above. Exempting a newcomer must not exempt a
    // package that stranded, or `partial` stops meaning anything at all.
    const state = await publishState(manifest, async name =>
      name === "nextly" ? notYet : shipped
    );

    expect(state.kind).toBe("partial");
    expect(state.missing).toEqual(["nextly"]);
    expect(state.pending).toEqual([]);
  });

  it("treats a package the registry has never heard of as awaiting its first publish", async () => {
    const state = await publishState(manifest, async () => null);
    expect(state.kind).toBe("none");
    expect(state.pending).toEqual(manifest.map(entry => entry.name));
  });
});

describe("a release that was saved but never published", () => {
  it("reports a draft as unfinalized, and does not prescribe a re-run", () => {
    // `release.yml` gates its whole finalize branch on `gh release view`
    // succeeding, and that succeeds for a draft, so a re-run reports "already
    // exists; nothing to finalize" and goes green while this keeps failing.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: { kind: "known", version: VERSION },
      release: "draft",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("unfinalized");
    expect(result.remedy).toBe("publish-draft");
    const text = remedyFor(result, VERSION);
    expect(text).toContain("re-running repairs nothing");
    expect(text).toContain("--draft=false");
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
    expect(result.remedy).toBe("check-release-first");
    const text = remedyFor(result, VERSION);
    expect(text).toContain(`gh release view ${tagFor(VERSION)}`);
    expect(text).toContain("re-running repairs nothing");
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
    expect(result.remedy).toBe("retag");
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

    expect(result.remedy).toBe("retag-then-check-release");
    const text = remedyFor(result, VERSION);
    expect(text).toContain(`gh release view ${tagFor(VERSION)}`);
    expect(text).toContain("could not be established");
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

    expect(result.remedy).toBe("retag-then-rerun");
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
