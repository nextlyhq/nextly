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

const { fetcherSpy, mirrorSpy, warningSpy } = vi.hoisted(() => ({
  fetcherSpy: vi.fn(),
  mirrorSpy: vi.fn(),
  warningSpy: vi.fn(),
}));

vi.mock("@admin/lib/api/fetcher", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/lib/api/fetcher")>();
  return { ...actual, fetcher: fetcherSpy };
});

// The Builder's committed definitions: a delete removes the collection there
// too, as the single delete does.
vi.mock("@admin/services/schemaFileApi", () => ({
  schemaFileApi: { deleteCollection: mirrorSpy },
}));

vi.mock("@admin/components/ui", () => ({
  toast: {
    success: vi.fn(),
    warning: warningSpy,
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { useBulkDeleteCollections } from "../useCollections";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetcherSpy.mockReset();
  mirrorSpy.mockReset();
  mirrorSpy.mockResolvedValue({ message: "removed", kind: "collection" });
  warningSpy.mockReset();
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

  it("removes each deleted collection from the committed definitions, as the single delete does", async () => {
    fetcherSpy.mockResolvedValue({ message: "Collections deleted!", item: {} });
    const { result } = renderHook(() => useBulkDeleteCollections(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(["tags", "posts"], undefined);
    });

    expect(mirrorSpy.mock.calls).toEqual([["tags"], ["posts"]]);
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it("warns, and still reports the delete, when the definitions cannot be updated", async () => {
    // The database delete has committed by then: the result says so, and the
    // drift between the two is named rather than hidden.
    fetcherSpy.mockResolvedValue({ message: "Collections deleted!", item: {} });
    mirrorSpy.mockRejectedValueOnce(new Error("ui-schema.json is read-only"));
    const { result } = renderHook(() => useBulkDeleteCollections(), {
      wrapper,
    });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      outcome = await result.current.mutateAsync(["tags", "posts"], undefined);
    });

    expect(outcome!).toMatchObject({ succeeded: 2, failed: 0 });
    expect(mirrorSpy).toHaveBeenCalledTimes(2);
    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(String(warningSpy.mock.calls[0][0])).toContain(
      "ui-schema.json could not be updated for tags: ui-schema.json is read-only"
    );
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
    // Nothing was deleted, so nothing leaves the committed definitions.
    expect(mirrorSpy).not.toHaveBeenCalled();
  });
});
