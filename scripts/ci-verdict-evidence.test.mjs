// The request layer, with the process runner supplied by the test.
//
// These cover the failures where the TRANSPORT's report and the OPERATION's
// outcome disagree. Both directions exist and they need opposite handling: a
// command that fails announces itself, while a command that SUCCEEDS having
// answered nothing is the dangerous one — its empty result reaches a decision
// function as evidence, and "nobody reviewed this" is indistinguishable from
// "the reviews could not be read".
//
// None of this is reachable by importing a decision function, and reaching it
// through the command means a process per case.

import { describe, expect, it } from "vitest";

import {
  countStranded,
  createGh,
  headRemoteFor,
  readHeadSha,
  setupGitCredentials,
} from "./ci-verdict-evidence.mjs";

/** A runner that records its calls and answers from a queue. */
function runner(answers) {
  const calls = [];
  const exec = (file, args) => {
    calls.push([file, ...args]);
    const answer = answers.shift();
    if (typeof answer === "function") return answer();
    return answer ?? "";
  };
  return { exec, calls };
}

describe("createGh", () => {
  it("inserts the hostname on an api request", () => {
    const { exec, calls } = runner(['{"ok":true}']);
    const gh = createGh({ exec, host: "ghe.example.com" });

    expect(gh(["api", "repos/a/b/pulls/1"])).toEqual({ ok: true });
    expect(calls[0]).toEqual([
      "gh",
      "api",
      "--hostname",
      "ghe.example.com",
      "repos/a/b/pulls/1",
    ]);
  });

  it("leaves a non-api invocation alone", () => {
    // `gh pr view` takes `--repo`, not `--hostname`; inserting one there makes
    // the command fail rather than sending it somewhere else.
    const { exec, calls } = runner(['{"state":"OPEN"}']);
    const gh = createGh({ exec, host: "ghe.example.com" });

    gh(["pr", "view", "1", "--repo", "a/b"]);
    expect(calls[0]).toEqual(["gh", "pr", "view", "1", "--repo", "a/b"]);
  });

  it("throws when the request fails rather than answering empty", () => {
    // The dangerous direction. A rejected request returning `[]` reaches the
    // decision half as "no reviews", which is a verdict rather than a failure
    // to ask — and it is the reassuring one.
    const { exec } = runner([
      () => {
        throw new Error("gh: HTTP 502");
      },
    ]);
    const gh = createGh({ exec, host: "github.com" });

    expect(() => gh(["api", "repos/a/b/pulls/1/reviews"])).toThrow(/502/);
  });

  it("throws when the request succeeds with output it cannot parse", () => {
    // Exit 0 says the command ran, never that it answered. A truncated or
    // warning-prefixed body is a successful process and unusable evidence.
    const { exec } = runner(["not json"]);
    const gh = createGh({ exec, host: "github.com" });

    expect(() => gh(["api", "repos/a/b/pulls/1"])).toThrow();
  });
});

describe("setupGitCredentials", () => {
  it("reports success when the helper is configured", () => {
    const { exec } = runner([""]);
    expect(setupGitCredentials({ exec, host: "github.com" })).toBe(true);
  });

  it("degrades rather than throwing when it cannot be", () => {
    // Deliberately fail-open: unauthenticated public access still works, and a
    // private repository fails later at the ref read with a message naming what
    // it could not reach. Refusing here would block every public run.
    const { exec } = runner([
      () => {
        throw new Error("not logged in");
      },
    ]);
    expect(setupGitCredentials({ exec, host: "github.com" })).toBe(false);
  });
});

describe("headRemoteFor", () => {
  it("uses the base repository for a same-repo pull request", () => {
    expect(
      headRemoteFor(
        { isCrossRepository: false },
        {
          host: "github.com",
          repo: "nextlyhq/nextly",
        }
      )
    ).toBe("https://github.com/nextlyhq/nextly.git");
  });

  it("uses the FORK for a cross-repository pull request", () => {
    // The base repository does not own a contributor's head ref, so reading it
    // from there returns nothing — or an unrelated branch of the same name,
    // and the gate then judges a revision belonging to somebody else.
    expect(
      headRemoteFor(
        {
          isCrossRepository: true,
          headRepositoryOwner: { login: "contributor" },
          headRepository: { name: "nextly" },
        },
        { host: "github.com", repo: "nextlyhq/nextly" }
      )
    ).toBe("https://github.com/contributor/nextly.git");
  });

  it("keeps a fork lookup on the configured host", () => {
    // Hard-coding github.com sends an Enterprise fork lookup to the public
    // host, where it either fails or finds an unrelated repository.
    expect(
      headRemoteFor(
        {
          isCrossRepository: true,
          headRepositoryOwner: { login: "contributor" },
          headRepository: { name: "site" },
        },
        { host: "ghe.example.com", repo: "acme/site" }
      )
    ).toBe("https://ghe.example.com/contributor/site.git");
  });
});

describe("readHeadSha", () => {
  it("takes the object name from the ref line", () => {
    const { exec, calls } = runner(["abc123\trefs/heads/feature/x\n"]);

    expect(
      readHeadSha({ exec, headRemote: "R", headRefName: "feature/x" })
    ).toBe("abc123");
    expect(calls[0]).toEqual(["git", "ls-remote", "R", "refs/heads/feature/x"]);
  });

  it("throws when the ref does not exist", () => {
    // `ls-remote` exits 0 for a ref that is not there, so the success status
    // says only that the question was asked. Taking the first field of an empty
    // line yields `undefined`, and comparing that against the head reports a
    // MOVED head rather than a missing ref — a different verdict, from the same
    // silence.
    const { exec } = runner([""]);

    expect(() =>
      readHeadSha({ exec, headRemote: "R", headRefName: "gone" })
    ).toThrow(/no such ref/);
  });
});

describe("countStranded", () => {
  it("deepens a shallow checkout before counting", () => {
    // A shallow clone keeps its boundary in `.git/shallow`, and fetching two
    // more objects does not remove it — `rev-list` then stops at the boundary
    // and reports a SHORT count, which reads as a clean tail.
    const { exec, calls } = runner(["true\n", "", "3\n"]);

    expect(
      countStranded({ exec, headRemote: "R", mergedHead: "A", head: "B" })
    ).toBe(3);
    expect(calls[1]).toContain("--unshallow");
  });

  it("does not pass --unshallow to a complete repository", () => {
    // `--unshallow` errors on a repository that is not shallow, so passing it
    // unconditionally turns a correct count into a failure to answer.
    const { exec, calls } = runner(["false\n", "", "0\n"]);

    countStranded({ exec, headRemote: "R", mergedHead: "A", head: "B" });
    expect(calls[1]).not.toContain("--unshallow");
  });

  it("reads a non-numeric answer as zero rather than NaN", () => {
    const { exec } = runner(["false\n", "", "\n"]);

    expect(
      countStranded({ exec, headRemote: "R", mergedHead: "A", head: "B" })
    ).toBe(0);
  });
});
