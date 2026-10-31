/**
 * The start-time check for an app with Cache Components or Partial
 * Prefetching off, the state Nextly does not support. It names each option it
 * finds off, checks only the options its caller can see, and says each one
 * once per process, however often Next.js loads the config or runs
 * `register()`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  cacheComponentsOffWarning,
  cacheComponentsOptionsOff,
  warnIfCacheComponentsOff,
} from "../cache-components";

/** The process-wide record of what was said, as the module keeps it. */
const WARNED = Symbol.for("nextly/cache-components-off-warned");

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[WARNED];
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  delete (globalThis as Record<symbol, unknown>)[WARNED];
});

/** Every warning printed so far, one per line. */
const warned = () => warn.mock.calls.map(call => String(call[0]));

describe("which options are off", () => {
  it('finds an option set false, or unset, off; true or Next.js\'s inlined "true" on', () => {
    expect(
      cacheComponentsOptionsOff({
        cacheComponents: false,
        partialPrefetching: undefined,
      })
    ).toEqual(["cacheComponents", "partialPrefetching"]);
    expect(cacheComponentsOptionsOff({ cacheComponents: "false" })).toEqual([
      "cacheComponents",
    ]);
    expect(
      cacheComponentsOptionsOff({
        cacheComponents: true,
        partialPrefetching: true,
      })
    ).toEqual([]);
    expect(cacheComponentsOptionsOff({ cacheComponents: "true" })).toEqual([]);
  });

  it("names only the one that is off when the other is on", () => {
    expect(
      cacheComponentsOptionsOff({
        cacheComponents: true,
        partialPrefetching: false,
      })
    ).toEqual(["partialPrefetching"]);
  });

  // `register()` cannot see `partialPrefetching`, so it passes only
  // `cacheComponents`; reading the missing key as off would warn every app.
  it("does not check an option its caller cannot see", () => {
    expect(cacheComponentsOptionsOff({ cacheComponents: true })).toEqual([]);
    expect(cacheComponentsOptionsOff({})).toEqual([]);
  });
});

describe("the start-time warning", () => {
  it("names the option, says Nextly supports only the on state, and links the settings", () => {
    warnIfCacheComponentsOff({ cacheComponents: "false" }, "this build");
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toMatch(
      /`cacheComponents` is off in this build\. Nextly supports only Cache Components and Partial Prefetching on.*cacheComponents: true.*partialPrefetching: true.*nextlyhq\.com\/docs\/getting-started\/installation#cache-components/
    );
    expect(warned()[0]).not.toMatch(/`partialPrefetching` is/);
  });

  it("names both in one line when both are off", () => {
    expect(
      cacheComponentsOffWarning(
        ["cacheComponents", "partialPrefetching"],
        "this next.config"
      )
    ).toMatch(
      /^\[Nextly\] `cacheComponents` and `partialPrefetching` are off in this next\.config\./
    );
  });

  it("says nothing when every option it can see is on", () => {
    warnIfCacheComponentsOff(
      { cacheComponents: true, partialPrefetching: true },
      "this next.config"
    );
    warnIfCacheComponentsOff({ cacheComponents: "true" }, "this build");
    expect(warned()).toEqual([]);
  });

  it("says each option once per process, however many times it is checked", () => {
    for (let i = 0; i < 3; i++) {
      warnIfCacheComponentsOff({ cacheComponents: false }, "this build");
    }
    expect(warned()).toHaveLength(1);

    // An option not yet said is still said, and only it is named.
    warnIfCacheComponentsOff(
      { cacheComponents: false, partialPrefetching: false },
      "this next.config"
    );
    expect(warned()).toHaveLength(2);
    expect(warned()[1]).toMatch(/`partialPrefetching` is off/);
    expect(warned()[1]).not.toMatch(/`cacheComponents`/);
  });
});
