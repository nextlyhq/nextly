// @vitest-environment jsdom
/**
 * Recent colours are kept per author through the admin's preference store,
 * which holds the site's off switch and forgets the person on sign-out, and
 * never in the browser's storage directly or in the site's own record. The
 * admin's store is stood in for by one held in memory.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => new Map<string, string>());

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  devicePreferenceStore: (key: string) => ({
    read: () => held.get(key) ?? null,
    write: (value: string) => {
      held.set(key, value);
    },
    remove: () => {
      held.delete(key);
    },
  }),
}));

import { recentColoursStore } from "./recent-colours-store";

beforeEach(() => {
  window.localStorage.clear();
  held.clear();
});

describe("the Recent colours store", () => {
  it("keeps nothing for nobody", () => {
    expect(recentColoursStore(null)).toBeUndefined();
  });

  it("keeps each author's list under their own key, through the admin's store", () => {
    recentColoursStore("u1")?.write('["#ff0000"]');
    recentColoursStore("u2")?.write('["#00ff00"]');
    expect(recentColoursStore("u1")?.read()).toBe('["#ff0000"]');
    expect(recentColoursStore("u2")?.read()).toBe('["#00ff00"]');
    expect(held.get("nextly:page-builder:recent-colours:u1")).toBe(
      '["#ff0000"]'
    );
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it("is kept apart from the recent icons", () => {
    recentColoursStore("u1")?.write('["#ff0000"]');
    expect(held.has("nextly:page-builder:recent-icons:u1")).toBe(false);
  });
});
