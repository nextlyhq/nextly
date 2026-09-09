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
      tagVersion: VERSION,
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
      tagVersion: VERSION,
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
      tagVersion: VERSION,
      release: "unknown",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("partly-unknown");
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
  const live = names => async name =>
    names.includes(name) ? { versions: ["0.0.0", VERSION], distTags: {} } : { versions: ["0.0.0"], distTags: {} };

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

  it("treats a package the registry has never heard of as not published", async () => {
    const state = await publishState(manifest, async () => null);
    expect(state.kind).toBe("none");
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

describe("a tag that does not identify this release", () => {
  it("fails when the tagged commit declares a different version", () => {
    // A tag by the right name is not the same as a tag on this release. This is
    // what an erroneous manual recovery leaves behind.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: "0.0.2-alpha.62",
      release: "present",
    });

    expect(result.code).toBe(1);
    expect(result.state).toBe("mistagged");
    expect(result.remedy).toBe("retag");
  });

  it("passes when the tagged commit declares this version", () => {
    // The control: the case above would pass on a rule that failed whenever a
    // tag version was supplied at all.
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: VERSION,
      release: "present",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("finalized");
  });

  it("does not claim a mismatch when the tagged version could not be read", () => {
    const result = verdict({
      version: VERSION,
      publish: ALL,
      tag: TAG(SHA),
      tagVersion: undefined,
      release: "present",
    });

    expect(result.code).toBe(0);
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
