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

import { SCHEMA_UPDATED_EVENT } from "@admin/hooks/useSchemaUpdateInvalidation";

import { useDashboardLayout } from "../useDashboardLayout";
import { useDashboardSummary } from "../useDashboardSummary";

function read(patch: Partial<DashboardLayoutResponse> = {}) {
  return {
    placements: [{ id: "p1", widgetId: "core/a", w: 6, h: 3, removed: false }],
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
        { id: "p2", widgetId: "core/b", w: 12, h: 3, removed: false },
        { id: "p1", widgetId: "core/a", w: 6, h: 3, removed: true },
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

describe("a card's settings written outside customise mode", () => {
  it("holds every other layout write while in flight, and keeps its failure off the editor's chrome", async () => {
    let fail: (error: Error) => void = () => {};
    api.put.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const { result } = renderHook(() => useDashboardLayout(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBeDefined());

    act(() => {
      result.current.cardSettings.mutate({
        placements: [],
        version: 4,
        scope: "s",
        arranged: false,
      });
    });
    // In flight: every layout control waits, as for a dismissal, because a
    // second write would carry the same version guard.
    await waitFor(() => expect(result.current.isWriting).toBe(true));

    await act(async () => {
      fail(Object.assign(new Error("Conflict"), { status: 409 }));
    });
    await waitFor(() => expect(result.current.cardSettings.isError).toBe(true));
    // Reported by the card, not by the editor's chrome, which a reader who is
    // not customising is not looking at.
    expect(result.current.isConflict).toBe(false);
    expect(result.current.writeError).toBeNull();
    expect(result.current.isWriting).toBe(false);
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

describe("the header's summary, beside the layout", () => {
  /** Each summary read, numbered, so a re-read is told from the first. */
  function summaryReads() {
    let reads = 0;
    api.get.mockImplementation(async (path: string) => {
      if (path !== "/dashboard/summary") return read();
      reads += 1;
      return { parts: [], failed: 0, read: reads };
    });
    return () => reads;
  }

  function mountBoth() {
    return renderHook(
      () => ({ layout: useDashboardLayout(), summary: useDashboardSummary() }),
      { wrapper }
    );
  }

  const placements = [
    { id: "p1", widgetId: "core/a", w: 6, h: 3, removed: true },
  ];

  it.each([
    [
      "a save",
      (layout: ReturnType<typeof useDashboardLayout>) =>
        layout.save.mutateAsync({
          placements,
          version: 4,
          scope: "s",
          arranged: true,
        }),
    ],
    [
      "a dismissal",
      (layout: ReturnType<typeof useDashboardLayout>) =>
        layout.dismiss.mutateAsync({
          placements,
          version: 4,
          scope: "s",
          arranged: false,
        }),
    ],
    [
      "a reset",
      (layout: ReturnType<typeof useDashboardLayout>) =>
        layout.reset.mutateAsync({ version: 4, scope: "s" }),
    ],
  ])("is read again after %s, as the layout is", async (_name, write) => {
    const reads = summaryReads();
    const { result } = mountBoth();
    await waitFor(() => expect(result.current.layout.layout).toBeDefined());
    await waitFor(() => expect(result.current.summary.data).toBeDefined());
    expect(reads()).toBe(1);

    await act(async () => {
      await write(result.current.layout);
    });

    // The summary the reader sees is the one read after the write, not the
    // one read before it.
    await waitFor(() =>
      expect(result.current.summary.data).toMatchObject({ read: 2 })
    );
  });
  it("is read again when the schema changes, as the layout is", async () => {
    // Mounted alone, so nothing but its own listener can read it again: a
    // schema change can add, remove or change what its parts count.
    const reads = summaryReads();
    const { result } = renderHook(() => useDashboardSummary(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(reads()).toBe(1);

    act(() => {
      window.dispatchEvent(new Event(SCHEMA_UPDATED_EVENT));
    });

    await waitFor(() => expect(result.current.data).toMatchObject({ read: 2 }));
  });
});
