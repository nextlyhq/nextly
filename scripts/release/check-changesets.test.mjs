import { describe, expect, it } from "vitest";

import {
  checkChangesets,
  declaredReleases,
  groupMatchesWorkspace,
  lockstepPackages,
  pathsToCheck,
  problemsWith,
} from "./check-changesets.mjs";

/** A lockstep group small enough to read, shaped like the real one. */
const CONFIG = JSON.stringify({
  fixed: [["nextly", "@nextlyhq/ui", "@nextlyhq/builder"]],
});
const PACKAGES = lockstepPackages(CONFIG);

/** A changeset naming the given `package: bump` pairs. */
function changeset(pairs, body = "Something changed.") {
  const frontmatter = pairs.map(([name, bump]) => `"${name}": ${bump}`);
  return `---\n${frontmatter.join("\n")}\n---\n\n${body}\n`;
}

const COMPLETE = changeset(PACKAGES.map(name => [name, "patch"]));

describe("reading the group", () => {
  it("flattens the fixed array", () => {
    expect(PACKAGES).toEqual(["nextly", "@nextlyhq/ui", "@nextlyhq/builder"]);
  });

  it("refuses to check anything when the config declares no group", () => {
    // A guard that passes because it found nothing to check is worse than no
    // guard: it reports success on every changeset for as long as the config is
    // broken.
    const problems = checkChangesets(["a.md"], () => COMPLETE, "{}", PACKAGES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no `fixed` group");
  });
});

describe("a complete changeset", () => {
  it("has nothing wrong with it", () => {
    // The control. Without it every assertion below could pass because the check
    // rejects everything.
    expect(problemsWith("a.md", COMPLETE, PACKAGES)).toEqual([]);
  });

  it("does not care what order the packages are in", () => {
    const reordered = changeset(
      [...PACKAGES].reverse().map(name => [name, "patch"])
    );
    expect(problemsWith("a.md", reordered, PACKAGES)).toEqual([]);
  });

  it("accepts the unquoted spelling an unscoped package may use", () => {
    const mixed = `---\nnextly: patch\n"@nextlyhq/ui": patch\n"@nextlyhq/builder": patch\n---\n\nBody.\n`;
    expect(problemsWith("a.md", mixed, PACKAGES)).toEqual([]);
  });
});

describe("the omission this exists for", () => {
  it("names every package that is missing, not just the first", () => {
    // Reporting one at a time turns a frontmatter written against an older group
    // into as many CI rounds as it has gaps.
    const partial = changeset([["nextly", "patch"]]);
    const problems = problemsWith("a.md", partial, PACKAGES);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@nextlyhq/ui");
    expect(problems[0]).toContain("@nextlyhq/builder");
    expect(problems[0]).toContain("missing 2 of 3");
  });

  it("catches the one-package gap a new group member leaves", () => {
    // The exact shape reviewers caught twice: a frontmatter generated from the
    // config BEFORE a package joined the group, so it is complete against the
    // config it was written from and short against the current one.
    const beforeBuilder = changeset([
      ["nextly", "patch"],
      ["@nextlyhq/ui", "patch"],
    ]);
    const problems = problemsWith("a.md", beforeBuilder, PACKAGES);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@nextlyhq/builder");
    expect(problems[0]).not.toContain("@nextlyhq/ui");
  });
});

describe("what else a frontmatter can get wrong", () => {
  it("rejects a package the group does not contain", () => {
    const stale = changeset([
      ...PACKAGES.map(name => [name, "patch"]),
      ["@nextlyhq/departed", "patch"],
    ]);
    const problems = problemsWith("a.md", stale, PACKAGES);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@nextlyhq/departed");
  });

  it("rejects a bump other than patch", () => {
    // The group takes the largest bump in the release, so one `minor` moves every
    // package's version, not just the one it is written beside.
    const minor = changeset([
      ["nextly", "minor"],
      ["@nextlyhq/ui", "patch"],
      ["@nextlyhq/builder", "patch"],
    ]);
    const problems = problemsWith("a.md", minor, PACKAGES);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("nextly: minor");
  });

  it("reports several problems together", () => {
    const bad = changeset([
      ["nextly", "minor"],
      ["@nextlyhq/departed", "patch"],
    ]);
    expect(problemsWith("a.md", bad, PACKAGES)).toHaveLength(3);
  });
});

describe("the group against the workspace", () => {
  it("accepts a group that matches", () => {
    // The control, and the state the repository is in today.
    expect(groupMatchesWorkspace(PACKAGES, [...PACKAGES])).toEqual([]);
  });

  it("catches a package the config was never told about", () => {
    // The drift the config cannot see about itself: a PR adds a package under
    // packages/ and every changeset in it names the old members, so all of them
    // pass while the new package is stranded on the next train.
    const problems = groupMatchesWorkspace(PACKAGES, [
      ...PACKAGES,
      "@nextlyhq/newcomer",
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@nextlyhq/newcomer");
    expect(problems[0]).toContain("missing");
  });

  it("catches a name in the group that no package answers to", () => {
    // A rename or a deletion the config still believes in. Changesets refuses a
    // release on an unknown package in `fixed`.
    const problems = groupMatchesWorkspace(
      [...PACKAGES, "@nextlyhq/departed"],
      [...PACKAGES]
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@nextlyhq/departed");
  });

  it("is asked even when the pull request touches no changeset", () => {
    // The PR that adds a package is often exactly the one with no changeset of
    // its own, so an early return on an empty list would skip the check that
    // matters most.
    const problems = checkChangesets([], () => "", CONFIG, [
      ...PACKAGES,
      "@nextlyhq/newcomer",
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@nextlyhq/newcomer");
  });
});

describe("frontmatter spellings Changesets itself accepts", () => {
  it("reads single-quoted names", () => {
    // Refusing this would block a compliant PR over a spelling the release
    // tooling reads without complaint.
    const single = `---\n'nextly': patch\n'@nextlyhq/ui': patch\n'@nextlyhq/builder': patch\n---\n\nBody.\n`;
    expect(problemsWith("a.md", single, PACKAGES)).toEqual([]);
  });

  it("reads a quoted bump", () => {
    const quotedBump = `---\n"nextly": "patch"\n"@nextlyhq/ui": 'patch'\n"@nextlyhq/builder": patch\n---\n\nBody.\n`;
    expect(problemsWith("a.md", quotedBump, PACKAGES)).toEqual([]);
  });

  it("reads comments, whole-line and trailing", () => {
    const commented = `---\n# why this exists\n"nextly": patch # the core\n"@nextlyhq/ui": patch\n"@nextlyhq/builder": patch\n---\n\nBody.\n`;
    expect(problemsWith("a.md", commented, PACKAGES)).toEqual([]);
  });
});

describe("frontmatter Changesets itself would refuse", () => {
  it("refuses a closing delimiter with anything after it", () => {
    // `---junk` does not close the block, so everything below it is frontmatter
    // as far as Changesets is concerned. A reader that stops at the first three
    // dashes reports the file as complete while the release tooling rejects it.
    const junk = `---\n"nextly": patch\n"@nextlyhq/ui": patch\n"@nextlyhq/builder": patch\n---junk\n\nBody.\n`;
    expect(declaredReleases(junk)).toBeUndefined();
  });

  it("refuses a duplicate key rather than taking the last one", () => {
    // YAML's own answer is last-wins, which would let a compliant-looking
    // `"nextly": patch` sit above a `"nextly": major` that decides the release.
    const duplicated = `---\n"nextly": patch\n"nextly": major\n"@nextlyhq/ui": patch\n"@nextlyhq/builder": patch\n---\n\nBody.\n`;
    expect(declaredReleases(duplicated)).toBeUndefined();
  });

  it("refuses an entry with no bump at all", () => {
    const noBump = `---\n"nextly":\n"@nextlyhq/ui": patch\n"@nextlyhq/builder": patch\n---\n\nBody.\n`;
    expect(declaredReleases(noBump)).toBeUndefined();
  });
});

describe("a file this cannot read", () => {
  it("is reported rather than treated as naming nothing wrong", () => {
    // The failure mode worth naming: a tolerant parser answers "no releases" for
    // a broken frontmatter, and "no releases" and "every release" are opposite
    // answers that a missing-package check would score the same way.
    expect(problemsWith("a.md", "No frontmatter here.\n", PACKAGES)).toEqual([
      expect.stringContaining("frontmatter is missing"),
    ]);
  });

  it("is reported when a line inside the frontmatter is malformed", () => {
    const broken = `---\n"nextly" patch\n---\n\nBody.\n`;
    expect(problemsWith("a.md", broken, PACKAGES)).toEqual([
      expect.stringContaining("cannot read"),
    ]);
  });

  it("reads a frontmatter written with CRLF line endings", () => {
    // A changeset can be authored on Windows, and a check that only splits on
    // `\n` would read `patch\r` as a bump that is not `patch` and reject every
    // one of them.
    const crlf = COMPLETE.replace(/\n/g, "\r\n");
    expect(declaredReleases(crlf)?.get("nextly")).toBe("patch");
    expect(problemsWith("a.md", crlf, PACKAGES)).toEqual([]);
  });
});

describe("where the file list comes from", () => {
  it("prefers arguments when it is given them", () => {
    expect(pathsToCheck(["a.md", "b.md"], "never.md")).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("reads stdin when there are no arguments", () => {
    expect(pathsToCheck([], ".changeset/a.md\n.changeset/b.md\n")).toEqual([
      ".changeset/a.md",
      ".changeset/b.md",
    ]);
  });

  it("reads an empty pipe as nothing to do", () => {
    // The ordinary PR touches no changeset, so the pipe delivers an empty
    // string. Reading that as one path named "" would fail every such build on a
    // file that does not exist.
    expect(pathsToCheck([], "")).toEqual([]);
    expect(pathsToCheck([], "\n")).toEqual([]);
  });

  it("ignores anything that is not a changeset", () => {
    expect(pathsToCheck([], ".changeset/a.md\npackage.json\n")).toEqual([
      ".changeset/a.md",
    ]);
  });
});

describe("what the check is pointed at", () => {
  it("checks every path it is given", () => {
    const files = {
      "good.md": COMPLETE,
      "bad.md": changeset([["nextly", "patch"]]),
    };
    const problems = checkChangesets(
      ["good.md", "bad.md"],
      path => files[path],
      CONFIG,
      PACKAGES
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bad.md");
  });

  it("passes when it is given nothing", () => {
    // The ordinary PR touches no changeset — a test-only or docs-only one gets
    // none at all — and that must not be a failure.
    expect(checkChangesets([], () => "", CONFIG, PACKAGES)).toEqual([]);
  });
});
