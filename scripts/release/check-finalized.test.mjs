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
  isPublished,
  releaseState,
  remoteTagSha,
  tagFor,
  verdict,
  versionAtRef,
} from "./check-finalized.mjs";

const VERSION = "0.0.2-alpha.64";
const SHA = "12523acb80b174e6cd24d813ab8abeb7a347fbb5";

describe("what a finished release consists of", () => {
  it("passes when the version is published, tagged and released", () => {
    const result = verdict({
      version: VERSION,
      published: true,
      tagSha: SHA,
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
      published: true,
      tagSha: undefined,
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
      published: true,
      tagSha: undefined,
      release: "present",
    });

    expect(result.code).toBe(1);
    expect(result.missing).toEqual([`the git tag ${tagFor(VERSION)}`]);
  });

  it("fails when only the GitHub Release is missing", () => {
    const result = verdict({
      version: VERSION,
      published: true,
      tagSha: SHA,
      release: "absent",
    });

    expect(result.code).toBe(1);
    expect(result.missing).toEqual([`the GitHub Release ${tagFor(VERSION)}`]);
  });
});

describe("states that are not this check's business", () => {
  it("passes when the version is not on the registry", () => {
    // A publish in flight looks like this, and so does a commit that precedes
    // one. Failing here would turn every push between a version bump and its
    // publish into a red cross about nothing.
    const result = verdict({
      version: VERSION,
      published: false,
      tagSha: undefined,
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
      published: true,
      tagSha: SHA,
      release: "unknown",
    });

    expect(result.code).toBe(0);
    expect(result.state).toBe("tagged");
    expect(result.message).toContain("could not be established");
  });

  it("still fails on a missing TAG even when the release is unknowable", () => {
    // The control for the case above: "unknown" must soften only the claim it
    // is about, or an unreachable API would excuse a missing tag too.
    const result = verdict({
      version: VERSION,
      published: true,
      tagSha: undefined,
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

    expect(remoteTagSha("v1", run)).toBe(SHA);
  });

  it("falls back to the plain ref for a lightweight tag", () => {
    const run = (_cmd, args) =>
      args[2].endsWith("^{}") ? "" : `${SHA}\trefs/tags/v1\n`;

    expect(remoteTagSha("v1", run)).toBe(SHA);
  });

  it("reports nothing when the remote has no such tag", () => {
    expect(remoteTagSha("v1", () => "")).toBeUndefined();
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
    // An expired token, a rate limit, no network. None of these is evidence
    // about the release, and treating them as evidence is how a check starts
    // failing on correct repositories.
    const run = () => {
      const error = new Error("exit 4");
      error.stderr = "gh: authentication failed";
      throw error;
    };

    expect(releaseState("v1", run)).toBe("unknown");
  });
});

describe("asking the registry whether a version exists", () => {
  it("is published when the registry lists the version", async () => {
    const fetchState = async () => ({
      versions: ["0.0.0", VERSION],
      distTags: { alpha: VERSION },
    });

    await expect(isPublished(VERSION, fetchState)).resolves.toBe(true);
  });

  it("is not published when the registry lists other versions", async () => {
    // The positive control for the case above: it would pass on a predicate
    // that answered true to everything.
    const fetchState = async () => ({
      versions: ["0.0.0", "0.0.2-alpha.62"],
      distTags: { alpha: "0.0.2-alpha.62" },
    });

    await expect(isPublished(VERSION, fetchState)).resolves.toBe(false);
  });

  it("is not published when the registry has never heard of the package", async () => {
    await expect(isPublished(VERSION, async () => null)).resolves.toBe(false);
  });
});
