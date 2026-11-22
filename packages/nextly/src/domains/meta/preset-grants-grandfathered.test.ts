/**
 * The grandfather record: written once, before any grant is set, from what
 * the presets held on a site an earlier release ran, and empty on a new one.
 */
import { describe, expect, it, vi } from "vitest";

import { grandfatheredPresetGrants } from "./preset-grants-grandfathered";

/** A `nextly_meta` stand-in that stores JSON text as the table does. */
function fakeMeta(initial?: unknown) {
  const rows = new Map<string, string>();
  if (initial !== undefined) {
    rows.set("preset-grants-grandfathered", JSON.stringify(initial));
  }
  return {
    rows,
    get: vi.fn(async (key: string) => {
      const raw = rows.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    }),
    insertIfAbsent: vi.fn(async (key: string, value: unknown) => {
      if (!rows.has(key)) rows.set(key, JSON.stringify(value));
    }),
  };
}

describe("the first run of the release", () => {
  it("records the presets holding each collection on a site an earlier release ran", async () => {
    const meta = fakeMeta();
    const kept = await grandfatheredPresetGrants({
      meta,
      presetRolesExist: async () => true,
      presetHoldings: async () =>
        new Map([
          ["posts", ["viewer", "admin", "editor"]],
          ["empty", []],
        ]),
    });
    expect([...kept]).toEqual([["posts", ["admin", "editor", "viewer"]]]);
    expect(JSON.parse(meta.rows.get("preset-grants-grandfathered")!)).toEqual({
      collections: { posts: ["admin", "editor", "viewer"] },
    });
  });

  it("records no collection on a new install, without reading the holdings", async () => {
    const meta = fakeMeta();
    const presetHoldings = vi.fn(async () => new Map([["posts", ["admin"]]]));
    const kept = await grandfatheredPresetGrants({
      meta,
      presetRolesExist: async () => false,
      presetHoldings,
    });
    expect(kept.size).toBe(0);
    expect(presetHoldings).not.toHaveBeenCalled();
    expect(meta.rows.has("preset-grants-grandfathered")).toBe(true);
  });
});

describe("a later run", () => {
  it("reads the record and never writes it again, whatever the presets hold now", async () => {
    const meta = fakeMeta({ collections: { posts: ["editor"] } });
    const presetHoldings = vi.fn(async () => new Map([["later", ["admin"]]]));
    const kept = await grandfatheredPresetGrants({
      meta,
      presetRolesExist: async () => true,
      presetHoldings,
    });
    expect([...kept]).toEqual([["posts", ["editor"]]]);
    expect(presetHoldings).not.toHaveBeenCalled();
    expect(meta.insertIfAbsent).not.toHaveBeenCalled();
  });

  it("keeps the record another first run wrote first", async () => {
    const meta = fakeMeta();
    // Another process's run lands between this one's read and its write.
    meta.insertIfAbsent.mockImplementationOnce(async (key: string) => {
      meta.rows.set(
        key,
        JSON.stringify({ collections: { posts: ["viewer"] } })
      );
    });
    const kept = await grandfatheredPresetGrants({
      meta,
      presetRolesExist: async () => true,
      presetHoldings: async () => new Map([["posts", ["admin"]]]),
    });
    expect([...kept]).toEqual([["posts", ["viewer"]]]);
  });

  it("reads a damaged record as keeping nothing open", async () => {
    const meta = fakeMeta({ collections: "everything" });
    const kept = await grandfatheredPresetGrants({
      meta,
      presetRolesExist: async () => true,
      presetHoldings: async () => new Map([["posts", ["admin"]]]),
    });
    expect(kept.size).toBe(0);
  });
});
