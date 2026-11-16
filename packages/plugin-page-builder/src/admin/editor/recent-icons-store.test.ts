// @vitest-environment jsdom
/**
 * The Icon control's recent icons are kept per author through the admin's
 * preference store, which holds the site's off switch and forgets the person
 * on sign-out, and never in the browser's storage directly. The admin's store
 * is stood in for by one held in memory.
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

import { recentIconsStore } from "./recent-icons-store";

beforeEach(() => {
  window.localStorage.clear();
  held.clear();
});

describe("the Icon control's recent icons store", () => {
  it("keeps nothing for nobody", () => {
    expect(recentIconsStore(null)).toBeUndefined();
  });

  it("keeps each author's list under their own key, through the admin's store", () => {
    recentIconsStore("u1")?.write('["lucide:star"]');
    recentIconsStore("u2")?.write('["lucide:truck"]');
    expect(recentIconsStore("u1")?.read()).toBe('["lucide:star"]');
    expect(recentIconsStore("u2")?.read()).toBe('["lucide:truck"]');
    expect(held.get("nextly:page-builder:recent-icons:u1")).toBe(
      '["lucide:star"]'
    );
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
