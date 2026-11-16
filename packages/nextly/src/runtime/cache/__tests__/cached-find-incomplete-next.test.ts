/**
 * A cached read on a deployment missing part of Next.js is served uncached.
 *
 * `next/cache` is loaded through a require no build trace follows, so a host
 * that deploys each function with only its traced files (Vercel) can ship a
 * bundle where `next/cache` is found but a module it requires is not. Reading
 * uncached there still answers the page; failing to load turned every cached
 * read into a 500. Not installed at all is the existing uncached context, and
 * any other failure is still an error.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

import { unstableCacheFrom } from "../cached-find";

/** Node's error for `missing` not being found, as `require` throws it. */
function moduleNotFound(missing: string): Error {
  return Object.assign(
    new Error(
      `Cannot find module '${missing}'\nRequire stack:\n- /var/task/x.js`
    ),
    { code: "MODULE_NOT_FOUND" }
  );
}

const failingWith = (error: Error) => () => {
  throw error;
};

describe("unstableCacheFrom", () => {
  it("hands back Next's unstable_cache when next/cache loads", () => {
    const unstable_cache = () => () => Promise.resolve(undefined);
    expect(unstableCacheFrom(() => ({ unstable_cache }))).toBe(unstable_cache);
  });

  it("reads uncached when a module next/cache requires is missing", () => {
    expect(
      unstableCacheFrom(
        failingWith(
          moduleNotFound("next/dist/server/web/spec-extension/unstable-cache")
        )
      )
    ).toBeNull();
  });

  it("reads uncached where Next.js is not installed", () => {
    expect(
      unstableCacheFrom(failingWith(moduleNotFound("next/cache")))
    ).toBeNull();
  });

  it("rethrows any other failure to load next/cache", () => {
    const broken = new SyntaxError("Unexpected token");
    expect(() => unstableCacheFrom(failingWith(broken))).toThrow(broken);
  });
});
