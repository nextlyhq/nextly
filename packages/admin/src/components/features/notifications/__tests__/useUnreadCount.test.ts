// F10 PR 5 — useUnreadCount unit tests.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";

import type { JournalRow } from "@admin/services/journalApi";

import { LAST_SEEN_KEY, useUnreadCount } from "../useUnreadCount";

function rowAt(id: string, startedAt: string): JournalRow {
  return {
    id,
    source: "ui",
    status: "success",
    scope: { kind: "collection", slug: "posts" },
    summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
    startedAt,
    endedAt: startedAt,
    durationMs: 100,
    errorCode: null,
    errorMessage: null,
  };
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useUnreadCount", () => {
  it("treats every row as unread when no lastSeen is recorded", () => {
    const rows = [
      rowAt("a", "2026-04-30T10:00:00.000Z"),
      rowAt("b", "2026-04-30T09:00:00.000Z"),
    ];
    const { result } = renderHook(() => useUnreadCount(rows), {
      wrapper: makeWrapper(),
    });
    expect(result.current.unread).toBe(2);
  });

  it("counts rows newer than localStorage lastSeen", () => {
    localStorage.setItem(LAST_SEEN_KEY, "2026-04-30T09:30:00.000Z");
    const rows = [
      rowAt("a", "2026-04-30T10:00:00.000Z"),
      rowAt("b", "2026-04-30T09:00:00.000Z"),
    ];
    const { result } = renderHook(() => useUnreadCount(rows), {
      wrapper: makeWrapper(),
    });
    expect(result.current.unread).toBe(1);
  });

  it("returns 0 when all rows are older than lastSeen", () => {
    localStorage.setItem(LAST_SEEN_KEY, "2026-04-30T11:00:00.000Z");
    const rows = [
      rowAt("a", "2026-04-30T10:00:00.000Z"),
      rowAt("b", "2026-04-30T09:00:00.000Z"),
    ];
    const { result } = renderHook(() => useUnreadCount(rows), {
      wrapper: makeWrapper(),
    });
    expect(result.current.unread).toBe(0);
  });

  it("markAllSeen writes the newest startedAt to localStorage and resets unread to 0", () => {
    const rows = [
      rowAt("a", "2026-04-30T10:00:00.000Z"),
      rowAt("b", "2026-04-30T09:00:00.000Z"),
    ];
    const { result } = renderHook(() => useUnreadCount(rows), {
      wrapper: makeWrapper(),
    });

    expect(result.current.unread).toBe(2);
    act(() => result.current.markAllSeen());

    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(
      "2026-04-30T10:00:00.000Z"
    );
    expect(result.current.unread).toBe(0);
  });

  it("markAllSeen is a no-op when rows are empty (preserves prior lastSeen)", () => {
    localStorage.setItem(LAST_SEEN_KEY, "2026-04-29T00:00:00.000Z");
    const { result } = renderHook(() => useUnreadCount([]), {
      wrapper: makeWrapper(),
    });
    act(() => result.current.markAllSeen());
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(
      "2026-04-29T00:00:00.000Z"
    );
  });

  it("subscribes to visibilitychange on mount and cleans up on unmount", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useUnreadCount([]), {
      wrapper: makeWrapper(),
    });

    expect(addSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });

  it("survives a localStorage read failure (privacy mode etc.) — treats as no lastSeen", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    const rows = [rowAt("a", "2026-04-30T10:00:00.000Z")];
    const { result } = renderHook(() => useUnreadCount(rows), {
      wrapper: makeWrapper(),
    });

    expect(result.current.unread).toBe(1);
    getItemSpy.mockRestore();
  });
});
