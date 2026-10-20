/**
 * The page's readiness read follows the list it describes.
 *
 * A document can become invalid while the page stays open. The list re-reads
 * itself (its poll, or a refresh after an action), and the readiness of the
 * page has to be asked again then too, or a release goes on reading "Ready"
 * after it stopped being so.
 *
 * @module components/features/releases/__tests__/release-page-readiness.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchReleasesReadiness } = vi.hoisted(() => ({
  fetchReleasesReadiness: vi.fn(),
}));

vi.mock("@admin/services/releaseApi", () => ({ fetchReleasesReadiness }));

import { useReleasesReadiness } from "@admin/hooks/queries/useReleases";

/** The hard problems of the first release in an answer, when it was checked. */
function hardOf(
  data: { items: Array<{ checked: boolean; hard?: unknown[] }> } | undefined
): unknown[] | undefined {
  const entry = data?.items[0];
  return entry?.checked ? entry.hard : undefined;
}

function setup(initial: { ids: string[]; listReadAt: number }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ ids, listReadAt }: { ids: string[]; listReadAt: number }) =>
      useReleasesReadiness(ids, listReadAt),
    { wrapper, initialProps: initial }
  );
}

beforeEach(() => {
  fetchReleasesReadiness.mockReset();
});

describe("the page's readiness", () => {
  it("is asked again each time the list is read again, for the same releases", async () => {
    fetchReleasesReadiness
      .mockResolvedValueOnce({
        items: [{ releaseId: "r1", checked: true, hard: [], soft: [] }],
        meta: { total: 1 },
      })
      .mockResolvedValueOnce({
        items: [
          {
            releaseId: "r1",
            checked: true,
            hard: [{ memberId: "m1", code: "REQUIRED_FIELD_MISSING" }],
            soft: [],
          },
        ],
        meta: { total: 1 },
      });
    const { result, rerender } = setup({ ids: ["r1"], listReadAt: 1 });
    await waitFor(() => expect(hardOf(result.current.data)).toEqual([]));

    // The list polled and came back with the same release.
    rerender({ ids: ["r1"], listReadAt: 2 });
    await waitFor(() => expect(hardOf(result.current.data)).toHaveLength(1));
    expect(fetchReleasesReadiness).toHaveBeenCalledTimes(2);
  });

  it("is not asked again while the list has not been read again", async () => {
    fetchReleasesReadiness.mockResolvedValue({
      items: [{ releaseId: "r1", checked: true, hard: [], soft: [] }],
      meta: { total: 1 },
    });
    const { result, rerender } = setup({ ids: ["r1"], listReadAt: 5 });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ ids: ["r1"], listReadAt: 5 });
    expect(fetchReleasesReadiness).toHaveBeenCalledTimes(1);
  });
});
