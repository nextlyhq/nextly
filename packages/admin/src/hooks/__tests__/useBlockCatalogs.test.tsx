/**
 * The blocks each blocks field accepts are read from the Page Builder's
 * block listing: once per distinct allow-list, and a listing the admin cannot
 * reach is told apart from a read that failed.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createTestQueryClient,
  renderHook,
  waitFor,
} from "@admin/__tests__/utils";

import { useBlockCatalogs } from "../useBlockCatalogs";

const get = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { get } }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

/** An API error as the admin's fetcher throws one. */
function apiError(status: number): Error {
  return Object.assign(new Error(`status ${status}`), { status });
}

describe("useBlockCatalogs", () => {
  it("reads each allow-list once, and every block for a field naming none", async () => {
    get.mockResolvedValue({ items: [], meta: { total: 0 } });
    const lists = new Map<string, readonly string[] | undefined>([
      ["*", undefined],
      ['["core/*","acme/hero"]', ["core/*", "acme/hero"]],
    ]);
    const { result } = renderHook(() => useBlockCatalogs(lists), { wrapper });
    await waitFor(() =>
      expect([...result.current.values()].map(c => c.state)).toEqual([
        "loaded",
        "loaded",
      ])
    );
    expect(get.mock.calls.map(([path]) => path).sort()).toEqual([
      "/plugins/@nextlyhq/plugin-page-builder/blocks",
      `/plugins/@nextlyhq/plugin-page-builder/blocks?allow=${encodeURIComponent("core/*,acme/hero")}`,
    ]);
  });

  it("says the listing is not there, apart from a failed read", async () => {
    get.mockRejectedValueOnce(apiError(404));
    get.mockRejectedValueOnce(apiError(500));
    const lists = new Map<string, readonly string[] | undefined>([
      ['["a/x"]', ["a/x"]],
      ['["b/y"]', ["b/y"]],
    ]);
    const { result } = renderHook(() => useBlockCatalogs(lists), { wrapper });
    await waitFor(() =>
      expect(
        [...result.current.values()].map(catalog => catalog.state).sort()
      ).toEqual(["failed", "unavailable"])
    );
  });
});
