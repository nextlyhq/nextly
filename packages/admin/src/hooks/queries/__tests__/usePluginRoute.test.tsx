/**
 * A plugin's UI reading its own route.
 *
 * The assertion that matters most is the PATH. A request to a path nothing
 * serves does not raise — it answers, with nothing — so a hook that addressed
 * the wrong namespace would look exactly like a plugin whose route returned an
 * empty list, on every site, forever.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: getSpy },
}));

import { usePluginRoute } from "../usePluginRoute";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockResolvedValue({ items: [] });
});

describe("usePluginRoute", () => {
  it("asks the path the DISPATCHER serves the route at", async () => {
    // `/plugins/<package name><route path>`, which is what
    // `pluginRouteFullPath` answers on the server. Spelled any other way, the
    // request 404s and the caller sees an empty answer.
    const { result } = renderHook(
      () =>
        usePluginRoute({
          plugin: "@nextlyhq/plugin-page-builder",
          path: "/library",
        }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(getSpy).toHaveBeenCalledWith(
      "/plugins/@nextlyhq/plugin-page-builder/library"
    );
  });

  it("reads through the AUTHENTICATED client", async () => {
    // A plugin route is authenticated unless it opts out, so a read that did
    // not carry the session would 401 on every route worth having.
    renderHook(() => usePluginRoute({ plugin: "@acme/p", path: "/things" }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(getSpy).toHaveBeenCalled());
  });

  it("returns the body, and stops being pending", async () => {
    getSpy.mockResolvedValue({ items: [{ id: "a" }] });

    const { result } = renderHook(
      () =>
        usePluginRoute<{ items: unknown[] }>({
          plugin: "@acme/p",
          path: "/things",
        }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.data).toEqual({ items: [{ id: "a" }] });
  });

  it("makes no request when it is not enabled, and does not report pending", async () => {
    // `isPending` is true for a disabled query too — it has no data and never
    // asked — so reading it alone would spin forever on a panel nobody opened.
    const { result } = renderHook(
      () =>
        usePluginRoute({
          plugin: "@acme/p",
          path: "/things",
          enabled: false,
        }),
      { wrapper: wrapper() }
    );

    expect(getSpy).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("does not let two plugins share one cache entry for the same path", async () => {
    // Both contribute `/library`. Keyed on the path alone, the second plugin
    // would be answered with the first one's library.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => usePluginRoute({ plugin: "@a/one", path: "/library" }), {
      wrapper: shared,
    });
    renderHook(() => usePluginRoute({ plugin: "@b/two", path: "/library" }), {
      wrapper: shared,
    });

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    expect(getSpy.mock.calls.map(c => c[0])).toEqual([
      "/plugins/@a/one/library",
      "/plugins/@b/two/library",
    ]);
  });

  it("re-reads on mount when the caller asked for freshness", async () => {
    // The admin holds a query fresh for five minutes and does not refetch on
    // focus, which suits lists whose writes invalidate their own keys. A plugin
    // route is not on that map, so a route serving something edited elsewhere
    // would show a stale list for five minutes — including the author's own
    // save. `staleTime: 0` is how a caller says its subject changes underneath
    // it.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const read = () =>
      renderHook(
        () =>
          usePluginRoute({
            plugin: "@acme/p",
            path: "/library",
            staleTime: 0,
          }),
        { wrapper: shared }
      );

    const first = read();
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    first.unmount();
    read();

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
  });

  it("takes the admin's caching when the caller does not ask", async () => {
    // The control. Without it the assertion above is satisfied by a hook that
    // always refetches, which would make every plugin route uncacheable.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const read = () =>
      renderHook(
        () => usePluginRoute({ plugin: "@acme/p", path: "/library" }),
        { wrapper: shared }
      );

    const first = read();
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    first.unmount();
    read();

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
  });

  it("reports an error rather than an empty answer", async () => {
    getSpy.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(
      () => usePluginRoute({ plugin: "@acme/p", path: "/things" }),
      { wrapper: wrapper() }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeUndefined();
  });
});
