/**
 * A standalone panel left open asks for its numbers again when the reader
 * comes back to the tab, once its answer is stale, although the admin turns
 * focus refetching off for every other query.
 */
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import { usePluginPanelCounts } from "../usePluginPanelCounts";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { get } }));

/**
 * Mirrors the admin's QueryProvider, which turns focus refetching off for
 * every query: with the library's default (on), the test would pass whether
 * or not the hook opts back in.
 */
function providerWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PLUGIN = {
  name: "@acme/library",
  placement: "standalone",
  menu: [
    {
      label: "Patterns",
      to: "/admin/collections/patterns",
      count: { collection: "patterns" },
    },
  ],
} as PluginMetadata;

describe("a panel's numbers when the reader comes back", () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
    get.mockReset();
  });

  it("are asked again on focus once the answer is stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    get.mockResolvedValue({
      numbers: [{ index: 0, value: 3, atLeast: false }],
    });

    renderHook(() => usePluginPanelCounts(PLUGIN), {
      wrapper: providerWrapper,
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    // Past the 30 seconds an answer is kept for.
    vi.setSystemTime(Date.now() + 31_000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
