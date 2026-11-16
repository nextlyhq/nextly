/**
 * A plugin expires the cached pages that show its own data.
 *
 * Content writes expire the `nextly:*` tags of what they change; a plugin's
 * own data (its settings, its redirects) changes through no content write, so
 * pages built from it stayed cached until a redeploy. `ctx.cache` names tags
 * in the plugin's own namespace for its reads to carry, and expires them
 * through the same flush a content write takes, so every instance that shares
 * the database sees the expiry.
 *
 * @module plugins/__tests__/plugin-cache.integration.test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { container } from "../../di/container";
import { pluginCacheTag } from "../../revalidation/compute-tags";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../revalidation/types";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";

/** Every intent flushed to it, so a case can say which tags were expired. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  failing = false;
  flush(intents: RevalidationIntent[]): void {
    if (this.failing) throw new Error("the cache is unreachable");
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

const SEO = "cache-probe-seo";
const OTHER = "cache-probe-other";

const contexts = new Map<string, PluginContext>();
const probe = (name: string) =>
  definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.1",
    init: ctx => {
      contexts.set(name, ctx);
    },
  });

describe.each(getConfiguredTestDialects())(
  "a plugin's cached pages (%s)",
  dialect => {
    let handle: TestNextly | undefined;
    let spy: RecordingRevalidator;

    beforeEach(async () => {
      spy = new RecordingRevalidator();
      // Registered before the boot, which keeps a revalidator already there
      // rather than its no-op default.
      container.registerSingleton<CacheRevalidator>(
        "cacheRevalidator",
        () => spy
      );
      handle = await createTestNextly({
        dialect,
        plugins: [probe(SEO), probe(OTHER)],
      });
      expect(handle.adapter.dialect).toBe(dialect);
    });

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
      contexts.clear();
    });

    const cacheOf = (name: string) => {
      const ctx = contexts.get(name);
      if (!ctx) throw new Error(`${name} was not initialised`);
      return ctx.cache;
    };

    it("names a read's tag as its expiry spells it", () => {
      expect(cacheOf(SEO).tag("settings")).toBe(
        pluginCacheTag(SEO, "settings")
      );
      expect(cacheOf(SEO).tags("settings", "pattern:posts")).toEqual([
        pluginCacheTag(SEO, "settings"),
        pluginCacheTag(SEO, "pattern:posts"),
      ]);
    });

    it("expires its own tags through the cache revalidator, once each", async () => {
      await cacheOf(SEO).expire("settings", "redirects", "settings");
      expect(spy.tags).toEqual([
        pluginCacheTag(SEO, "settings"),
        pluginCacheTag(SEO, "redirects"),
      ]);
    });

    it("expires only its own namespace, never another plugin's or content's", async () => {
      await cacheOf(OTHER).expire("settings");
      expect(spy.tags).toEqual([pluginCacheTag(OTHER, "settings")]);
      expect(spy.tags).not.toContain(pluginCacheTag(SEO, "settings"));
      // A content tag given as a part is a part of this plugin's tag, not the
      // content's tag.
      await cacheOf(OTHER).expire("nextly:posts");
      expect(spy.tags).not.toContain("nextly:posts");
      expect(spy.tags).toContain(pluginCacheTag(OTHER, "nextly:posts"));
    });

    it("asks nothing of the cache when given no part", async () => {
      await cacheOf(SEO).expire();
      expect(spy.flushed).toEqual([]);
    });

    it("refuses a blank part before expiring anything", async () => {
      await expect(cacheOf(SEO).expire("settings", " ")).rejects.toThrow();
      expect(spy.flushed).toEqual([]);
    });

    it("never fails the plugin's write when the cache cannot be reached", async () => {
      spy.failing = true;
      await expect(cacheOf(SEO).expire("settings")).resolves.toBeUndefined();
    });
  }
);
