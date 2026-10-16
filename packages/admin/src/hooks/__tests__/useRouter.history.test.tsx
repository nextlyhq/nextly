/**
 * The router's history patch tells the admin what lies behind the current
 * entry, where the browser cannot be asked.
 *
 * Driven through the real `useRouter` and the real `history.pushState`, so a
 * patch that stopped recording, or recorded the destination instead of the
 * page it left, fails here rather than in a browser without the Navigation API.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  entryBehindIsAdmin,
  forgetEntryBehind,
} from "@admin/lib/admin-history";

import { useRouter } from "../useRouter";

vi.mock("../useHydration", () => ({ useHydration: () => true }));

beforeEach(() => {
  forgetEntryBehind();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useRouter's history patch", () => {
  it("records an admin page behind a move made from one", () => {
    window.history.replaceState(null, "", "/admin/collections/posts");
    const { unmount } = renderHook(() => useRouter());
    window.history.pushState(null, "", "/admin/collections/tags");
    expect(entryBehindIsAdmin()).toBe(true);
    unmount();
  });

  it("records the site behind a move into the admin from it", () => {
    // The page LEFT decides, not the one arrived at: both of these moves land
    // in the admin.
    window.history.replaceState(null, "", "/");
    const { unmount } = renderHook(() => useRouter());
    window.history.pushState(null, "", "/admin/collections/tags");
    expect(entryBehindIsAdmin()).toBe(false);
    unmount();
  });

  it("leaves what is behind alone when an entry is only replaced", () => {
    window.history.replaceState(null, "", "/admin/collections/posts");
    const { unmount } = renderHook(() => useRouter());
    window.history.pushState(null, "", "/admin/collections/tags");
    window.history.replaceState(null, "", "/admin/collections/tags?page=2");
    expect(entryBehindIsAdmin()).toBe(true);
    unmount();
  });

  it("forgets it when the user jumps through history", () => {
    window.history.replaceState(null, "", "/admin/collections/posts");
    const { unmount } = renderHook(() => useRouter());
    window.history.pushState(null, "", "/admin/collections/tags");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(entryBehindIsAdmin()).toBeUndefined();
    unmount();
  });
});
