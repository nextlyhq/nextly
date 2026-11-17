/**
 * Which releases hold a document, read as the page renders: the banner, the
 * Publish split and the Publishing section then take that read under the same
 * key rather than asking again once the editor is drawn. Nothing is read
 * without the grant, or without a whole document reference.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchReleases } = vi.hoisted(() => ({ fetchReleases: vi.fn() }));
vi.mock("@admin/services/releaseApi", () => ({ fetchReleases }));

import {
  useReleasesContaining,
  useStartReleasesContaining,
} from "../useReleasesContaining";

const DOCUMENT = {
  scopeKind: "collection" as const,
  scopeSlug: "pages",
  entryId: "e1",
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  fetchReleases.mockReset();
  fetchReleases.mockResolvedValue({ items: [], meta: { total: 0 } });
});

describe("useStartReleasesContaining", () => {
  it("starts the read the banner then takes, once", async () => {
    const { wrapper } = setup();
    const page = renderHook(() => useStartReleasesContaining(DOCUMENT, true), {
      wrapper,
    });
    page.rerender();
    expect(fetchReleases).toHaveBeenCalledTimes(1);
    expect(fetchReleases).toHaveBeenCalledWith({
      containing: DOCUMENT,
      limit: 200,
    });

    const banner = renderHook(() => useReleasesContaining(DOCUMENT, true), {
      wrapper,
    });
    await waitFor(() => expect(banner.result.current.data).toBeDefined());
    expect(fetchReleases).toHaveBeenCalledTimes(1);
  });

  it("reads nothing without the grant or a document", () => {
    const { wrapper } = setup();
    renderHook(() => useStartReleasesContaining(DOCUMENT, false), { wrapper });
    renderHook(() => useStartReleasesContaining(undefined, true), { wrapper });
    expect(fetchReleases).not.toHaveBeenCalled();
  });
});
