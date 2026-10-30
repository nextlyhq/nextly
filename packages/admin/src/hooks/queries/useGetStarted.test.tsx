/**
 * The card's steps come from the layout read, and a removed card restored in customise mode
 * asks for its steps, so it shows its progress before the save that restores it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchDashboardLayout, fetchGetStartedOnRestore } = vi.hoisted(() => ({
  fetchDashboardLayout: vi.fn(),
  fetchGetStartedOnRestore: vi.fn(),
}));
vi.mock("./useDashboardLayout", async importOriginal => ({
  ...(await importOriginal<typeof import("./useDashboardLayout")>()),
  fetchDashboardLayout,
  fetchGetStartedOnRestore,
}));

import { DASHBOARD_LAYOUT_KEY } from "./useDashboardLayout";
import { useGetStarted } from "./useGetStarted";

const open = {
  unknown: false,
  steps: [{ key: "invite", kind: "invite", status: "open" }],
  done: 0,
  total: 1,
};

function layoutWith(getStarted: unknown, config?: Record<string, unknown>) {
  return {
    placements: [
      {
        id: "started",
        widgetId: "core/get-started",
        w: 12,
        h: 3,
        removed: false,
        ...(config ? { config } : {}),
      },
    ],
    getStarted,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchDashboardLayout.mockReset();
  fetchGetStartedOnRestore.mockReset();
});

describe("the Get started steps", () => {
  it("read the layout the grid has just read, asking for it again only when there is none", async () => {
    // 🔴 The card mounts once the grid's layout read has answered. Asking again as it mounts
    // read the layout twice on every dashboard load.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      DASHBOARD_LAYOUT_KEY,
      layoutWith({ drawn: true, answer: open })
    );
    const { result } = renderHook(() => useGetStarted("started"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(result.current.answer).toEqual(open);
    // Let a mount's read, were there one, be asked.
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(fetchDashboardLayout).not.toHaveBeenCalled();

    // The control: with nothing in the cache, the card still asks, once.
    fetchDashboardLayout.mockResolvedValue(
      layoutWith({ drawn: true, answer: open })
    );
    const alone = renderHook(() => useGetStarted("started"), { wrapper });
    await waitFor(() => expect(alone.result.current.answer).toEqual(open));
    expect(fetchDashboardLayout).toHaveBeenCalledOnce();
  });

  it("are the layout read's, with no second request", async () => {
    fetchDashboardLayout.mockResolvedValue(
      layoutWith({ drawn: true, answer: open }, { acted: true })
    );
    const { result } = renderHook(() => useGetStarted("started"), { wrapper });
    await waitFor(() => expect(result.current.answer).toEqual(open));
    expect(result.current.acted).toBe(true);
    expect(fetchGetStartedOnRestore).not.toHaveBeenCalled();
  });

  it("are asked for when the layout read holds none, as for a card restored in customise mode", async () => {
    // 🔴 Restored but not yet saved, the card is removed in the stored row,
    // so the layout read worked out no steps and the card drew nothing.
    fetchDashboardLayout.mockResolvedValue(
      layoutWith({ drawn: false, answer: null })
    );
    fetchGetStartedOnRestore.mockResolvedValue(
      layoutWith({ drawn: false, answer: open })
    );
    const { result } = renderHook(() => useGetStarted("started"), { wrapper });
    await waitFor(() => expect(result.current.answer).toEqual(open));
    expect(fetchGetStartedOnRestore).toHaveBeenCalledOnce();
  });

  it("report a failed read as unavailable, never as finished", async () => {
    fetchDashboardLayout.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useGetStarted("started"), { wrapper });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.answer).toBeUndefined();
  });
});
