/**
 * Discarding a working draft removes the sidecar and returns the live row. The
 * cache consequence worth pinning: the entry DETAIL must be invalidated so the
 * editor (which reads with `?draft=1`) refetches the now-published document,
 * while list/count caches stay untouched because the live row never changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { discardSpy, toastSuccessSpy, toastErrorSpy } = vi.hoisted(() => ({
  discardSpy: vi.fn(),
  toastSuccessSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
}));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { discardWorkingDraft: discardSpy },
}));

vi.mock("@admin/components/ui", () => ({
  toast: { success: toastSuccessSpy, error: toastErrorSpy },
}));

import { entryKeys } from "@admin/services/entryApi";

import { useDiscardWorkingDraft } from "../useDiscardWorkingDraft";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
}

describe("useDiscardWorkingDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the collection-scoped endpoint, invalidates the detail, and toasts on success", async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    discardSpy.mockResolvedValue({
      message: "Working draft discarded.",
      item: { id: "e1", status: "published" },
    });

    const { result } = renderHook(
      () => useDiscardWorkingDraft({ collectionSlug: "posts", entryId: "e1" }),
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync();

    // No locale named: the caller is an unlocalized collection, or the default
    // language, which the editor addresses without naming it.
    expect(discardSpy).toHaveBeenCalledWith(
      {
        kind: "collection",
        slug: "posts",
        entryId: "e1",
      },
      undefined
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: entryKeys.detail("posts", "e1"),
    });
    expect(toastSuccessSpy).toHaveBeenCalledWith("Working draft discarded");
  });

  it("names the language whose pending change is being discarded", async () => {
    // A localized document holds one pending change per language. Dropping the
    // locale here would discard the default language's, which is neither the
    // one the author is looking at nor one they asked about.
    const client = makeClient();
    discardSpy.mockResolvedValue({
      message: "Working draft discarded.",
      item: { id: "e1", status: "published" },
    });

    const { result } = renderHook(
      () =>
        useDiscardWorkingDraft({
          collectionSlug: "posts",
          entryId: "e1",
          locale: "es",
        }),
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync();

    expect(discardSpy).toHaveBeenCalledWith(
      { kind: "collection", slug: "posts", entryId: "e1" },
      "es"
    );
  });

  it("toasts the error and does not invalidate on failure", async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    discardSpy.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(
      () => useDiscardWorkingDraft({ collectionSlug: "posts", entryId: "e1" }),
      { wrapper: makeWrapper(client) }
    );

    await expect(result.current.mutateAsync()).rejects.toThrow("nope");

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Failed to discard working draft: nope"
    );
  });

  it("seeds the returned live row into the detail cache and clears the draft flag", async () => {
    const client = makeClient();
    // What the editor read: the pending working draft (Changed state).
    const key = entryKeys.detailScoped("posts", "e1", {
      locale: undefined,
      fallbackLocale: undefined,
      translationStatus: false,
      draft: true,
    });
    client.setQueryData(key, {
      id: "e1",
      status: "published",
      title: "draft-title",
      _isWorkingDraft: true,
    });
    discardSpy.mockResolvedValue({
      message: "Working draft discarded.",
      item: { id: "e1", status: "published", title: "live-title" },
    });

    const { result } = renderHook(
      () => useDiscardWorkingDraft({ collectionSlug: "posts", entryId: "e1" }),
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync();

    // The live row replaced the draft and Changed cleared, without waiting on a
    // refetch — so a slow/failed refetch or a remount cannot restore the draft.
    expect(client.getQueryData(key)).toMatchObject({
      title: "live-title",
      _isWorkingDraft: false,
    });
  });
});
