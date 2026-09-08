/**
 * A plugin's UI writing to its own route.
 *
 * The assertions that matter are the two a plugin author cannot check for
 * themselves: that the request goes to the namespace the dispatcher actually
 * serves, and that a failure cannot escape as an unhandled rejection.
 */
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
    defaultOptions: {
      queries: { retry: false },
      // 🔴 MIRRORS the app's own `QueryProvider`, which sets
      // `mutations.retry: MUTATION_RETRY_COUNT`. TanStack does not retry
      // mutations by default, so a test client that stayed silent here could
      // never observe an unwanted retry — the guard against one would read as
      // covered while nothing exercised it. `retryDelay: 0` so the attempts
      // happen in milliseconds rather than in backoff seconds.
      mutations: { retry: 2, retryDelay: 0 },
    },
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
    // EXACT, not containment. `toContain("@acme/p")` and `toContain("/patterns")`
    // are both satisfied by `/wrong/@acme/p/patterns`, so a hook that hardcoded
    // a non-dispatcher prefix stayed green on the one assertion written to stop
    // exactly that.
    expect(path).toBe("/plugins/@acme/p/patterns");
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

    // The COMPLETE list, unfiltered. Filtering to the named path first was the
    // flaw: an implementation that ALSO invalidated the bare `["plugin-route"]`
    // prefix — refetching every plugin route in the admin — passed a filtered
    // count while doing exactly what the test claims to prevent.
    const keys = invalidate.mock.calls.map(
      ([arg]) => (arg as { queryKey: unknown[] }).queryKey
    );
    expect(keys).toEqual([["plugin-route", "/plugins/@acme/p/library"]]);
    invalidate.mockRestore();
  });

  it("sends a FALSY body rather than dropping it", async () => {
    // `false`, `0`, `""` and `null` are all valid JSON a caller may mean to
    // send. The DELETE path tested whether the body was truthy, so it was the
    // one verb that silently disagreed with what `write(body)` promised — the
    // handler received an empty request while every other verb carried the
    // value.
    const { result } = renderHook(
      () =>
        usePluginRouteMutation<number, { ok: true }>({
          ...write,
          method: "DELETE",
        }),
      { wrapper: wrapper() }
    );

    await act(async () => {
      await result.current.write(0);
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0]?.[1]).toBe(0);
  });

  it("does NOT retry a write the admin would have retried", async () => {
    // The admin retries its own mutations twice, and this inherits that. A
    // plugin route has no idempotency key and no requirement to be idempotent,
    // and the default verb is POST — so a create that commits and then loses
    // its response would be sent again, twice, and one click becomes three
    // rows with nothing reporting it.
    postSpy.mockRejectedValue(new Error("connection lost"));
    const { result } = renderHook(() => usePluginRouteMutation(write), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.write({ title: "Hero" });
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a failure from a write that OVERLAPPED a later one", async () => {
    // TanStack's observer follows only the most recent call, so an older
    // rejection reaches no observer: `error` never saw it and `pending` went
    // false while that request was still running. A caller watching either
    // would be told the write succeeded.
    let failFirst: (reason: Error) => void = () => {};
    postSpy.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failFirst = reject;
      })
    );
    postSpy.mockResolvedValueOnce({ id: "second" });
    const { result } = renderHook(() => usePluginRouteMutation(write), {
      wrapper: wrapper(),
    });

    let first: Promise<unknown> | undefined;
    act(() => {
      first = result.current.write({ title: "first" });
    });
    await act(async () => {
      await result.current.write({ title: "second" });
    });
    await act(async () => {
      failFirst(new Error("the older write failed"));
      await first;
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe("the older write failed")
    );
  });

  it("sends a paused write to the target it was SUBMITTED against", async () => {
    // GENUINELY PAUSED, through TanStack's own online manager.
    //
    // Holding the transport's promise unresolved is not the same thing and does
    // not test this: the mutation function has already RUN by then, so it has
    // already read the route, and a closed-over implementation passes. What has
    // to be delayed is dispatch, not the response — offline, TanStack holds the
    // mutation before calling the function, and applies the options the hook
    // has when it reconnects.
    onlineManager.setOnline(false);
    try {
      const { result, rerender } = renderHook(
        (props: { path: string }) =>
          usePluginRouteMutation({ plugin: "@acme/p", path: props.path }),
        { wrapper: wrapper(), initialProps: { path: "/patterns" } }
      );

      let held: Promise<unknown> | undefined;
      act(() => {
        held = result.current.write({ title: "Hero" });
      });
      // Nothing has been dispatched: that is what makes the rerender below the
      // event this test is about.
      expect(postSpy).not.toHaveBeenCalled();

      // The hook is now pointed somewhere else while that write is held.
      rerender({ path: "/somewhere-else" });

      await act(async () => {
        onlineManager.setOnline(true);
        await held;
      });

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy.mock.calls[0]?.[0]).toBe("/plugins/@acme/p/patterns");
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("refreshes the reads the write was SUBMITTED with, not the newest", async () => {
    // The same snapshot question one layer along. The target was carried and
    // the invalidation keys were not, so a write held while the hook re-pointed
    // refreshed the new selection's reads and left its own stale.
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    onlineManager.setOnline(false);
    try {
      const { result, rerender } = renderHook(
        (props: { plugin: string }) =>
          usePluginRouteMutation({
            plugin: props.plugin,
            path: "/patterns",
            invalidates: ["/library"],
          }),
        { wrapper: wrapper(), initialProps: { plugin: "@acme/p" } }
      );

      let held: Promise<unknown> | undefined;
      act(() => {
        held = result.current.write({ title: "Hero" });
      });
      rerender({ plugin: "@other/q" });

      await act(async () => {
        onlineManager.setOnline(true);
        await held;
      });

      const keys = invalidate.mock.calls.map(
        ([arg]) => (arg as { queryKey: unknown[] }).queryKey
      );
      expect(keys).toEqual([["plugin-route", "/plugins/@acme/p/library"]]);
      invalidate.mockRestore();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("clears an earlier failure once a later write succeeds", async () => {
    // `error` says it is the failure of the LAST write. Left set, a plugin
    // shows "could not save" beside a save that has just worked, for the rest
    // of the session.
    postSpy.mockRejectedValueOnce(new Error("first one failed"));
    postSpy.mockResolvedValueOnce({ id: "second" });
    const { result } = renderHook(() => usePluginRouteMutation(write), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.write({ title: "first" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      await result.current.write({ title: "second" });
    });

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("sends NO body when the caller has none to send", async () => {
    // A contributed `DELETE /items/:id` legitimately has no request body, and
    // inventing one — `null`, `{}` — is a different request that a handler
    // requiring an empty body can reject.
    const { result } = renderHook(
      () => usePluginRouteMutation({ ...write, method: "DELETE" }),
      { wrapper: wrapper() }
    );

    await act(async () => {
      await result.current.write();
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0]?.[1]).toBeUndefined();
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
