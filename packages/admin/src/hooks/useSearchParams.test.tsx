/**
 * The admin reads the query string through this hook rather than the host
 * framework's router, so these cover the reactivity it has to preserve:
 * picking up pushState-driven changes (via the `locationchange` event the
 * router's history patch emits) and back/forward via `popstate`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getSearchParam } from "@admin/lib/routing";

import { useSearchParams } from "./useSearchParams";

function goTo(url: string) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new Event("locationchange"));
}

afterEach(() => {
  window.history.pushState({}, "", "/admin");
});

describe("useSearchParams", () => {
  it("reads the current query string", () => {
    window.history.pushState({}, "", "/admin/entries?where=abc&status=draft");

    const { result } = renderHook(() => useSearchParams());

    expect(result.current.where).toBe("abc");
    expect(result.current.status).toBe("draft");
  });

  it("has the params on the very first render, with no empty initial pass", () => {
    // Consumers key data fetches off these params. An initial empty render
    // would fetch once unfiltered and again once the real params landed.
    window.history.pushState({}, "", "/admin/entries?where=abc");
    const renders: (string | null)[] = [];

    renderHook(() => {
      const params = useSearchParams();
      renders.push(getSearchParam(params, "where"));
      return params;
    });

    expect(renders[0]).toBe("abc");
  });

  it("updates when a pushState navigation changes the query", () => {
    window.history.pushState({}, "", "/admin/entries?where=abc");
    const { result } = renderHook(() => useSearchParams());
    expect(result.current.where).toBe("abc");

    act(() => goTo("/admin/entries?where=xyz"));

    expect(result.current.where).toBe("xyz");
  });

  it("updates on real back/forward traversal", async () => {
    window.history.pushState({}, "", "/admin/entries?where=first");
    const { result } = renderHook(() => useSearchParams());

    act(() => {
      window.history.pushState({}, "", "/admin/entries?where=second");
      window.dispatchEvent(new Event("locationchange"));
    });
    expect(result.current.where).toBe("second");

    // Real traversal: the browser changes the URL and emits popstate itself.
    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(result.current.where).toBe("first"));

    act(() => {
      window.history.forward();
    });
    await waitFor(() => expect(result.current.where).toBe("second"));
  });

  it("keeps a stable result when a navigation leaves the query untouched", () => {
    window.history.pushState({}, "", "/admin/entries?where=abc");
    const { result } = renderHook(() => useSearchParams());
    const first = result.current;

    // Same query string, different path: nothing to recompute.
    act(() => goTo("/admin/other?where=abc"));

    expect(result.current).toBe(first);
  });

  it("drops params when the query is cleared", () => {
    window.history.pushState({}, "", "/admin/entries?where=abc");
    const { result } = renderHook(() => useSearchParams());
    expect(result.current.where).toBe("abc");

    act(() => goTo("/admin/entries"));

    expect(result.current.where).toBeUndefined();
  });
});

describe("getSearchParam", () => {
  it("returns a single value", () => {
    expect(getSearchParam({ where: "abc" }, "where")).toBe("abc");
  });

  it("returns the first value when a key repeats, like URLSearchParams.get", () => {
    expect(getSearchParam({ where: ["first", "second"] }, "where")).toBe(
      "first"
    );
  });

  it("returns null when the key is absent or empty", () => {
    expect(getSearchParam({}, "where")).toBeNull();
    expect(getSearchParam({ where: undefined }, "where")).toBeNull();
    expect(getSearchParam({ where: [] }, "where")).toBeNull();
  });
});
