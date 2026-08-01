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

    expect(discardSpy).toHaveBeenCalledWith({
      kind: "collection",
      slug: "posts",
      entryId: "e1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: entryKeys.detail("posts", "e1"),
    });
    expect(toastSuccessSpy).toHaveBeenCalledWith("Working draft discarded");
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
});
