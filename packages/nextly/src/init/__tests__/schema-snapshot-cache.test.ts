// Phase 5 step 2: snapshot cache unit tests.
//
// Trivial state-management surface — three functions over a single
// globalThis-backed slot. Tests document the contract so future
// refactors don't accidentally break the short-circuit.

import { afterEach, describe, expect, it } from "vitest";

import {
  clearCachedSnapshot,
  getCachedSnapshot,
  setCachedSnapshot,
  // new live-snapshot cache exports
  clearLiveSnapshots,
  getLiveSnapshot,
  setLiveSnapshot,
} from "../schema-snapshot-cache";

describe("schema-snapshot-cache", () => {
  afterEach(() => {
    clearCachedSnapshot();
  });

  it("returns undefined before any snapshot has been stored", () => {
    expect(getCachedSnapshot()).toBeUndefined();
  });

  it("returns the snapshot it was most recently given", () => {
    const snapshot = { collections: { posts: { fields: ["title"] } } };
    setCachedSnapshot(snapshot);
    expect(getCachedSnapshot()).toBe(snapshot);
  });

  it("overwrites prior snapshot on subsequent setCachedSnapshot calls", () => {
    setCachedSnapshot({ a: 1 });
    setCachedSnapshot({ b: 2 });
    expect(getCachedSnapshot()).toEqual({ b: 2 });
  });

  it("clearCachedSnapshot resets to undefined", () => {
    setCachedSnapshot({ collections: {} });
    clearCachedSnapshot();
    expect(getCachedSnapshot()).toBeUndefined();
  });

  it("survives across module imports via globalThis (sanity check)", async () => {
    // Re-import the module dynamically — globalThis storage means the
    // cache value persists across the new module instance. This is the
    // load-bearing property for Turbopack HMR survival.
    setCachedSnapshot({ marker: "before" });
    const fresh = await import("../schema-snapshot-cache");
    expect(fresh.getCachedSnapshot()).toEqual({ marker: "before" });
  });
});

describe("live-snapshot cache", () => {
  afterEach(() => {
    clearLiveSnapshots();
  });

  it("returns undefined for an unknown key", () => {
    expect(getLiveSnapshot(["a", "b"])).toBeUndefined();
  });

  it("returns stored snapshot for the same managed-table-name set", () => {
    const tables = ["posts", "tags"];
    const snap = { tables: [{ name: "posts" }, { name: "tags" }] };
    setLiveSnapshot(tables, snap);
    expect(getLiveSnapshot(tables)).toEqual(snap);
  });

  it("treats different managed-table sets as different cache keys", () => {
    const snap = { tables: [{ name: "posts" }] };
    setLiveSnapshot(["posts", "tags"], snap);
    expect(getLiveSnapshot(["posts"])).toBeUndefined();
  });

  it("clearLiveSnapshots wipes all entries", () => {
    setLiveSnapshot(["posts"], { tables: [] });
    clearLiveSnapshots();
    expect(getLiveSnapshot(["posts"])).toBeUndefined();
  });

  it("normalises table-name order so callers needn't sort", () => {
    const snap = { tables: [] };
    setLiveSnapshot(["b", "a", "c"], snap);
    expect(getLiveSnapshot(["a", "b", "c"])).toEqual(snap);
    expect(getLiveSnapshot(["c", "b", "a"])).toEqual(snap);
  });

  it("survives across module imports via globalThis (sanity check)", async () => {
    setLiveSnapshot(["posts"], { tables: [{ marker: "before" }] });
    const fresh = await import("../schema-snapshot-cache");
    expect(fresh.getLiveSnapshot(["posts"])).toEqual({
      tables: [{ marker: "before" }],
    });
  });
});
