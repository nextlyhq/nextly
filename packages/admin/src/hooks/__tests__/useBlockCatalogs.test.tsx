/**
 * The blocks each blocks field accepts are asked of the Page Builder's block
 * listing: once per distinct allow-list, sent exactly as stored; a listing the
 * admin cannot reach is told apart from a read that failed, and an answer of
 * another shape is never read as blocks.
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

const writePluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@admin/hooks/queries/usePluginRouteMutation", () => ({
  writePluginRoute,
}));

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

const states = (catalogs: ReadonlyMap<string, { state: string }>) =>
  [...catalogs.values()].map(catalog => catalog.state).sort();

describe("useBlockCatalogs", () => {
  it("asks once per allow-list, exactly as stored, and for every block when a field names none", async () => {
    writePluginRoute.mockResolvedValue({ items: [], meta: { total: 0 } });
    const lists = new Map<string, readonly string[] | undefined>([
      ["*", undefined],
      ['["core/heading,acme/hero"," x/y"]', ["core/heading,acme/hero", " x/y"]],
    ]);
    const { result } = renderHook(() => useBlockCatalogs(lists), { wrapper });
    await waitFor(() =>
      expect(states(result.current)).toEqual(["loaded", "loaded"])
    );
    expect(writePluginRoute.mock.calls.map(([call]) => call)).toEqual(
      expect.arrayContaining([
        {
          plugin: "@nextlyhq/plugin-page-builder",
          path: "/blocks/accepted",
          body: { allow: null },
        },
        {
          plugin: "@nextlyhq/plugin-page-builder",
          path: "/blocks/accepted",
          body: { allow: ["core/heading,acme/hero", " x/y"] },
        },
      ])
    );
    expect(writePluginRoute).toHaveBeenCalledTimes(2);
  });

  it("says the listing is not there, apart from a failed read", async () => {
    writePluginRoute.mockReset();
    writePluginRoute.mockRejectedValueOnce(apiError(404));
    writePluginRoute.mockRejectedValueOnce(apiError(500));
    const lists = new Map<string, readonly string[] | undefined>([
      ['["a/x"]', ["a/x"]],
      ['["b/y"]', ["b/y"]],
    ]);
    const { result } = renderHook(() => useBlockCatalogs(lists), { wrapper });
    await waitFor(() =>
      expect(states(result.current)).toEqual(["failed", "unavailable"])
    );
  });

  it("reads an answer of another shape as a listing that could not be read", async () => {
    writePluginRoute.mockReset();
    // A renamed field: no `matchedBy` on the item.
    writePluginRoute.mockResolvedValueOnce({
      items: [
        {
          name: "core/heading",
          label: "Heading",
          description: "",
          source: null,
          matches: [],
          props: [],
        },
      ],
      meta: { total: 1 },
    });
    const lists = new Map<string, readonly string[] | undefined>([
      ['["core/heading"]', ["core/heading"]],
    ]);
    const { result } = renderHook(() => useBlockCatalogs(lists), { wrapper });
    await waitFor(() => expect(states(result.current)).toEqual(["failed"]));
  });
});
