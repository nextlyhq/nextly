import { describe, expect, it } from "vitest";

import { OpenApiCache } from "./cache";

describe("OpenApiCache", () => {
  it("returns undefined for a missing key", () => {
    const c = new OpenApiCache({ max: 4 });
    expect(c.get("nope")).toBeUndefined();
  });

  it("returns the stored buffer after set", () => {
    const c = new OpenApiCache({ max: 4 });
    const buf = Buffer.from("hello");
    c.set("k1", buf);
    expect(c.get("k1")).toBe(buf);
  });

  it("size reflects current entry count", () => {
    const c = new OpenApiCache({ max: 4 });
    expect(c.size()).toBe(0);
    c.set("a", Buffer.from("a"));
    c.set("b", Buffer.from("b"));
    expect(c.size()).toBe(2);
  });

  it("evicts the least-recently-used entry when over capacity", () => {
    const c = new OpenApiCache({ max: 2 });
    c.set("a", Buffer.from("a"));
    c.set("b", Buffer.from("b"));
    c.set("c", Buffer.from("c"));
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeDefined();
    expect(c.get("c")).toBeDefined();
  });

  it("get promotes an entry so it survives the next eviction", () => {
    const c = new OpenApiCache({ max: 2 });
    c.set("a", Buffer.from("a"));
    c.set("b", Buffer.from("b"));
    // Touch 'a' so 'b' becomes oldest.
    c.get("a");
    c.set("c", Buffer.from("c"));
    expect(c.get("a")).toBeDefined();
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBeDefined();
  });

  it("overwriting an existing key updates value AND moves it to MRU", () => {
    const c = new OpenApiCache({ max: 2 });
    c.set("a", Buffer.from("a1"));
    c.set("b", Buffer.from("b1"));
    c.set("a", Buffer.from("a2")); // overwrite 'a' (now MRU)
    c.set("c", Buffer.from("c1")); // should evict 'b', not 'a'
    expect(c.get("a")?.toString()).toBe("a2");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBeDefined();
  });

  it("invalidateByPrefix drops only matching keys", () => {
    const c = new OpenApiCache({ max: 8 });
    c.set("hash1:json", Buffer.from("1j"));
    c.set("hash1:yaml", Buffer.from("1y"));
    c.set("hash2:json", Buffer.from("2j"));
    c.invalidateByPrefix("hash1:");
    expect(c.get("hash1:json")).toBeUndefined();
    expect(c.get("hash1:yaml")).toBeUndefined();
    expect(c.get("hash2:json")).toBeDefined();
  });

  it("invalidateByPrefix during iteration doesn't crash", () => {
    const c = new OpenApiCache({ max: 8 });
    for (let i = 0; i < 5; i++) c.set(`hash:${i}`, Buffer.from(`${i}`));
    expect(() => c.invalidateByPrefix("hash:")).not.toThrow();
    expect(c.size()).toBe(0);
  });

  it("clear empties the cache", () => {
    const c = new OpenApiCache({ max: 4 });
    c.set("a", Buffer.from("a"));
    c.set("b", Buffer.from("b"));
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });
});
