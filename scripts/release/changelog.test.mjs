import { describe, expect, it } from "vitest";

import { createRequire } from "node:module";

// Loaded with `require`, because that is how `apply-release-plan` reads it. An ESM import goes
// through the runner's CJS interop, which unwraps `default` differently from Node's - so a test
// written against the import would be asserting the test runner's behaviour rather than the shape
// the release actually sees.
const changelog = createRequire(import.meta.url)("./changelog.cjs");

const { oneAtATime, cachedGetInfo, cachedGetInfoFromPullRequest, byCommit, byPullRequest, upstream } = changelog;

describe("the lookup cache", () => {
  /**
   * Swap the real network call for a stub, and put it back.
   *
   * `async`, and it AWAITS: a synchronous `finally` restores the real function the moment `run`
   * returns its promise, so the awaited work would run against the real lookup and the suite
   * would become network-dependent - the state this helper exists to prevent.
   */
  async function withStub(name, impl, run) {
    const real = upstream[name];
    upstream[name] = impl;
    try {
      return await run();
    } finally {
      upstream[name] = real;
    }
  }

  it("routes the DELEGATED changelog call through the wrapper", async () => {
    // Asserted by invoking `getReleaseLine`, not by comparing the dependency's exported property.
    // A property comparison passes even if the generator captured the function during its own
    // initialisation, or resolves a separate copy of the dependency under pnpm's isolated layout -
    // and in both of those cases the delegated call bypasses the cache and rebuilds the oversized
    // batch. Only reaching the stub through the real path rules that out.
    byCommit.clear();
    let calls = 0;
    const line = await withStub(
      "getInfo",
      async () => ((calls += 1), { links: { commit: "[`abc`](c)", pull: "[#1](p)", user: "[@u](x)" } }),
      () =>
        changelog.getReleaseLine(
          { summary: "a change", commit: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" },
          "patch",
          { repo: "owner/repo" }
        )
    );
    expect(calls).toBe(1);
    expect(line).toContain("a change");
  });

  it("routes a pull-request summary through the other wrapper", async () => {
    // `pr: #123` in the summary selects `getInfoFromPullRequest`, so this is the second entry
    // point reached through the same delegated call.
    byPullRequest.clear();
    let calls = 0;
    await withStub(
      "getInfoFromPullRequest",
      async () => ((calls += 1), { links: { commit: "[`abc`](c)", pull: "[#123](p)", user: "[@u](x)" } }),
      () =>
        changelog.getReleaseLine({ summary: "pr: #123\na change" }, "patch", {
          repo: "owner/repo",
        })
    );
    expect(calls).toBe(1);
  });

  it("asks the real lookup once for a repeated commit", async () => {
    // Counted THROUGH the wrapper, so memoisation is what is observed. `DataLoader` cannot
    // collapse these itself - it is handed a freshly built object every call, so its key is never
    // `===` to a previous one.
    byCommit.clear();
    let calls = 0;
    await withStub("getInfo", async () => ((calls += 1), { links: { commit: "x" } }), async () => {
      await cachedGetInfo({ repo: "owner/repo", commit: "abc" });
      await cachedGetInfo({ repo: "owner/repo", commit: "abc" });
      await cachedGetInfo({ repo: "owner/repo", commit: "abc" });
    });
    expect(calls).toBe(1);
  });

  it("keys on the repo as well as the commit", async () => {
    // Two repositories can carry the same commit id, and their links differ.
    byCommit.clear();
    let calls = 0;
    await withStub("getInfo", async () => ((calls += 1), { links: {} }), async () => {
      await cachedGetInfo({ repo: "owner/repo", commit: "abc" });
      await cachedGetInfo({ repo: "other/repo", commit: "abc" });
    });
    expect(calls).toBe(2);
  });

  it("memoises pull-request lookups on their own key", async () => {
    byPullRequest.clear();
    let calls = 0;
    await withStub("getInfoFromPullRequest", async () => ((calls += 1), { links: {} }), async () => {
      await cachedGetInfoFromPullRequest({ repo: "owner/repo", pull: 12 });
      await cachedGetInfoFromPullRequest({ repo: "owner/repo", pull: 12 });
      await cachedGetInfoFromPullRequest({ repo: "owner/repo", pull: 13 });
    });
    expect(calls).toBe(2);
  });

  it("evicts a rejection so a retry can succeed", async () => {
    // Driven THROUGH the wrapper, because the eviction is what has to run. Manipulating the map
    // directly would assert the setup rather than the code: seeding a rejected entry and removing
    // it by hand passes identically whether or not the eviction at the catch exists.
    byCommit.clear();
    let calls = 0;
    await withStub(
      "getInfo",
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { links: { commit: "second" } };
      },
      async () => {
        await expect(cachedGetInfo({ repo: "owner/repo", commit: "abc" })).rejects.toThrow(
          "transient"
        );
        // A cached failure would be a permanent hole in the changelog for that commit.
        await expect(cachedGetInfo({ repo: "owner/repo", commit: "abc" })).resolves.toEqual({
          links: { commit: "second" },
        });
      }
    );
    expect(calls).toBe(2);
  });
});

