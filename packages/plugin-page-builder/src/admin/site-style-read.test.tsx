// @vitest-environment jsdom

/**
 * The editor's one read of the stored site style: the plugin's own route,
 * through a real query client, so what is asserted is the request the browser
 * makes and the answer every surface shares.
 *
 * The transport is replaced at `readPluginRoute`, the SDK's own route reader,
 * so a read that went anywhere else (the `site-style` Single's REST read,
 * which an author without Design's permission is refused) never reaches it.
 *
 * @module admin/site-style-read.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_STYLE_ROUTE_PATH,
} from "../library-contract";

/** Every route read the hook made, by plugin and path. */
const reads: { plugin: string; path: string }[] = [];
/** What the route answers next. */
let answer: () => Promise<unknown> = async () => ({});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: async (request: { plugin: string; path: string }) => {
    reads.push({ plugin: request.plugin, path: request.path });
    return answer();
  },
}));

const { useStoredSiteStyle } = await import("./site-style-read");

const STORED = {
  tokens: { tokens: [] },
  fonts: null,
  classes: [{ id: "c1", slug: "card", orderIndex: 0, styles: {} }],
  breakpoints: null,
};

/** A fresh client per test, retrying nothing so a refusal arrives at once. */
function wrapper(
  /** How long an answer stays fresh in the cache; none by default. */
  staleTime = 0
): (props: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  reads.length = 0;
  answer = async () => STORED;
});

describe("the editor's read of the stored site style", () => {
  it("asks the plugin's own route for it", async () => {
    const { result } = renderHook(() => useStoredSiteStyle(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(reads).toEqual([
      { plugin: PAGE_BUILDER_PLUGIN_NAME, path: SITE_STYLE_ROUTE_PATH },
    ]);
    expect(result.current.data).toEqual(STORED);
    expect(result.current.error).toBeNull();
  });

  it("is one read however many surfaces ask", async () => {
    const shared = wrapper();
    const { result } = renderHook(
      () => [useStoredSiteStyle(), useStoredSiteStyle()] as const,
      { wrapper: shared }
    );
    await waitFor(() => expect(result.current[1].isPending).toBe(false));

    expect(reads).toHaveLength(1);
    expect(result.current[0].data).toBe(result.current[1].data);
  });

  it("reports a refused read as an error, not as an empty style", async () => {
    answer = async () => {
      throw new Error("Forbidden");
    };
    const { result } = renderHook(() => useStoredSiteStyle(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.data).toBeUndefined();
  });

  it("asks again on refetch, and says whether that read answered", async () => {
    const { result } = renderHook(() => useStoredSiteStyle(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    const after = { ...STORED, classes: [] };
    answer = async () => after;
    expect(await result.current.refetch()).toMatchObject({ isError: false });
    expect(reads).toHaveLength(2);
    await waitFor(() => expect(result.current.data).toEqual(after));

    answer = async () => {
      throw new Error("Offline");
    };
    expect(await result.current.refetch()).toMatchObject({ isError: true });
  });
});

describe("whether the answer in hand is the site as it is now", () => {
  it("is once the read answers, and is not after a later read fails", async () => {
    const { result } = renderHook(() => useStoredSiteStyle(), {
      wrapper: wrapper(),
    });
    expect(result.current.current).toBe(false);
    await waitFor(() => expect(result.current.current).toBe(true));

    answer = async () => {
      throw new Error("Offline");
    };
    await result.current.refetch();

    // The answer is kept beside the failure, and is no longer known current.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toEqual(STORED);
    expect(result.current.current).toBe(false);
  });

  it("is not on a stale cached answer until the read it starts answers", async () => {
    const shared = wrapper();
    const first = renderHook(() => useStoredSiteStyle(), { wrapper: shared });
    await waitFor(() => expect(first.result.current.current).toBe(true));
    first.unmount();

    // Mounted again on the cached answer, which the cache calls stale: it is
    // shown while a new read runs, and is not current until that answers.
    let release: (value: unknown) => void = () => {};
    const after = { ...STORED, classes: [] };
    answer = () =>
      new Promise(resolve => {
        release = resolve;
      });
    const second = renderHook(() => useStoredSiteStyle(), { wrapper: shared });
    expect(second.result.current.data).toEqual(STORED);
    expect(second.result.current.current).toBe(false);

    release(after);
    await waitFor(() => expect(second.result.current.current).toBe(true));
    expect(second.result.current.data).toEqual(after);
  });

  it("is on a cached answer still inside the cache's freshness", async () => {
    const shared = wrapper(60_000);
    const first = renderHook(() => useStoredSiteStyle(), { wrapper: shared });
    await waitFor(() => expect(first.result.current.current).toBe(true));
    first.unmount();

    const second = renderHook(() => useStoredSiteStyle(), { wrapper: shared });
    expect(second.result.current.current).toBe(true);
    // Fresh, so nothing was read again.
    expect(reads).toHaveLength(1);
  });
});
