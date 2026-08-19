/**
 * Discarding a Single's pending change.
 *
 * The cache consequence is the one worth pinning: the response is ONE language's
 * live document, and the Single's detail key is a prefix of every locale-keyed
 * variant — so seeding it through the unscoped key would write this language's
 * values into another language's cache entry.
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

import { singleDocumentKeys } from "../useSingles";

import { useDiscardSingleWorkingDraft } from "../useDiscardSingleWorkingDraft";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const makeClient = () =>
  new QueryClient({ defaultOptions: { mutations: { retry: false } } });

describe("useDiscardSingleWorkingDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addresses the Single by slug, with no document id in the request", async () => {
    // A Single's URL carries no entry id — the server resolves it from the live
    // row rather than trusting the client — so the id rides in the scope for
    // cache identity only.
    const client = makeClient();
    discardSpy.mockResolvedValue({
      message: "Working draft discarded.",
      item: { id: "s1", status: "published" },
    });

    const { result } = renderHook(
      () =>
        useDiscardSingleWorkingDraft({ slug: "homepage", documentId: "s1" }),
      { wrapper: makeWrapper(client) }
    );
    await result.current.mutateAsync();

    expect(discardSpy).toHaveBeenCalledWith(
      { kind: "single", slug: "homepage", documentId: "s1" },
      undefined
    );
    expect(toastSuccessSpy).toHaveBeenCalledWith("Working draft discarded");
  });

  it("names the language whose pending change is being discarded", async () => {
    const client = makeClient();
    discardSpy.mockResolvedValue({
      message: "Working draft discarded.",
      item: { id: "s1" },
    });

    const { result } = renderHook(
      () =>
        useDiscardSingleWorkingDraft({
          slug: "homepage",
          documentId: "s1",
          locale: "es",
        }),
      { wrapper: makeWrapper(client) }
    );
    await result.current.mutateAsync();

    expect(discardSpy).toHaveBeenCalledWith(
      { kind: "single", slug: "homepage", documentId: "s1" },
      "es"
    );
  });

  it("seeds only the discarded language's cache, leaving another language's alone", async () => {
    const client = makeClient();
    const enKey = [
      ...singleDocumentKeys.detail("homepage"),
      { locale: null, fallbackLocale: null, translationStatus: false },
    ];
    const esKey = [
      ...singleDocumentKeys.detail("homepage"),
      { locale: "es", fallbackLocale: null, translationStatus: false },
    ];
    client.setQueryData(enKey, {
      id: "s1",
      title: "English live",
      _isWorkingDraft: true,
    });
    client.setQueryData(esKey, {
      id: "s1",
      title: "Spanish draft",
      _isWorkingDraft: true,
    });

    discardSpy.mockResolvedValue({
      message: "Working draft discarded.",
      item: { id: "s1", title: "Spanish live", status: "published" },
    });

    const { result } = renderHook(
      () =>
        useDiscardSingleWorkingDraft({
          slug: "homepage",
          documentId: "s1",
          locale: "es",
        }),
      { wrapper: makeWrapper(client) }
    );
    await result.current.mutateAsync();

    expect(client.getQueryData(esKey)).toMatchObject({
      title: "Spanish live",
      _isWorkingDraft: false,
    });
    // English keeps its own pending change. Without the predicate this entry
    // would be overwritten with the Spanish response and shown as English.
    expect(client.getQueryData(enKey)).toMatchObject({
      title: "English live",
      _isWorkingDraft: true,
    });
  });

  it("toasts the error and leaves the cache alone on failure", async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    discardSpy.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(
      () =>
        useDiscardSingleWorkingDraft({ slug: "homepage", documentId: "s1" }),
      { wrapper: makeWrapper(client) }
    );

    await expect(result.current.mutateAsync()).rejects.toThrow("nope");
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Failed to discard working draft: nope"
    );
  });
});
