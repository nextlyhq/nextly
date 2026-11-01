/**
 * Nextly and an app's Next.js Cache Components setting. Nextly supports only
 * Cache Components and Partial Prefetching on, so `withNextly()` warns about a
 * config with either off, and `createRegister()` about a build its
 * `instrumentation.ts` reports with Cache Components off. What
 * `createRegister()` is told is also kept for the cached reads, so a read under
 * Cache Components that finds no `"use cache"` read function registered says
 * so, once.
 *
 * Both values Nextly reads from Next.js are undocumented internals, so the
 * last cases pin them to the installed Next.js: the name it inlines the
 * setting under, and the phrase it refuses a `"use cache"` call outside App
 * Router with. A release that renames either fails here, loudly, instead of
 * the warning going quiet or a background read failing.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { createRegister, shutdownNextly } from "../init";
import { withNextly } from "../next";
import * as logger from "../observability/logger";
import { applyCache, type UnstableCache } from "../runtime/cache/cached-find";
import { recordCacheComponents } from "../runtime/cache/registered-read";

/** The start-time check's once-per-process record, cleared so each case starts fresh. */
const WARNED = Symbol.for("nextly/cache-components-off-warned");
const forgetWarnings = () => {
  delete (globalThis as Record<symbol, unknown>)[WARNED];
};

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  forgetWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  recordCacheComponents(false);
  forgetWarnings();
  vi.restoreAllMocks();
});

/** The start-time warning, for the options it names. */
const OFF =
  /is off in .*Nextly supports only Cache Components and Partial Prefetching on/;

/** Every warning printed so far, as one string. */
const warned = () => warn.mock.calls.map(call => String(call[0])).join("\n");

describe("withNextly and Cache Components", () => {
  it("takes a config with both options on without a warning", () => {
    const wrapped = withNextly<Record<string, unknown>>({
      cacheComponents: true,
      partialPrefetching: true,
    });
    expect(warned()).not.toMatch(/Cache Components/);
    expect(wrapped.cacheComponents).toBe(true);
    expect(wrapped.serverExternalPackages).toContain("nextly");
  });

  it("warns about a config with either option off or unset, naming it, and still wraps it", () => {
    const wrapped = withNextly<Record<string, unknown>>({
      cacheComponents: true,
      partialPrefetching: false,
    });
    expect(warned()).toMatch(OFF);
    expect(warned()).toMatch(
      /`partialPrefetching` is off in this next\.config/
    );
    expect(wrapped.serverExternalPackages).toContain("nextly");

    forgetWarnings();
    warn.mockClear();
    withNextly({});
    expect(warned()).toMatch(
      /`cacheComponents` and `partialPrefetching` are off in this next\.config/
    );
  });
});

describe("createRegister and Cache Components", () => {
  const config = {} as SanitizedNextlyConfig;
  const passthrough: UnstableCache = cb => cb;
  const read = () =>
    applyCache(passthrough, async () => "row", {
      tags: ["nextly:posts"],
      keyParts: ["posts", "x"],
    });
  function spyNextlyWarn() {
    const nextlyWarn = vi.fn();
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn: nextlyWarn,
      info: vi.fn(),
      debug: vi.fn(),
    } as never);
    return nextlyWarn;
  }
  afterAll(async () => {
    await shutdownNextly();
  });

  it("starts without a warning when Next.js inlined Cache Components as on, and the first read without a read function says so", async () => {
    await createRegister(config, { cacheComponents: "true" })();
    expect(warned()).not.toMatch(/Cache Components/);
    const nextlyWarn = spyNextlyWarn();
    await expect(read()).resolves.toBe("row");
    expect(nextlyWarn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cached-read-missing" })
    );
  });

  it("warns at start, naming the option, when Next.js inlined it as off, and says nothing at a read", async () => {
    await createRegister(config, { cacheComponents: "false" })();
    expect(warned()).toMatch(OFF);
    expect(warned()).toMatch(/`cacheComponents` is off/);
    // `register()` cannot see `partialPrefetching`, so it never names it.
    expect(warned()).not.toMatch(/`partialPrefetching`/);
    const nextlyWarn = spyNextlyWarn();
    await read();
    expect(nextlyWarn).not.toHaveBeenCalled();
  });

  // An app may have Cache Components on and a hook that passes nothing:
  // Nextly says it cannot tell, rather than calling the option off.
  it("says it cannot tell, and how to pass the value, when the hook passed nothing", async () => {
    await createRegister(config)();
    expect(warned()).toMatch(
      /createRegister\(\) was not passed the app's `cacheComponents` value, so Nextly cannot tell whether Cache Components is on\. Pass `\{ cacheComponents: process\.env\.__NEXT_CACHE_COMPONENTS \}`/
    );
    expect(warned()).not.toMatch(/is off/);
  });

  it("warns once, however many times the server registers", async () => {
    await createRegister(config, { cacheComponents: "false" })();
    await createRegister(config, { cacheComponents: "false" })();
    expect(
      warn.mock.calls.filter(call => OFF.test(String(call[0])))
    ).toHaveLength(1);
  });
});

describe("the value Next.js inlines for Cache Components", () => {
  it("is still `process.env.__NEXT_CACHE_COMPONENTS` in the installed Next.js", () => {
    const require = createRequire(import.meta.url);
    const next = dirname(require.resolve("next/package.json"));
    const defineEnv = readFileSync(
      join(next, "dist", "build", "define-env.js"),
      "utf8"
    );
    expect(defineEnv).toContain(
      "'process.env.__NEXT_CACHE_COMPONENTS': isCacheComponentsEnabled"
    );
  });
});

describe('Next.js refusing a "use cache" call outside App Router', () => {
  it('still says `"use cache" cannot be used outside of App Router` in the installed Next.js, for both missing stores', () => {
    const require = createRequire(import.meta.url);
    const next = dirname(require.resolve("next/package.json"));
    const wrapper = readFileSync(
      join(next, "dist", "server", "use-cache", "use-cache-wrapper.js"),
      "utf8"
    );
    expect(wrapper).toContain(
      `'"use cache" cannot be used outside of App Router. Expected a WorkStore.'`
    );
    expect(wrapper).toContain(
      `'"use cache" cannot be used outside of App Router. Expected a WorkUnitStore.'`
    );
  });
});
