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

  it("replaces BOTH of the dependency's exported lookups", () => {
    // A changeset summary carrying `pr: #123` routes through `getInfoFromPullRequest` instead of
    // `getInfo`. Wrapping one door leaves the other unbatched, which is the same oversized
    // document arriving by a route nobody looked at.
    const live = createRequire(import.meta.url)("@changesets/get-github-info");
    expect(live.getInfo).toBe(cachedGetInfo);
    expect(live.getInfoFromPullRequest).toBe(cachedGetInfoFromPullRequest);
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
    // Driven THROUGH the wrapper, because the point is that the eviction RUNS. Seeding a rejected
    // promise into the map and clearing it by hand passes whether or not the eviction exists,
    // which is what the previous version of this test did.
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
