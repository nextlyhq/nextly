/**
 * A plugin's UI writing to its own route.
 *
 * The assertions that matter are the two a plugin author cannot check for
 * themselves: that the request goes to the namespace the dispatcher actually
 * serves, and that a failure cannot escape as an unhandled rejection.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { postSpy, putSpy, patchSpy, deleteSpy, getSpy } = vi.hoisted(() => ({
  postSpy: vi.fn(),
  putSpy: vi.fn(),
  patchSpy: vi.fn(),
  deleteSpy: vi.fn(),
  getSpy: vi.fn(),
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: getSpy,
    post: postSpy,
    put: putSpy,
    patch: patchSpy,
    delete: deleteSpy,
  },
}));

import { usePluginRoute } from "../usePluginRoute";
import { usePluginRouteMutation } from "../usePluginRouteMutation";

let client: QueryClient;
function wrapper() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const write = { plugin: "@acme/p", path: "/patterns" };

beforeEach(() => {
  for (const spy of [postSpy, putSpy, patchSpy, deleteSpy, getSpy]) {
    spy.mockReset();
  }
  postSpy.mockResolvedValue({ id: "p1" });
  getSpy.mockResolvedValue({ items: [] });
});

describe("usePluginRouteMutation", () => {
  it("writes to the path the DISPATCHER serves the route at", async () => {
    // A request to a path nothing serves does not raise. It is answered by
    // nothing and reads as a route that did no work, so the address is the one
    // thing a plugin author cannot discover from a failure.
    const { result } = renderHook(() => usePluginRouteMutation(write), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.write({ title: "Hero" });
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [path, body] = postSpy.mock.calls[0] ?? [];
    expect(path).toContain("@acme/p");
    expect(path).toContain("/patterns");
    expect(body).toEqual({ title: "Hero" });
  });

  it("answers with what the route returned", async () => {
    const { result } = renderHook(
      () => usePluginRouteMutation<{ title: string }, { id: string }>(write),
      { wrapper: wrapper() }
    );

    let answered: { id: string } | undefined;
    await act(async () => {
      answered = await result.current.write({ title: "Hero" });
    });

    expect(answered).toEqual({ id: "p1" });
    expect(result.current.error).toBeNull();
  });

  it("RESOLVES on failure rather than rejecting, and reports the cause", async () => {
    // A rejecting promise is the idiomatic TanStack shape and a footgun on a
    // surface handed to third parties: a caller who does not wrap the await
    // gets an unhandled rejection for a failure already reported on `error`.
    postSpy.mockRejectedValue(new Error("route said no"));
    const { result } = renderHook(() => usePluginRouteMutation(write), {
      wrapper: wrapper(),
    });

    let answered: unknown = "not set";
    await act(async () => {
      // Deliberately unwrapped: this is the call that must not throw.
      answered = await result.current.write({ title: "Hero" });
    });

    expect(answered).toBeUndefined();
    await waitFor(() =>
      expect(result.current.error?.message).toBe("route said no")
    );
  });

  it("refreshes the reads the plugin NAMED, and only those", async () => {
    // Nothing here knows which reads a write affects; the plugin does. The
    // named path is resolved through the plugin's own name, so a plugin cannot
    // invalidate another plugin's cached reads however it spells one.
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { result } = renderHook(
      () => usePluginRouteMutation({ ...write, invalidates: ["/library"] }),
      { wrapper: wrapper() }
    );

    await act(async () => {
      await result.current.write({ title: "Hero" });
    });

    const keys = invalidate.mock.calls.map(
      ([arg]) => (arg as { queryKey: unknown[] }).queryKey
    );
    const named = keys.filter(k => String(k[1]).includes("/library"));
    expect(named).toHaveLength(1);
    // Addressed exactly as the READ hook keys it — a prefix nothing reads
    // would invalidate nothing while looking correct.
    expect(String(named[0]?.[1])).toContain("@acme/p");
    expect(named[0]?.[0]).toBe("plugin-route");
    invalidate.mockRestore();
  });

  it("uses the verb the caller asked for", async () => {
    const { result } = renderHook(
      () => usePluginRouteMutation({ ...write, method: "DELETE" }),
      { wrapper: wrapper() }
    );

    await act(async () => {
      await result.current.write({ id: "p1" });
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("reports a write in flight, and stops when it settles", async () => {
    let release: (value: { id: string }) => void = () => {};
    postSpy.mockReturnValue(
      new Promise<{ id: string }>(resolve => {
        release = resolve;
      })
    );
    const { result } = renderHook(() => usePluginRouteMutation(write), {
      wrapper: wrapper(),
    });

    expect(result.current.pending).toBe(false);
    let pendingWrite: Promise<unknown> | undefined;
    act(() => {
      pendingWrite = result.current.write({ title: "Hero" });
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      release({ id: "p1" });
      await pendingWrite;
    });

    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});
