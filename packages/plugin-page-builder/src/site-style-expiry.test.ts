import { describe, expect, it, vi } from "vitest";

const flushed = vi.hoisted(() => ({
  intents: [] as unknown[],
  fail: false,
}));

vi.mock("nextly/runtime", () => ({
  nextlySingleTags: (slug: string) => [`single-tag:${slug}`],
  NextCacheRevalidator: class {
    flush(intents: unknown[]): Promise<void> {
      if (flushed.fail) return Promise.reject(new Error("no cache"));
      flushed.intents.push(...intents);
      return Promise.resolve();
    }
  },
}));

import { siteStyleExpiry } from "./site-style-expiry";

describe("siteStyleExpiry", () => {
  it("expires the tag the published route reads the Single under", async () => {
    flushed.intents.length = 0;
    flushed.fail = false;
    await siteStyleExpiry(() => undefined)("renamed-style");
    expect(flushed.intents).toEqual([{ tags: ["single-tag:renamed-style"] }]);
  });

  it("reports a failed expiry and does not throw, the write being committed", async () => {
    flushed.fail = true;
    const warned: string[] = [];
    await expect(
      siteStyleExpiry(message => warned.push(message))("site-style")
    ).resolves.toBeUndefined();
    expect(warned).toHaveLength(1);
  });
});
