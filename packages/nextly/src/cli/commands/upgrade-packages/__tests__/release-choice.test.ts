/**
 * Which release `nextly upgrade` moves to: the installed release's channel
 * decides, never another tag's release and never an older one.
 */
import { describe, expect, it } from "vitest";

import { channelOf, chooseRelease } from "../release-choice";

/** A registry whose tags diverge: `latest` on the oldest, `alpha` on the middle, `beta` on the newest. */
const RELEASES = {
  tags: {
    latest: "9.0.0-alpha.1",
    alpha: "9.0.0-alpha.2",
    beta: "9.0.0-beta.1",
  },
  versions: ["9.0.0-alpha.1", "9.0.0-alpha.2", "9.0.0-beta.1"],
};
const ALL_TAGS = [
  { tag: "alpha", version: "9.0.0-alpha.2" },
  { tag: "beta", version: "9.0.0-beta.1" },
  { tag: "latest", version: "9.0.0-alpha.1" },
];
const choose = (installed: string | undefined, argument?: string) =>
  chooseRelease({ argument, installed, releases: RELEASES });

describe("the channel of a release", () => {
  it("is its prerelease identifier, or latest for a release with none", () => {
    expect(channelOf("0.0.2-alpha.68")).toBe("alpha");
    expect(channelOf("1.0.0-rc.1")).toBe("rc");
    expect(channelOf("1.2.3")).toBe("latest");
    // A prerelease numbered and not named has no channel of its own.
    expect(channelOf("1.2.3-0")).toBe("latest");
  });
});

describe("with no version given", () => {
  it("moves to the release the installed channel's tag names, not latest's or the newest", () => {
    expect(choose("9.0.0-alpha.1")).toEqual({
      kind: "move",
      version: "9.0.0-alpha.2",
    });
  });

  it("changes nothing on the channel's newest release, and names another tag's newer one", () => {
    expect(choose("9.0.0-alpha.2")).toEqual({
      kind: "current",
      channel: "alpha",
      newer: [{ tag: "beta", version: "9.0.0-beta.1" }],
    });
  });

  it("never moves to a release older than the installed one", () => {
    // Ahead of its channel's tag: a release the tag has not been moved to yet.
    expect(
      chooseRelease({
        argument: undefined,
        installed: "9.0.0-alpha.3",
        releases: RELEASES,
      })
    ).toEqual({
      kind: "current",
      channel: "alpha",
      newer: [{ tag: "beta", version: "9.0.0-beta.1" }],
    });
  });

  it("follows latest from a release with no prerelease identifier", () => {
    expect(
      chooseRelease({
        argument: undefined,
        installed: "8.0.0",
        releases: {
          tags: { latest: "8.1.0", alpha: "9.0.0-alpha.2" },
          versions: ["8.0.0", "8.1.0", "9.0.0-alpha.2"],
        },
      })
    ).toEqual({ kind: "move", version: "8.1.0" });
  });

  it("refuses a channel the registry has no tag for, naming every tag", () => {
    expect(choose("9.0.0-rc.1")).toEqual({
      kind: "refused",
      why: { reason: "no-tag", channel: "rc" },
      tags: ALL_TAGS,
    });
  });

  it("refuses where the installed release cannot be read, naming every tag", () => {
    expect(choose(undefined)).toEqual({
      kind: "refused",
      why: { reason: "not-installed" },
      tags: ALL_TAGS,
    });
  });
});

describe("with a version given", () => {
  it("moves to it when it is published, an older one included", () => {
    expect(choose("9.0.0-alpha.2", "9.0.0-alpha.1")).toEqual({
      kind: "move",
      version: "9.0.0-alpha.1",
    });
    expect(choose("9.0.0-alpha.1", "9.0.0-beta.1")).toEqual({
      kind: "move",
      version: "9.0.0-beta.1",
    });
  });

  it.each(["9.0.0-beta.9", "not-a-version"])(
    "refuses %s, which is not published, naming the installed channel's release whatever channel it names",
    given => {
      expect(choose("9.0.0-alpha.1", given)).toEqual({
        kind: "refused",
        why: { reason: "not-published", given },
        wouldChoose: "9.0.0-alpha.2",
        tags: ALL_TAGS,
      });
    }
  );

  it.each(["9.0.0-beta.9", "not-a-version"])(
    "refuses %s with every tag where no release could be chosen",
    given => {
      expect(choose(undefined, given)).toEqual({
        kind: "refused",
        why: { reason: "not-published", given },
        tags: ALL_TAGS,
      });
    }
  );
});
