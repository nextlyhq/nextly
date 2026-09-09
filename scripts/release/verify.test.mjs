/**
 * The wait that decides whether a release is complete.
 *
 * `changeset publish` accepts every tarball and returns, and the packages
 * become readable on the packument endpoint some time afterwards. Everything
 * here is about that gap: how long it is worth waiting for, and what must still
 * be reported when the wait ends with packages genuinely absent.
 *
 * The clock and the sleeper are injected, so a budget measured in minutes runs
 * in microseconds and the assertions can be about elapsed time rather than
 * about call counts standing in for it.
 */
import { describe, expect, it } from "vitest";

import { collectProblems, waitForCompleteRelease } from "./lib.mjs";

const VERSION = "0.0.2-alpha.64";

/** A manifest of `count` packages, all at the same version, as `fixed[]` produces. */
function manifestOf(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `@nextlyhq/pkg-${index}`,
    version: VERSION,
  }));
}

/*
 * The `0.0.0` bootstrap placeholder is in every fixture's version list because
 * it is load-bearing rather than leftover: `getExpectedDistTag` treats a package
 * whose versions are ALL prereleases of the active tag as one that should take
 * `latest`, so a fixture listing alphas alone would expect `latest` and describe
 * a package this repository does not have.
 */
const PLACEHOLDER = "0.0.0";
const PREVIOUS = "0.0.2-alpha.62";

/** A registry entry that has the version and points the channel tag at it. */
function live(version = VERSION, tag = "alpha") {
  return {
    versions: [PLACEHOLDER, version],
    distTags: { [tag]: version, latest: PLACEHOLDER },
  };
}

/** A registry entry from before the publish: the previous version only. */
function stale(tag = "alpha") {
  return {
    versions: [PLACEHOLDER, PREVIOUS],
    distTags: { [tag]: PREVIOUS, latest: PLACEHOLDER },
  };
}

const PRE_STATE = { mode: "pre", tag: "alpha" };

/**
 * A fake clock and sleeper. `sleep` advances the clock instead of waiting, so
 * the elapsed time the loop sees is exactly the time it asked for.
 */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async ms => {
      current += ms;
    },
    elapsed: () => current,
  };
}

/**
 * A registry that answers `stale` for the first `settleAfter` polls and `live`
 * from then on, which is the shape of a publish the CDN has not caught up with.
 */
function registrySettlingAfter(settleAfter, manifest) {
  let polls = 0;
  return {
    fetchStates: async () => {
      polls += 1;
      const entry = polls > settleAfter ? live() : stale();
      return new Map(manifest.map(({ name }) => [name, entry]));
    },
    polls: () => polls,
  };
}