describe("the delegated output", () => {
  // Stubbed links, so these assert the SHAPE this module emits rather than GitHub's availability.
  const links = {
    commit: "[`abc1234`](https://github.com/owner/repo/commit/abc1234)",
    pull: "[#123](https://github.com/owner/repo/pull/123)",
    user: "[@someone](https://github.com/someone)",
  };

  async function withInfo(run, override = links) {
    const real = upstream.getInfo;
    upstream.getInfo = async () => ({ links: override });
    byCommit.clear();
    try {
      return await run();
    } finally {
      upstream.getInfo = real;
    }
  }

  const releaseLine = (changeset, override) =>
    withInfo(
      () => changelog.getReleaseLine(changeset, "patch", { repo: "owner/repo" }),
      override
    );

  it("carries the pull-request link, the commit link and the attribution", async () => {
    // The three things this module exists to preserve. A regression that silently drops any of
    // them produces a changelog that still looks plausible.
    const line = await releaseLine({
      summary: "a change",
      commit: "abc1234abc1234abc1234abc1234abc1234abc1",
    });
    expect(line).toContain("[#123]");
    expect(line).toContain("[`abc1234`]");
    expect(line).toContain("Thanks [@someone]");
    expect(line).toContain("a change");
  });

  it("omits the attribution when the lookup reports no user", async () => {
    // The negative half: the assertion above must be satisfied by the user actually being there,
    // not by the phrase appearing whatever the lookup returned.
    const line = await releaseLine(
      { summary: "a change", commit: "abc1234abc1234abc1234abc1234abc1234abc1" },
      { commit: links.commit, pull: links.pull, user: null }
    );
    expect(line).not.toContain("Thanks");
    expect(line).toContain("[#123]");
  });

  it("still produces a line when the changeset has no commit", async () => {
    // A changeset added but not yet committed. It must still appear, without links.
    const line = await releaseLine({ summary: "uncommitted" });
    expect(line).toContain("uncommitted");
  });

  it("keeps a multiline summary's shape", async () => {
    const line = await releaseLine({ summary: "first line\nsecond line" });
    expect(line).toContain("first line");
    expect(line).toContain("second line");
  });

  it("nests the updated packages under one dependency bullet", async () => {
    // Markdown attaches a nested list to the preceding bullet, so the package versions must sit
    // under a single `Updated dependencies` entry rather than trailing a run of empty ones.
    const out = await withInfo(() =>
      changelog.getDependencyReleaseLine(
        [{ commit: "abc1234abc1234abc1234abc1234abc1234abc1" }],
        [{ name: "@nextlyhq/ui", newVersion: "0.0.2-alpha.58" }],
        { repo: "owner/repo" }
      )
    );
    expect(out.split("\n").filter(line => line.startsWith("- "))).toHaveLength(1);
    expect(out).toContain("  - @nextlyhq/ui@0.0.2-alpha.58");
  });

  it("returns nothing when no dependency moved", async () => {
    const out = await withInfo(() =>
      changelog.getDependencyReleaseLine([], [], { repo: "owner/repo" })
    );
    expect(out).toBe("");
  });
});

describe("oneAtATime", () => {
  it("never runs two pieces of work concurrently", async () => {
    // THE property this module exists for. `apply-release-plan` starts every lookup in one
    // synchronous loop, so without this they share a tick and `DataLoader` batches them into a
    // single GraphQL document - the one GitHub refuses to validate. Overlap here means the
    // batching is back, whatever the rest of the file says.
    let running = 0;
    let peak = 0;
    const work = () =>
      oneAtATime(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise(resolve => setTimeout(resolve, 5));
        running -= 1;
      });

    await Promise.all([work(), work(), work(), work()]);

    expect(peak).toBe(1);
  });

  it("preserves the order it was asked in", async () => {
    const seen = [];
    await Promise.all(["a", "b", "c"].map(id => oneAtATime(async () => void seen.push(id))));
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("does not let one failure strand the work behind it", async () => {
    // A single unreachable commit must not leave every later lookup hanging or rejecting.
    // Without the chain absorbing rejections, one failure poisons every continuation on it.
    await expect(
      oneAtATime(async () => {
        throw new Error("lookup failed");
      })
    ).rejects.toThrow("lookup failed");

    await expect(oneAtATime(async () => "after")).resolves.toBe("after");
  });

  it("reports the failure to ITS caller rather than swallowing it", async () => {
    // The chain is protected; the returned promise is not. A caller that needs to know still does.
    await expect(
      oneAtATime(async () => {
        throw new Error("visible");
      })
    ).rejects.toThrow("visible");
  });
});

describe("the changelog contract", () => {
  it("exports the two functions changesets calls", () => {
    // Looked up by name at release time, so a rename fails at the point of use rather than at
    // import. Pinned here instead.
    expect(typeof changelog.getReleaseLine).toBe("function");
    expect(typeof changelog.getDependencyReleaseLine).toBe("function");
  });

  it("carries a default that is the module itself", () => {
    // `apply-release-plan` accepts either shape from its interop, so both are pinned; a change to
    // that interop cannot silently fall through to an undefined function.
    expect(changelog.default).toBe(changelog);
    expect(typeof changelog.default.getReleaseLine).toBe("function");
  });
});
