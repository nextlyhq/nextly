/**
 * The outline reads every field group it may show as one list, to its last
 * page: a field group used inside another needs no second round, no field
 * group is asked for on its own, and one past the first page is still read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createTestQueryClient,
  renderHook,
  waitFor,
} from "@admin/__tests__/utils";

import { useOutlineFieldGroups } from "../useOutlineFieldGroups";

const fetchComponents = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/fieldGroupApi", () => ({
  fieldGroupApi: { fetchComponents, get },
}));

/** One page of the list, saying whether another follows. */
const page = (items: unknown[], hasNext = false) => ({
  items,
  meta: { hasNext },
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useOutlineFieldGroups", () => {
  it("reads every field group, a nested one included, in one request", async () => {
    fetchComponents.mockResolvedValueOnce(
      page([
        {
          slug: "seo",
          label: "SEO",
          fields: [{ name: "social", type: "component", component: "social" }],
        },
        { slug: "social", label: "Social", fields: [] },
      ])
    );
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("loaded"));
    expect([...result.current.fieldGroups.keys()]).toEqual(["seo", "social"]);
    expect(fetchComponents).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("reads past the first page, so a field group there is not taken for a missing one", async () => {
    fetchComponents
      .mockResolvedValueOnce(
        page([{ slug: "seo", label: "SEO", fields: [] }], true)
      )
      .mockResolvedValueOnce(
        page([{ slug: "social", label: "Social", fields: [] }])
      );
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("loaded"));
    expect([...result.current.fieldGroups.keys()]).toEqual(["seo", "social"]);
    expect(
      fetchComponents.mock.calls.map(
        ([params]) =>
          (params as { pagination: { page: number } }).pagination.page
      )
    ).toEqual([0, 1]);
  });

  it("carries whether each field group translates its fields", async () => {
    fetchComponents.mockResolvedValueOnce(
      page([
        { slug: "seo", label: "SEO", fields: [], localized: true },
        { slug: "social", label: "Social", fields: [] },
      ])
    );
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("loaded"));
    expect(result.current.fieldGroups.get("seo")?.localized).toBe(true);
    expect(result.current.fieldGroups.get("social")?.localized).toBe(false);
  });

  it("says it could not read them, rather than looking like it is still loading", async () => {
    fetchComponents.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("failed"));
    expect(result.current.fieldGroups.size).toBe(0);
  });

  it("reads the use counts again on the next visit, under the admin's own cache settings", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 5 * 60_000, gcTime: 10 * 60_000 },
      },
    });
    const withClient = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    fetchComponents.mockResolvedValueOnce(
      page([{ slug: "seo", label: "SEO", fields: [], placedBy: 1 }])
    );
    const first = renderHook(() => useOutlineFieldGroups(), {
      wrapper: withClient,
    });
    await waitFor(() =>
      expect(first.result.current.fieldGroups.get("seo")?.placedBy).toBe(1)
    );
    first.unmount();

    // A collection now places it too; its save refreshed only its own keys.
    fetchComponents.mockResolvedValueOnce(
      page([{ slug: "seo", label: "SEO", fields: [], placedBy: 2 }])
    );
    const next = renderHook(() => useOutlineFieldGroups(), {
      wrapper: withClient,
    });
    await waitFor(() =>
      expect(next.result.current.fieldGroups.get("seo")?.placedBy).toBe(2)
    );
  });
});
