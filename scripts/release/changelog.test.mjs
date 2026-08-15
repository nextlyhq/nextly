import { describe, expect, it } from "vitest";

import { createRequire } from "node:module";

// Loaded with `require`, because that is how `apply-release-plan` reads it. An ESM import goes
// through the runner's CJS interop, which unwraps `default` differently from Node's - so a test
// written against the import would be asserting the test runner's behaviour rather than the shape
// the release actually sees.
const changelog = createRequire(import.meta.url)("./changelog.cjs");

const { oneAtATime, cachedGetInfo, byCommit } = changelog;

describe("the getInfo cache", () => {
  it("replaces the dependency's exported lookup", async () => {
    // The wrap works because `changelog-github` reaches its dependency through a namespace
    // property at CALL time rather than capturing the function at import. If that ever changes,
    // every lookup goes back to the unbatched original and the release fails the way it used to -
    // so the replacement itself is pinned.
    const live = createRequire(import.meta.url)("@changesets/get-github-info");
    expect(live.getInfo).toBe(cachedGetInfo);
  });

  it("returns the SAME promise for a repeated commit", async () => {
    // What memoisation means here, asserted without a network call: a second ask reuses the first
    // lookup rather than starting another. `DataLoader` cannot collapse these itself - it is
    // handed a freshly built object every call, so its cache key is never `===` to a previous
    // one, and four identical lookups each cost a full round trip when measured.
    //
    // The key is read back from the map rather than spelled again here. Writing it out twice is
    // the same duplication this repository has a rule about, and the separator is a control
    // character that does not survive being retyped.
    byCommit.clear();
    const seeded = Promise.resolve({ links: { commit: "x" } });
    const first = cachedGetInfo({ repo: "owner/repo", commit: "abc" });
    const key = [...byCommit.keys()][0];
    byCommit.set(key, seeded);

    expect(cachedGetInfo({ repo: "owner/repo", commit: "abc" })).toBe(seeded);
    expect(byCommit.size).toBe(1);
    await first.catch(() => undefined);
  });

  it("keys on the repo as well as the commit", () => {
    // Two repositories can carry the same commit id, and their links differ.
    byCommit.clear();
    cachedGetInfo({ repo: "owner/repo", commit: "abc" }).catch(() => undefined);
    cachedGetInfo({ repo: "other/repo", commit: "abc" }).catch(() => undefined);
    expect(byCommit.size).toBe(2);
  });

  it("does not cache a rejection", async () => {
    // A cached failure would be a permanent hole in the changelog for that commit, for the rest
    // of the run, from one transient error.
    byCommit.clear();
    byCommit.set("owner/repo bad", Promise.reject(new Error("boom")));
    await expect(byCommit.get("owner/repo bad")).rejects.toThrow("boom");
    byCommit.clear();
    expect(byCommit.size).toBe(0);
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
