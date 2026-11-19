/**
 * `useIsKnownSingle` reads the capabilities answers once per change to them,
 * not once per render or per event about some other query, and still follows
 * every change to them: an answer set, refetched or removed, whether or not a
 * reader was mounted when it changed.
 *
 * The page builder renders many readers on every click, and the query cache
 * notifies every subscriber of every query's events, so a reader that scanned
 * the whole cache each time cost a scan per reader per event.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  currentUserCapabilitiesKey,
  CURRENT_USER_CAPABILITIES_KEY,
  useIsKnownSingle,
} from "@admin/hooks/current-user-access";
import type { CapabilitiesResponse } from "@admin/types/permissions";

/** A capabilities answer naming each slug given the kind given. */
function answer(
  kinds: Record<string, "single" | "collection">
): CapabilitiesResponse {
  const entities: CapabilitiesResponse["entities"] = {};
  for (const [slug, kind] of Object.entries(kinds)) {
    entities[slug] = {
      kind,
      read: true,
      update: true,
      publish: true,
      unpublish: true,
    };
  }
  return { isSuperAdmin: false, validUntil: null, entities };
}

function clientWith(kinds: Record<string, "single" | "collection">) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserCapabilitiesKey(undefined), answer(kinds));
  // Other queries the admin holds, which the cache also notifies about.
  for (let i = 0; i < 40; i += 1) client.setQueryData(["other", i], i);
  return client;
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useIsKnownSingle", () => {
  it("scans the cache for no render and no event about another query", () => {
    const client = clientWith({ "site-settings": "single" });
    const findAll = vi.spyOn(client.getQueryCache(), "findAll");
    const view = renderHook(() => useIsKnownSingle("site-settings"), {
      wrapper: wrapperFor(client),
    });
    expect(view.result.current).toBe(true);
    // The control: the counter sees a scan when the answer is first read.
    expect(findAll).toHaveBeenCalled();
    findAll.mockClear();

    for (let i = 0; i < 10; i += 1) view.rerender();
    act(() => {
      for (let i = 0; i < 10; i += 1) client.setQueryData(["other", i], -i);
    });

    expect(view.result.current).toBe(true);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("follows an answer that arrives or is refetched while it is mounted", async () => {
    const client = clientWith({ posts: "collection" });
    const view = renderHook(() => useIsKnownSingle("site-settings"), {
      wrapper: wrapperFor(client),
    });
    expect(view.result.current).toBe(false);

    // Another content language's answer names it a Single.
    await act(() =>
      client.fetchQuery({
        queryKey: currentUserCapabilitiesKey("fr"),
        queryFn: () => Promise.resolve(answer({ "site-settings": "single" })),
      })
    );
    expect(view.result.current).toBe(true);

    // Refetched, the answer still names it, and the reader still says so.
    await act(() =>
      client.refetchQueries({ queryKey: currentUserCapabilitiesKey("fr") })
    );
    expect(view.result.current).toBe(true);

    // Every answer removed: nothing says it is a Single any more.
    act(() => {
      client.removeQueries({ queryKey: CURRENT_USER_CAPABILITIES_KEY });
    });
    expect(view.result.current).toBe(false);
  });

  it("reads an answer that changed while no reader was mounted", () => {
    const client = clientWith({ "site-settings": "collection" });
    const first = renderHook(() => useIsKnownSingle("site-settings"), {
      wrapper: wrapperFor(client),
    });
    expect(first.result.current).toBe(false);
    first.unmount();

    client.setQueryData(
      currentUserCapabilitiesKey(undefined),
      answer({ "site-settings": "single" })
    );

    const second = renderHook(() => useIsKnownSingle("site-settings"), {
      wrapper: wrapperFor(client),
    });
    expect(second.result.current).toBe(true);
  });
});
