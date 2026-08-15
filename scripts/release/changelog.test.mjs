import { describe, expect, it } from "vitest";

import changelog from "./changelog.cjs";

const { pullRequestFor, releaseLine } = changelog;
const changelogFunctions = changelog;

const REPO = "nextlyhq/nextly";
const COMMIT = "a0e2817a2f1c4d5e6b7a8c9d0e1f2a3b4c5d6e7f";

/** A stand-in for the real `git log` map, so these assert formatting rather than this checkout. */
const subjects = new Map([
  [COMMIT, "fix(ui): make one control size name mean one control height (#833)"],
  ["b".repeat(40), "chore: a commit that arrived without a pull request"],
  ["d".repeat(40), "Merge pull request #783 from nextlyhq/fix/blog-template-builds"],
]);

describe("pullRequestFor", () => {
  it("reads the number a squash subject ends with", () => {
    expect(pullRequestFor(COMMIT, subjects)).toBe("833");
  });

  it("returns null for a subject that names no pull request", () => {
    // A direct push is not an error and must still produce a changelog entry.
    expect(pullRequestFor("b".repeat(40), subjects)).toBe(null);
  });

  it("returns null for a commit this checkout does not have", () => {
    // A shallow clone reaches here. Degrading to no link is correct; failing is not.
    expect(pullRequestFor("c".repeat(40), subjects)).toBe(null);
  });

  it("reads the number a merge commit names", () => {
    // The other shape that identifies a pull request in the commit ITSELF. 118 of 560
    // changeset-adding commits in this history carry no `(#N)` suffix, and a merge commit is the
    // one remaining case where the answer is present rather than inferred.
    expect(pullRequestFor("d".repeat(40), subjects)).toBe("783");
  });

  it("does not read a number from the middle of a subject", () => {
    // `(#12)` mid-sentence is prose about an issue, not the merge's own number. Anchoring to the
    // end is what separates them, and without this the link would point somewhere arbitrary.
    const middle = new Map([[COMMIT, "fix: handle (#12) in the parser correctly"]]);
    expect(pullRequestFor(COMMIT, middle)).toBe(null);
  });
});

describe("releaseLine", () => {
  it("links the commit and the pull request", () => {
    const line = releaseLine({ summary: "do the thing", commit: COMMIT }, REPO, subjects);
    expect(line).toBe(
      `- [\`a0e2817\`](https://github.com/${REPO}/commit/${COMMIT})` +
        ` [#833](https://github.com/${REPO}/pull/833) - do the thing`
    );
  });

  it("links only the commit when no pull request is named", () => {
    const line = releaseLine({ summary: "do the thing", commit: "b".repeat(40) }, REPO, subjects);
    expect(line).toContain("/commit/");
    expect(line).not.toContain("/pull/");
    expect(line).toContain("- do the thing");
  });

  it("emits the summary alone when there is no commit", () => {
    // What a changeset added but not yet committed looks like, and what a failed git read
    // degrades every entry to.
    expect(releaseLine({ summary: "do the thing" }, REPO, subjects)).toBe("- do the thing");
  });

  it("keeps a multi-line summary indented under the bullet", () => {
    const line = releaseLine({ summary: "first line\nsecond line", commit: undefined }, REPO, subjects);
    expect(line).toBe("- first line\n  second line");
  });

  it("trims trailing whitespace from every line", () => {
    expect(releaseLine({ summary: "first  \nsecond\t" }, REPO, subjects)).toBe("- first\n  second");
  });
});

describe("the changelog contract", () => {
  it("exports the two functions changesets calls", () => {
    // Named exactly as `changeset version` looks them up. A rename here fails the release at the
    // point of use rather than at import, so it is pinned.
    expect(typeof changelogFunctions.getReleaseLine).toBe("function");
    expect(typeof changelogFunctions.getDependencyReleaseLine).toBe("function");
  });

  it("returns an empty string when nothing was updated", async () => {
    expect(await changelogFunctions.getDependencyReleaseLine([], [], { repo: REPO })).toBe("");
  });

  it("lists each updated dependency under the commits that moved it", async () => {
    const out = await changelogFunctions.getDependencyReleaseLine(
      [{ commit: COMMIT }],
      [{ name: "@nextlyhq/ui", newVersion: "0.0.2-alpha.42" }],
      { repo: REPO }
    );
    expect(out).toContain("Updated dependencies");
    expect(out).toContain("  - @nextlyhq/ui@0.0.2-alpha.42");
  });

  it("emits ONE bullet with the packages nested under it", async () => {
    // Markdown attaches a nested list to the LAST bullet, so a bullet per changeset leaves every
    // earlier one empty. With a lockstep group that is the normal shape, not a corner case.
    const out = await changelogFunctions.getDependencyReleaseLine(
      [{ commit: COMMIT }, { commit: "b".repeat(40) }],
      [{ name: "@nextlyhq/ui", newVersion: "0.0.2-alpha.42" }],
      { repo: REPO }
    );
    expect(out.split("\n").filter(line => line.startsWith("- "))).toHaveLength(1);
    expect(out).toContain("  - @nextlyhq/ui@0.0.2-alpha.42");
  });

  it("names every contributing commit in that one bullet", async () => {
    const out = await changelogFunctions.getDependencyReleaseLine(
      [{ commit: COMMIT }, { commit: "b".repeat(40) }],
      [{ name: "@nextlyhq/ui", newVersion: "0.0.2-alpha.42" }],
      { repo: REPO }
    );
    expect(out).toContain(COMMIT.slice(0, 7));
    expect(out).toContain("b".repeat(7));
  });

  it("makes NO network call", async () => {
    // The property this module exists for. `changelog-github` reaches api.github.com here, and at
    // this repository's changeset count GitHub refuses to validate the query it builds.
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("changelog generation must not perform network requests");
    };
    try {
      await expect(
        changelogFunctions.getReleaseLine({ summary: "s", commit: COMMIT }, "patch", { repo: REPO })
      ).resolves.toContain("- ");
    } finally {
      globalThis.fetch = original;
    }
  });
});
