/**
 * What the layout hook sends when it writes, and what it says about a read.
 *
 * The writes are asserted as the REQUEST that leaves the browser, because the
 * guards are only guards if they reach the server: a reset that forgot its
 * version and scope would delete an arrangement another tab had just saved.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardLayoutResponse } from "@admin/types/dashboard/widgets";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: api }));

import { useDashboardLayout } from "../useDashboardLayout";

function read(patch: Partial<DashboardLayoutResponse> = {}) {
  return {
    placements: [
      { id: "p1", widgetId: "core/a", width: "half", removed: false },
    ],
    widgets: {},
    available: [],
    defaultPlacements: [],
    version: 4,
    source: "own",
    scope: "scope token/with+symbols",
    audience: "aud",
    ...patch,
  } satisfies DashboardLayoutResponse;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue(read());
  api.put.mockResolvedValue({ message: "ok", item: {} });
  api.delete.mockResolvedValue({ message: "ok" });
});

describe("the saved reset", () => {
  it("sends the version and scope it was staged against as query parameters", async () => {
    const { result } = renderHook(() => useDashboardLayout(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBeDefined());

    await act(async () => {
      await result.current.reset.mutateAsync({
        version: 4,
        scope: "scope token/with+symbols",
      });
    });

    // 🔴 Both guards, encoded. The server refuses a DELETE missing either, and
    // a scope sent raw would arrive with `+` read as a space and never match.
    expect(api.delete).toHaveBeenCalledWith(
      "/dashboard/layout?version=4&scope=scope+token%2Fwith%2Bsymbols"
    );
    // The control for the encoding: the parameters round-trip to exactly what
    // was given, which a hand-built string with a missing encode would not.
    const [path] = api.delete.mock.calls[0] as [string];
    const sent = new URL(path, "http://admin.test").searchParams;
    expect(sent.get("version")).toBe("4");
    expect(sent.get("scope")).toBe("scope token/with+symbols");
  });
});

describe("a save", () => {
  it("sends the whole ordered list with both guards and what kind of write it is", async () => {
    const { result } = renderHook(() => useDashboardLayout(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBeDefined());

    const input = {
      placements: [
        { id: "p2", widgetId: "core/b", width: "full", removed: false },
        { id: "p1", widgetId: "core/a", width: "half", removed: true },
      ],
      version: 4,
      scope: "s",
      arranged: true,
      replaceUnreadable: true,
    };
    await act(async () => {
      await result.current.save.mutateAsync(input);
    });

    expect(api.put).toHaveBeenCalledWith("/dashboard/layout", input);
  });
});

describe("an unreadable stored arrangement", () => {
  it("is reported as such, and still counts as a row that can be reset", async () => {
    api.get.mockResolvedValue(read({ source: "unreadable", version: 9 }));
    const { result } = renderHook(() => useDashboardLayout(), { wrapper });

    await waitFor(() => expect(result.current.isUnreadable).toBe(true));
    expect(result.current.hasStoredRow).toBe(true);
  });

  it("is not reported for a reader's own readable arrangement", async () => {
    const { result } = renderHook(() => useDashboardLayout(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBeDefined());
    expect(result.current.isUnreadable).toBe(false);
  });
});
