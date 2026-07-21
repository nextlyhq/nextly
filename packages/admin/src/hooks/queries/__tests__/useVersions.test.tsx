/**
 * History paging is keyset, not page-numbered, and the response carries no
 * cursor — the client derives it from the page it just received. That derivation
 * is the part worth pinning: getting it wrong either stops paging early or
 * queries against a null anchor.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listSpy, getSpy, restoreSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
  getSpy: vi.fn(),
  restoreSpy: vi.fn(),
}));

// The API client is replaced so these tests drive query and mutation outcomes
// directly — including a failing restore — without a network round trip.
vi.mock("@admin/services/versionApi", () => ({
  versionApi: { list: listSpy, get: getSpy, restore: restoreSpy },
}));

import { useRestoreVersion, useVersion, useVersions } from "../useVersions";

const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function page(items: unknown[], hasNext: boolean) {
  return { items, meta: { hasNext } };
}

describe("useVersions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests the first page without a cursor", async () => {
    listSpy.mockResolvedValue(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listSpy).toHaveBeenCalledWith(
      scope,
      expect.not.objectContaining({ cursor: expect.anything() })
    );
  });

  it("pages from the oldest version number on the page just received", async () => {
    listSpy.mockResolvedValueOnce(
      page([{ versionNo: 5 }, { versionNo: 4 }], true)
    );
    listSpy.mockResolvedValueOnce(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await result.current.fetchNextPage();

    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        scope,
        expect.objectContaining({ cursor: 4 })
      )
    );
  });

  it("stops paging when the server reports no further page", async () => {
    listSpy.mockResolvedValue(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.hasNextPage).toBe(false);
  });

  it("stops paging when the last row cannot anchor a cursor", async () => {
    // An autosave row carries a null versionNo. Paging from it would query
    // against a null anchor and match nothing.
    listSpy.mockResolvedValue(page([{ versionNo: null }], true));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.hasNextPage).toBe(false);
  });

  it("stays idle for an entry that has no id yet", () => {
    // An empty entryId interpolates into a URL that addresses the collection
    // rather than an entry, so the request must not be made at all.
    renderHook(() => useVersions({ scope: { ...scope, entryId: "" } }), {
      wrapper,
    });

    expect(listSpy).not.toHaveBeenCalled();
  });

  it("stays idle for a Single whose live document is unknown", () => {
    renderHook(
      () =>
        useVersions({
          scope: { kind: "single", slug: "settings", documentId: "" },
        }),
      { wrapper }
    );

    expect(listSpy).not.toHaveBeenCalled();
  });

  it("keeps two documents' histories in separate cache entries", async () => {
    listSpy.mockResolvedValue(page([{ versionNo: 1 }], false));
    const other = { ...scope, entryId: "e2" };

    const a = renderHook(() => useVersions({ scope }), { wrapper });
    const b = renderHook(() => useVersions({ scope: other }), { wrapper });

    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(listSpy).toHaveBeenCalledWith(scope, expect.anything());
    expect(listSpy).toHaveBeenCalledWith(other, expect.anything());
  });
});

describe("useVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the requested version", async () => {
    getSpy.mockResolvedValue({ versionNo: 2, snapshot: {} });

    const { result } = renderHook(() => useVersion({ scope, versionNo: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getSpy).toHaveBeenCalledWith(scope, 2);
  });

  it("does not fetch without a version number", () => {
    renderHook(() => useVersion({ scope, versionNo: null }), { wrapper });

    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("useRestoreVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Mirrors the app's QueryProvider, which retries mutations twice. The shared
   * wrapper disables retries, so testing against it would pass whether or not
   * the hook opts out.
   */
  function retryingWrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: 2 },
      },
    });
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  it("never retries a failed restore", async () => {
    // A restore is not idempotent: each attempt is a fresh write recording
    // another version and another outbox event. The global mutation policy
    // retries twice, so inheriting it would turn one dropped response into
    // three restores of the same version.
    restoreSpy.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useRestoreVersion({ scope }), {
      wrapper: retryingWrapper,
    });

    result.current.mutate(3);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(restoreSpy).toHaveBeenCalledTimes(1);
  });
});
