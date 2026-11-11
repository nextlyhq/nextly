// @vitest-environment jsdom
/**
 * The two reads a list of collections, Singles or field groups makes: one
 * page of the site's own entries, and every one of the plugins'.
 *
 * Observed at the fetcher, which is where the owner becomes part of the
 * request the server filters by.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";

import {
  usePluginEntities,
  useSiteEntityPage,
} from "../use-entity-lists-by-owner";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

const meta = (hasNext: boolean) => ({
  total: 0,
  page: 1,
  limit: 100,
  totalPages: 1,
  hasNext,
  hasPrev: false,
});

describe("useSiteEntityPage", () => {
  it("asks for the site's entries, with the table's page as given", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ items: [{ slug: "posts" }], meta: meta(false) });
    const params = {
      pagination: { page: 2, pageSize: 10 },
      sorting: [],
      filters: { search: "po" },
    };

    const { result } = renderHook(
      () => useSiteEntityPage(["collections", "list"], params, fetchPage),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchPage).toHaveBeenCalledWith(params, "site");
    expect(result.current.data?.items).toEqual([{ slug: "posts" }]);
  });
});

describe("usePluginEntities", () => {
  it("reads every page of the plugins' entries, not the first alone", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ slug: "a" }], meta: meta(true) })
      .mockResolvedValueOnce({ items: [{ slug: "b" }], meta: meta(false) });

    const { result } = renderHook(
      () => usePluginEntities(["collections", "list"], fetchPage),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ slug: "a" }, { slug: "b" }]);
    expect(
      fetchPage.mock.calls.map(call => [call[0].pagination.page, call[1]])
    ).toEqual([
      [0, "plugins"],
      [1, "plugins"],
    ]);
  });
});
