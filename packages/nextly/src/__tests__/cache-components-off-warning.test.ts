/**
 * The start-time check for an app with Cache Components or Partial
 * Prefetching off, the state Nextly does not support. It names each option it
 * finds off, checks only the options its caller can see, and says each one
 * once per process, however often Next.js loads the config or runs
 * `register()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../observability/logger";
import {
  cacheComponentsOffWarning,
  cacheComponentsOptionsOff,
  flushQueuedCacheComponentsWarnings,
  QUEUED_WARNING_WAIT_MS,
  warnIfCacheComponentsOff,
  warnIfRegisteredWithCacheComponentsOff,
} from "../cache-components";

/** The process-wide record of what was said, as the module keeps it. */
const WARNED = Symbol.for("nextly/cache-components-off-warned");
/** The lines waiting for an app logger. */
const QUEUED = Symbol.for("nextly/cache-components-queued-warnings");
const forgetQueue = () => {
  flushQueuedCacheComponentsWarnings();
  delete (globalThis as Record<symbol, unknown>)[QUEUED];
};

const warn = vi.fn();
beforeEach(() => {
  forgetQueue();
  delete (globalThis as Record<symbol, unknown>)[WARNED];
  warn.mockReset();
  const ignore = () => undefined;
  setNextlyLogger({ warn, error: ignore, info: ignore, debug: ignore });
});
afterEach(() => {
  vi.useRealTimers();
  forgetQueue();
  setNextlyLogger(undefined);
  delete (globalThis as Record<symbol, unknown>)[WARNED];
});

/** Every warning said so far, through nextly's logger. */
const entries = () =>
  warn.mock.calls.map(call => call[0] as { kind: string; message: string });
/** Their messages, one per warning. */
const warned = () => entries().map(entry => entry.message);

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
    // Its own kind, apart from the cache handlers' warning, which it leaves
    // to that warning to name.
    expect(entries()[0].kind).toBe("cache-components-off");
    expect(warned()[0]).not.toMatch(/cache handlers?/i);
  });

  it("names both in one line when both are off", () => {
    expect(
      cacheComponentsOffWarning(
        ["cacheComponents", "partialPrefetching"],
        "this next.config"
      )
    ).toMatch(
      /^`cacheComponents` and `partialPrefetching` are off in this next\.config\./
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

describe("a line said while Next.js loads the config", () => {
  /** Next.js loading the config, before `instrumentation.ts` has run. */
  const loadConfig = () => {
    setNextlyLogger(undefined);
    warnIfCacheComponentsOff(
      { cacheComponents: false, partialPrefetching: false },
      "this next.config"
    );
  };
  const printed = () => {
    const console = vi.spyOn(globalThis.console, "warn");
    console.mockImplementation(() => {});
    return console;
  };

  it("reaches the app's logger, installed afterwards, once and only there", () => {
    const stdout = printed();
    loadConfig();
    expect(stdout).not.toHaveBeenCalled();

    const appWarn = vi.fn();
    const ignore = () => undefined;
    setNextlyLogger({
      warn: appWarn,
      error: ignore,
      info: ignore,
      debug: ignore,
    });

    expect(appWarn).toHaveBeenCalledTimes(1);
    expect(appWarn.mock.calls[0][0]).toMatchObject({
      kind: "cache-components-off",
    });
    expect(stdout).not.toHaveBeenCalled();
    // Sent once: a later install says nothing again.
    setNextlyLogger({
      warn: appWarn,
      error: ignore,
      info: ignore,
      debug: ignore,
    });
    expect(appWarn).toHaveBeenCalledTimes(1);
    stdout.mockRestore();
  });

  it("still reaches the default logger in a process that installs none", () => {
    vi.useFakeTimers();
    const stdout = printed();
    loadConfig();
    vi.advanceTimersByTime(QUEUED_WARNING_WAIT_MS - 1);
    expect(stdout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(String(stdout.mock.calls[0][0])).toContain(
      '"kind":"cache-components-off"'
    );
    stdout.mockRestore();
  });

  it("goes out when register() runs, before register()'s own line, and at the process's exit", () => {
    const stdout = printed();
    // Only `partialPrefetching` off, so register() still has a line of its own.
    setNextlyLogger(undefined);
    warnIfCacheComponentsOff(
      { cacheComponents: true, partialPrefetching: false },
      "this next.config"
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(process.listeners("exit")).toContain(
      flushQueuedCacheComponentsWarnings
    );

    warnIfRegisteredWithCacheComponentsOff(undefined);

    const kinds = stdout.mock.calls.map(
      call => JSON.parse(String(call[0])).kind
    );
    expect(kinds).toEqual(["cache-components-off", "cache-components-unknown"]);
    stdout.mockRestore();
  });

  it("goes out when register() runs even where register() has nothing new to say", () => {
    const stdout = printed();
    loadConfig();
    // The build says Cache Components is off too: already said, so register()
    // adds no line of its own, and must still send the one that waited.
    warnIfRegisteredWithCacheComponentsOff("false");

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0][0])).kind).toBe(
      "cache-components-off"
    );
    stdout.mockRestore();
  });
});
