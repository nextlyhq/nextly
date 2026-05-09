import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestService,
  type TestServiceContext,
} from "../../../../__tests__/helpers/service-factory";
import { MetaService } from "../meta-service";

describe("MetaService", () => {
  let ctx: TestServiceContext<MetaService>;

  beforeEach(async () => {
    ctx = await createTestService(MetaService);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("returns null for missing keys", async () => {
    expect(await ctx.service.get("missing.key")).toBeNull();
  });

  it("upserts a string value and reads it back", async () => {
    await ctx.service.set("seed.completedAt", "2026-05-04T00:00:00.000Z");
    expect(await ctx.service.get<string>("seed.completedAt")).toBe(
      "2026-05-04T00:00:00.000Z"
    );
  });

  it("upserts an object value and reads it back", async () => {
    await ctx.service.set("config.foo", { a: 1, b: ["x", "y"] });
    expect(await ctx.service.get<{ a: number; b: string[] }>("config.foo")).toEqual(
      { a: 1, b: ["x", "y"] }
    );
  });

  it("overwrites existing keys (set is upsert)", async () => {
    await ctx.service.set("foo", { v: 1 });
    await ctx.service.set("foo", { v: 2 });
    expect(await ctx.service.get<{ v: number }>("foo")).toEqual({ v: 2 });
  });

  it("delete removes a key", async () => {
    await ctx.service.set("foo", "bar");
    expect(await ctx.service.get("foo")).toBe("bar");
    await ctx.service.delete("foo");
    expect(await ctx.service.get("foo")).toBeNull();
  });

  it("delete on a missing key is a no-op (does not throw)", async () => {
    await expect(ctx.service.delete("nope")).resolves.toBeUndefined();
  });

  it("getAll returns all rows as a Record", async () => {
    await ctx.service.set("a", 1);
    await ctx.service.set("b", "two");
    await ctx.service.set("c", { x: 3 });
    const all = await ctx.service.getAll();
    expect(all).toEqual({ a: 1, b: "two", c: { x: 3 } });
  });

  it("getAll returns empty object when table is empty", async () => {
    expect(await ctx.service.getAll()).toEqual({});
  });

  it("stores ISO timestamps round-trip-clean", async () => {
    const iso = new Date("2026-05-04T12:34:56.789Z").toISOString();
    await ctx.service.set("ts", iso);
    expect(await ctx.service.get<string>("ts")).toBe(iso);
  });
});
