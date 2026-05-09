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
