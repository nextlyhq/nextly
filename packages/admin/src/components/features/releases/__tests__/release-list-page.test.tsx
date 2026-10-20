/**
 * What the release list shows while its next read is on its way.
 *
 * Within one tab it keeps the rows it has, so a page turn does not collapse
 * the table; across tabs it shows none, because rows from the tab just left
 * would be listed under the tab just opened.
 *
 * @module components/features/releases/__tests__/release-list-page.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ReleaseListParams } from "@admin/types/releases";

const { fetchReleases } = vi.hoisted(() => ({ fetchReleases: vi.fn() }));

vi.mock("@admin/services/releaseApi", () => ({ fetchReleases }));

import { useReleaseListPage } from "@admin/hooks/queries/useReleases";

/** An answer naming the read it answers, so a test can tell whose rows show. */
function answerFor(params: ReleaseListParams) {
  return {
    items: [{ id: `${params.tab}-${params.page}` }],
    meta: { total: 30, hasNext: true },
  };
}

function setup(initial: ReleaseListParams) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook((params: ReleaseListParams) => useReleaseListPage(params), {
    wrapper,
    initialProps: initial,
  });
}

describe("the release list while its next read loads", () => {
  it("keeps the current rows while the next page of the same tab loads", async () => {
    fetchReleases.mockImplementation(async (params: ReleaseListParams) =>
      answerFor(params)
    );
    const { result, rerender } = setup({ tab: "upcoming", page: 1 });
    await waitFor(() =>
      expect(result.current.data?.items[0]?.id).toBe("upcoming-1")
    );

    // The next page never answers, so what shows is the placeholder.
    fetchReleases.mockImplementation(() => new Promise(() => {}));
    rerender({ tab: "upcoming", page: 2 });
    expect(result.current.data?.items[0]?.id).toBe("upcoming-1");
  });

  it("shows no rows from the tab just left while the opened tab loads", async () => {
    fetchReleases.mockImplementation(async (params: ReleaseListParams) =>
      answerFor(params)
    );
    const { result, rerender } = setup({ tab: "upcoming", page: 1 });
    await waitFor(() =>
      expect(result.current.data?.items[0]?.id).toBe("upcoming-1")
    );

    fetchReleases.mockImplementation(() => new Promise(() => {}));
    rerender({ tab: "done", page: 1 });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });
});
