import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useEntryJSON } from "../useEntryJSON";

// Why: PR-9 fixes two URL-construction bugs in useEntryJSON. These tests
// pin both fixes by rendering the hook and reading apiUrl directly — no
// network needed because we don't trigger refetch().

describe("useEntryJSON.apiUrl (Task 7 PR-9)", () => {
  it("builds a collection URL with /admin/api/ prefix and depth=0 explicitly included", () => {
    const { result } = renderHook(() =>
      useEntryJSON({
        scope: "collection",
        collectionSlug: "posts",
        entryId: "abc123",
        initialDepth: 0,
      })
    );

    expect(result.current.apiUrl).toBe(
      "/admin/api/collections/posts/entries/abc123?depth=0"
    );
  });

  it("builds a single URL with /admin/api/ prefix and depth=0 explicitly included", () => {
    const { result } = renderHook(() =>
      useEntryJSON({
        scope: "single",
        collectionSlug: "home",
        initialDepth: 0,
      })
    );

    expect(result.current.apiUrl).toBe("/admin/api/singles/home?depth=0");
  });

  it("includes the chosen depth in the URL when non-zero", () => {
    const { result } = renderHook(() =>
      useEntryJSON({
        scope: "collection",
        collectionSlug: "posts",
        entryId: "abc",
        initialDepth: 3,
      })
    );

    expect(result.current.apiUrl).toBe(
      "/admin/api/collections/posts/entries/abc?depth=3"
    );
  });

  it("clamps initialDepth to MAX_DEPTH=5 then reflects it in the URL", () => {
    const { result } = renderHook(() =>
      useEntryJSON({
        scope: "single",
        collectionSlug: "home",
        initialDepth: 99,
      })
    );

    expect(result.current.apiUrl).toBe("/admin/api/singles/home?depth=5");
  });

  it("updates the URL when setDepth is called", () => {
    const { result } = renderHook(() =>
      useEntryJSON({
        scope: "collection",
        collectionSlug: "posts",
        entryId: "abc",
        initialDepth: 0,
      })
    );

    expect(result.current.apiUrl).toBe(
      "/admin/api/collections/posts/entries/abc?depth=0"
    );

    act(() => {
      result.current.setDepth(2);
    });

    expect(result.current.apiUrl).toBe(
      "/admin/api/collections/posts/entries/abc?depth=2"
    );
  });
});
