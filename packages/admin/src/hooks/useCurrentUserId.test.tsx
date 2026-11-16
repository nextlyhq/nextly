// @vitest-environment jsdom
/**
 * The signed-in user's id, read from the query the admin's chrome holds.
 *
 * @module hooks/useCurrentUserId.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What `/me` answers for the case in hand. */
let me: () => Promise<unknown> = () => Promise.resolve(undefined);
const requested: string[] = [];

vi.mock("./useApi", () => ({
  useApi: () => ({
    api: {
      protected: {
        get: (path: string) => {
          requested.push(path);
          return me();
        },
      },
    },
  }),
}));

const { useCurrentUserId } = await import("./useCurrentUserId");
const { useDashboardUser } = await import("./useDashboardUser");

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const fresh = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  requested.length = 0;
});

describe("useCurrentUserId", () => {
  it("answers the signed-in user's id", async () => {
    me = () =>
      Promise.resolve({ id: "user-1", name: "Ada", email: "ada@example.com" });
    const { result } = renderHook(() => useCurrentUserId(), {
      wrapper: wrapper(fresh()),
    });
    await waitFor(() => expect(result.current).toBe("user-1"));
  });

  it("answers null while no one is known, and when no one is signed in", async () => {
    me = () => Promise.reject(new Error("Authentication required."));
    const { result } = renderHook(() => useCurrentUserId(), {
      wrapper: wrapper(fresh()),
    });
    expect(result.current).toBeNull();
    await waitFor(() => expect(requested).toEqual(["/me"]));
    expect(result.current).toBeNull();
  });

  it("asks nothing of its own beside the chrome's read of the same user", async () => {
    me = () =>
      Promise.resolve({ id: "user-1", name: "Ada", email: "ada@example.com" });
    const client = fresh();
    const { result } = renderHook(
      () => ({ id: useCurrentUserId(), chrome: useDashboardUser() }),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => expect(result.current.id).toBe("user-1"));
    expect(requested).toEqual(["/me"]);
  });

  it("answers null once a later read fails, rather than the user from before", async () => {
    // The query keeps its last data beside a failure, and a key built from
    // it would keep writing under an author no longer known to be signed in.
    me = () =>
      Promise.resolve({ id: "user-1", name: "Ada", email: "ada@example.com" });
    const client = fresh();
    const { result } = renderHook(() => useCurrentUserId(), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current).toBe("user-1"));
    me = () => Promise.reject(new Error("Session expired."));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["auth", "me"] });
    });
    await waitFor(() => expect(result.current).toBeNull());
  });
});
