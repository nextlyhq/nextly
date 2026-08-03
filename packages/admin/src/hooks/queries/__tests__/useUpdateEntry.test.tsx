/**
 * A status-less "save working draft" returns `_isWorkingDraft` from the server,
 * but the optimistic merge only writes the status-less PAYLOAD (which carries no
 * such flag). This pins that the mutation seeds the server RESPONSE into the same
 * detail query the editor reads, so the Changed state and Publish/Discard
 * controls appear at once rather than only after the invalidation's refetch —
 * which may be slow or fail.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...actual, entryApi: { ...actual.entryApi, update: updateSpy } };
});

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false }),
}));

vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { entryKeys } from "@admin/services/entryApi";

import { useUpdateEntry } from "../useUpdateEntry";

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

describe("useUpdateEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds the server response into the detail query the editor reads", async () => {
    const client = makeClient();
    // The key the editor reads a drafts entry with (working-draft overlay).
    const key = entryKeys.detailScoped("posts", "e1", {
      locale: undefined,
      fallbackLocale: undefined,
      translationStatus: false,
      draft: true,
    });
    // Cached without the flag, as the status-less optimistic merge leaves it.
    client.setQueryData(key, { id: "e1", status: "published", title: "old" });
    // The server's response to a status-less save DOES carry the flag.
    updateSpy.mockResolvedValue({
      id: "e1",
      status: "published",
      title: "new",
      _isWorkingDraft: true,
    });

    const { result } = renderHook(
      () =>
        useUpdateEntry({
          collectionSlug: "posts",
          entryId: "e1",
          draft: true,
          showToast: false,
        }),
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync({ title: "new" });

    // The editor's cached entry now carries the flag without waiting on a refetch.
    expect(client.getQueryData(key)).toMatchObject({
      _isWorkingDraft: true,
      title: "new",
    });
  });

  it("clears a stale _isWorkingDraft when the response omits it (publish)", async () => {
    const client = makeClient();
    const key = entryKeys.detailScoped("posts", "e1", {
      locale: undefined,
      fallbackLocale: undefined,
      translationStatus: false,
      draft: true,
    });
    // Cached as a pending working draft (Changed state on screen).
    client.setQueryData(key, {
      id: "e1",
      status: "draft",
      title: "old",
      _isWorkingDraft: true,
    });
    // Publishing returns the live document WITHOUT the synthetic flag.
    updateSpy.mockResolvedValue({
      id: "e1",
      status: "published",
      title: "new",
    });

    const { result } = renderHook(
      () =>
        useUpdateEntry({
          collectionSlug: "posts",
          entryId: "e1",
          draft: true,
          showToast: false,
        }),
      { wrapper: makeWrapper(client) }
    );

    await result.current.mutateAsync({ status: "published" });

    // The stale `true` did not survive the spread — Changed clears at once.
    expect(client.getQueryData(key)).toMatchObject({
      _isWorkingDraft: false,
      status: "published",
    });
  });
});
