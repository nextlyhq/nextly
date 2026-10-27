/**
 * A bulk delete of collections is one request naming every collection, and
 * its result is all or nothing.
 *
 * The server checks the whole set before removing any of it: collections that
 * point only at one another can go together, and one that something outside
 * the set depends on refuses the lot. Sent as one delete per collection, the
 * first of two that point at each other is refused while the second still
 * exists, and a refusal of one leaves the others deleted.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("@admin/lib/api/fetcher", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/lib/api/fetcher")>();
  return { ...actual, fetcher: fetcherSpy };
});

import { useBulkDeleteCollections } from "../useCollections";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetcherSpy.mockReset();
});

describe("useBulkDeleteCollections", () => {
  it("sends one delete naming every collection", async () => {
    fetcherSpy.mockResolvedValue({ message: "Collections deleted!", item: {} });
    const { result } = renderHook(() => useBulkDeleteCollections(), {
      wrapper,
    });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      outcome = await result.current.mutateAsync(
        ["tags", "posts", "notes"],
        undefined
      );
    });

    expect(fetcherSpy).toHaveBeenCalledTimes(1);
    expect(fetcherSpy).toHaveBeenCalledWith(
      `/collections/tags?together=${encodeURIComponent("posts,notes")}`,
      { method: "DELETE" },
      true
    );
    expect(outcome!).toMatchObject({
      succeeded: 3,
      failed: 0,
      total: 3,
      succeededIds: ["tags", "posts", "notes"],
      failedIds: [],
    });
  });

  it("reports every collection failed with the server's refusal when it refuses", async () => {
    const refusal = new Error(
      'Nothing was deleted, because other schema depends on "tags".'
    );
    fetcherSpy.mockRejectedValue(refusal);
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useBulkDeleteCollections(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(["tags", "posts"], undefined, {
        onError,
        onSuccess,
      });
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        succeeded: 0,
        failed: 2,
        failedIds: ["tags", "posts"],
        results: [
          { id: "tags", status: "rejected", error: refusal },
          { id: "posts", status: "rejected", error: refusal },
        ],
      })
    );
    expect(result.current.isPending).toBe(false);
  });
});
