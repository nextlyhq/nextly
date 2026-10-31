/**
 * Nextly and an app with Next.js Cache Components on. Neither `withNextly()`
 * nor `createRegister()` warns about the setting any more: an app may turn it
 * on, as the caching guide describes. What `createRegister()` is told is kept
 * for the cached reads, so a read under Cache Components that finds no
 * `"use cache"` read function registered says so, once.
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

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  recordCacheComponents(false);
  vi.restoreAllMocks();
});

/** Every warning printed so far, as one string. */
const warned = () => warn.mock.calls.map(call => String(call[0])).join("\n");

describe("withNextly and Cache Components", () => {
  it("takes a config with Cache Components on without a warning", () => {
    const wrapped = withNextly<Record<string, unknown>>({
      cacheComponents: true,
    });
    expect(warned()).not.toMatch(/Cache Components/);
    expect(wrapped.cacheComponents).toBe(true);
    expect(wrapped.serverExternalPackages).toContain("nextly");
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

  it("says nothing, at start or at a read, when Next.js inlined it as off or not at all", async () => {
    for (const host of [{ cacheComponents: "false" }, {}]) {
      await createRegister(config, host)();
      const nextlyWarn = spyNextlyWarn();
      await read();
      expect(nextlyWarn).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
    expect(warned()).not.toMatch(/Cache Components/);
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