describe("waiting for a release to settle on the registry", () => {
  it("keeps asking past the point a 24s budget would have given up", async () => {
    // The measured case. Twenty packages were accepted within one second of
    // each other and the last became readable 186s later, so a wait that ends
    // at 24s reports a complete release as incomplete.
    const manifest = manifestOf(20);
    const clock = fakeClock();
    const registry = registrySettlingAfter(8, manifest);

    const { problems } = await waitForCompleteRelease({
      manifest,
      preState: PRE_STATE,
      fetchStates: registry.fetchStates,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(problems).toEqual([]);
    expect(clock.elapsed()).toBeGreaterThan(24_000);
  });

  it("gives up at a 24s budget on the same registry, which is why the budget moved", async () => {
    // The control for the case above. Without it that test would pass on a loop
    // that never waited at all, because a registry answering `live` on the first
    // poll also returns no problems. This pins the difference to the budget.
    const manifest = manifestOf(20);
    const clock = fakeClock();
    const registry = registrySettlingAfter(8, manifest);

    const { problems } = await waitForCompleteRelease({
      manifest,
      preState: PRE_STATE,
      fetchStates: registry.fetchStates,
      sleep: clock.sleep,
      now: clock.now,
      budgetMs: 24_000,
    });

    expect(problems).not.toEqual([]);
    expect(clock.elapsed()).toBeLessThanOrEqual(24_000);
  });

  it("returns on the first answer when the registry is already caught up", async () => {
    // A release that settles immediately is the common case and must not pay a
    // first delay for the slow one's sake.
    const manifest = manifestOf(3);
    const clock = fakeClock();
    const registry = registrySettlingAfter(0, manifest);

    const { problems, attempts } = await waitForCompleteRelease({
      manifest,
      preState: PRE_STATE,
      fetchStates: registry.fetchStates,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(problems).toEqual([]);
    expect(attempts).toBe(1);
    expect(clock.elapsed()).toBe(0);
  });

  it("still reports a package the registry never receives", async () => {
    // The anti-vacuity control, and the one that matters most: a longer wait
    // must not turn a genuinely failed publish into a pass. This registry never
    // settles, so the budget runs out and the problems survive it.
    const manifest = manifestOf(4);
    const clock = fakeClock();
    const registry = registrySettlingAfter(Number.POSITIVE_INFINITY, manifest);

    const { problems } = await waitForCompleteRelease({
      manifest,
      preState: PRE_STATE,
      fetchStates: registry.fetchStates,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(problems).toHaveLength(4);
    expect(problems[0].reason).toContain(VERSION);
  });

  it("never waits longer than the budget it was given", async () => {
    const manifest = manifestOf(2);
    const clock = fakeClock();
    const registry = registrySettlingAfter(Number.POSITIVE_INFINITY, manifest);

    await waitForCompleteRelease({
      manifest,
      preState: PRE_STATE,
      fetchStates: registry.fetchStates,
      sleep: clock.sleep,
      now: clock.now,
      budgetMs: 70_000,
    });

    expect(clock.elapsed()).toBeLessThanOrEqual(70_000);
  });

  it("backs off up to a cap rather than asking at a fixed interval", async () => {
    // A fixed short interval spends the whole budget on requests; an
    // ever-doubling one overshoots the end of it. The cap is what keeps a long
    // wait to a bounded number of polls without a single long final sleep.
    const manifest = manifestOf(1);
    const clock = fakeClock();
    const waits = [];
    const registry = registrySettlingAfter(Number.POSITIVE_INFINITY, manifest);

    await waitForCompleteRelease({
      manifest,
      preState: PRE_STATE,
      fetchStates: registry.fetchStates,
      sleep: async ms => {
        waits.push(ms);
        await clock.sleep(ms);
      },
      now: clock.now,
      budgetMs: 200_000,
      firstDelayMs: 5_000,
      maxDelayMs: 30_000,
    });

    expect(waits.slice(0, 4)).toEqual([5_000, 10_000, 20_000, 30_000]);
    expect(Math.max(...waits)).toBe(30_000);
  });
});

describe("what counts as an incomplete release", () => {
  it("separates a missing version from a dist-tag that never moved", async () => {
    // The two need different fixes, so they are reported differently: the first
    // is a publish that did not happen, the second a publish that did while
    // `pkg@alpha` still resolves to the release before it.
    const manifest = manifestOf(2);
    const registry = new Map([
      [manifest[0].name, stale()],
      [
        manifest[1].name,
        {
          versions: [PLACEHOLDER, VERSION],
          distTags: { alpha: PREVIOUS, latest: PLACEHOLDER },
        },
      ],
    ]);

    const problems = collectProblems(manifest, registry, PRE_STATE);

    expect(problems).toHaveLength(2);
    expect(problems[0].reason).toContain("not published");
    expect(problems[1].reason).toContain("dist-tag");
  });

  it("reports a package the registry has never heard of", async () => {
    const manifest = manifestOf(1);
    const registry = new Map([[manifest[0].name, null]]);

    expect(collectProblems(manifest, registry, PRE_STATE)).toEqual([
      { name: manifest[0].name, reason: "package not found on registry" },
    ]);
  });

  it("is empty when every package is live on the channel", async () => {
    // The positive control for this group: the three above would all pass
    // against a `collectProblems` that reported a problem for everything.
    const manifest = manifestOf(5);
    const registry = new Map(manifest.map(({ name }) => [name, live()]));

    expect(collectProblems(manifest, registry, PRE_STATE)).toEqual([]);
  });
});
