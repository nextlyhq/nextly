// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { recentIconsStore } from "./recent-icons-store";

afterEach(() => window.localStorage.clear());

describe("the Icon control's recent icons store", () => {
  it("keeps nothing for nobody", () => {
    expect(recentIconsStore(null)).toBeUndefined();
  });

  it("keeps each author's list under their own key", () => {
    recentIconsStore("u1")?.write('["lucide:star"]');
    recentIconsStore("u2")?.write('["lucide:truck"]');
    expect(recentIconsStore("u1")?.read()).toBe('["lucide:star"]');
    expect(recentIconsStore("u2")?.read()).toBe('["lucide:truck"]');
    expect(
      window.localStorage.getItem("nextly:page-builder:recent-icons:u1")
    ).toBe('["lucide:star"]');
  });
});
