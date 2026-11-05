/**
 * A bulk update sends each document's version, and names the documents it
 * left alone because they changed since they were selected.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateByIDs, warning } = vi.hoisted(() => ({
  updateByIDs: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...actual, entryApi: { ...actual.entryApi, updateByIDs } };
});
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning, dismiss: vi.fn() },
}));

import { useBulkUpdateEntries } from "../useBulkEntries";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("a bulk update", () => {
  it("sends each document's version, and names those changed since they were selected", async () => {
    updateByIDs.mockResolvedValue({
      message: "Updated 1 of 2 entries.",
      items: [{ id: "a" }],
      errors: [
        {
          id: "b",
          code: "STALE_VERSION",
          message: "This document changed since the version you gave.",
        },
      ],
    });
    const { result } = renderHook(
      () => useBulkUpdateEntries({ collectionSlug: "posts" }),
      { wrapper }
    );

    await result.current.mutateAsync({
      ids: ["a", "b"],
      data: { status: "published" },
      revs: { a: "3", b: "5" },
    });

    expect(updateByIDs).toHaveBeenCalledWith("posts", {
      ids: ["a", "b"],
      data: { status: "published" },
      revs: { a: "3", b: "5" },
    });
    expect(warning).toHaveBeenCalledWith(
      "Updated 1 of 2 entries.",
      expect.objectContaining({
        description: expect.stringMatching(
          /1 entry changed since you selected it/
        ),
      })
    );
  });
});
