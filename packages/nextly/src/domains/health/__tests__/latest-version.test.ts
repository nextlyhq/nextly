/**
 * The newest-version check: which channel a version compares in, how it
 * compares, and that it never says "latest" without a read that succeeded:
 * the registry failing, timing out, answering an error or a shape it does not
 * know, or naming no tag for the channel, are each "unknown". Kept answers are
 * reused, and a failure is asked again once its window passes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DIST_TAGS_URL,
  compareWithChannel,
  forgetLatestVersion,
  readLatestVersion,
  releaseChannel,
  type LatestVersionDeps,
} from "../latest-version";

afterEach(() => {
  forgetLatestVersion();
});

/** A registry answering `body` with `status`. */
function answering(body: unknown, status = 200): LatestVersionDeps["fetch"] {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  );
}

const TAGS = { latest: "0.0.1", alpha: "0.0.2-alpha.74", beta: "0.0.3-beta.1" };

describe("releaseChannel", () => {
  it("names a prerelease's identifier, and latest for a stable version", () => {
    expect(releaseChannel("0.0.2-alpha.73")).toBe("alpha");
    expect(releaseChannel("1.4.0-beta.2")).toBe("beta");
    expect(releaseChannel("1.4.0")).toBe("latest");
  });

  it("names nothing for what is not a version", () => {
    expect(releaseChannel("0.0.0-1")).toBeUndefined();
    expect(releaseChannel("dev")).toBeUndefined();
  });
});

describe("compareWithChannel", () => {
  it("is latest at the channel's tag, or ahead of it", () => {
    expect(compareWithChannel("0.0.2-alpha.74", TAGS)).toEqual({
      status: "latest",
      version: "0.0.2-alpha.74",
    });
    expect(compareWithChannel("0.0.2-alpha.75", TAGS)).toEqual({
      status: "latest",
      version: "0.0.2-alpha.75",
    });
  });

  it("names the channel's newer release as the update", () => {
    expect(compareWithChannel("0.0.2-alpha.73", TAGS)).toEqual({
      status: "update",
      version: "0.0.2-alpha.74",
    });
    expect(compareWithChannel("0.0.0", TAGS)).toEqual({
      status: "update",
      version: "0.0.1",
    });
  });

  it("never offers another channel's newer release", () => {
    // The beta line is newer, and is not this alpha's channel.
    expect(compareWithChannel("0.0.2-alpha.74", TAGS).status).toBe("latest");
    // A stable site is not moved to a prerelease.
    expect(
      compareWithChannel("0.0.1", { latest: "0.0.1", alpha: "9.0.0-alpha.1" })
    ).toEqual({ status: "latest", version: "0.0.1" });
  });

  it("is unknown when the channel has no tag, or the tag is not a version", () => {
    expect(compareWithChannel("0.0.2-rc.1", TAGS)).toEqual({
      status: "unknown",
    });
    expect(compareWithChannel("0.0.2-alpha.1", { alpha: "soon" })).toEqual({
      status: "unknown",
    });
    expect(compareWithChannel("dev", TAGS)).toEqual({ status: "unknown" });
  });
});

describe("readLatestVersion", () => {
  it("reads the registry's dist-tags and compares in the channel", async () => {
    const fetch = answering(TAGS);
    expect(
      await readLatestVersion("0.0.2-alpha.73", { fetch, now: () => 0 })
    ).toEqual({ status: "update", version: "0.0.2-alpha.74" });
    expect(fetch).toHaveBeenCalledWith(
      DIST_TAGS_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("is unknown when the registry cannot be reached", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    expect(
      await readLatestVersion("0.0.2-alpha.74", { fetch, now: () => 0 })
    ).toEqual({ status: "unknown" });
  });

  it("is unknown when the registry does not answer in time", async () => {
    // A registry that answers only when the read is given up.
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );
    const started = Date.now();
    expect(
      await readLatestVersion("0.0.2-alpha.74", {
        fetch,
        now: () => 0,
        timeoutMs: 20,
      })
    ).toEqual({ status: "unknown" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("is unknown when the registry answers an error or a shape it does not know", async () => {
    expect(
      await readLatestVersion("0.0.2-alpha.74", {
        fetch: answering(TAGS, 503),
        now: () => 0,
      })
    ).toEqual({ status: "unknown" });
    forgetLatestVersion();
    expect(
      await readLatestVersion("0.0.2-alpha.74", {
        fetch: answering({ alpha: 74 }),
        now: () => 0,
      })
    ).toEqual({ status: "unknown" });
  });

  it("keeps an answer, and asks once for callers waiting together", async () => {
    const fetch = answering(TAGS);
    const deps = { fetch, now: () => 1_000 };
    const [first, second] = await Promise.all([
      readLatestVersion("0.0.2-alpha.74", deps),
      readLatestVersion("0.0.2-alpha.74", deps),
    ]);
    expect(first).toEqual(second);
    await readLatestVersion("0.0.2-alpha.74", deps);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks again once a failure's window has passed", async () => {
    let now = 0;
    const failing = vi.fn(() => Promise.reject(new TypeError("offline")));
    expect(
      await readLatestVersion("0.0.2-alpha.74", {
        fetch: failing,
        now: () => now,
      })
    ).toEqual({ status: "unknown" });

    const working = answering(TAGS);
    // Within the window, the failure is kept.
    now = 60_000;
    expect(
      (
        await readLatestVersion("0.0.2-alpha.74", {
          fetch: working,
          now: () => now,
        })
      ).status
    ).toBe("unknown");
    expect(working).not.toHaveBeenCalled();
    // Past it, the registry is read again.
    now = 11 * 60_000;
    expect(
      await readLatestVersion("0.0.2-alpha.74", {
        fetch: working,
        now: () => now,
      })
    ).toEqual({ status: "latest", version: "0.0.2-alpha.74" });
  });
});
