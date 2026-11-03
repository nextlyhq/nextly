// @vitest-environment jsdom

/**
 * The Shared styles tab's route client: which path each read asks, what the
 * tab is handed back, and a refusal kept in the route's own words.
 *
 * The admin's route helpers are replaced with recorders; the paths themselves
 * are held to what the routes parse in `shared-styles-routes.test.ts`.
 *
 * @module admin/shared-styles-client.test
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHARED_STYLE_LOCK_ROUTE_PATH,
  SHARED_STYLE_REMOVE_ROUTE_PATH,
  sharedStyleUsagePath,
  sharedStyleWhereUsedPath,
} from "../library-contract";

const reads: { path: string }[] = [];
const writes: { path: string; body: unknown }[] = [];
let readAnswer: unknown;
let writeBehaviour: () => Promise<unknown> = async () => ({});
let refetches = 0;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: async (read: { path: string }) => {
    reads.push({ path: read.path });
    return readAnswer;
  },
  writePluginRoute: async (write: { path: string; body: unknown }) => {
    writes.push({ path: write.path, body: write.body });
    return writeBehaviour();
  },
  useUpdateSingleDocument: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
  validationIssues: () => [],
}));

// The editor's one read of the stored style; a write asks it again.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: undefined,
    isPending: false,
    error: null,
    refetch: async () => {
      refetches += 1;
      return { isError: false };
    },
  }),
}));

const { useSharedStylesClient } = await import("./shared-styles-client");

const signal = new AbortController().signal;

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  readAnswer = undefined;
  writeBehaviour = async () => ({});
  refetches = 0;
});

describe("reading how widely shared styles are used", () => {
  it("asks for the styles named, and hands back each by id", async () => {
    const reach = (documents: number) => ({
      documents,
      byKind: { pages: documents, components: 0, patterns: 0, layouts: 0 },
      complete: false,
    });
    // Parsed from JSON, as the transport parses it, so `__proto__` arrives
    // as an own key: an id naming a prototype key is still a style.
    readAnswer = JSON.parse(
      `{"whole":false,"counting":true,"mayLock":true,"styles":{"c-card":${JSON.stringify(reach(2))},"__proto__":${JSON.stringify(reach(1))}}}`
    );
    const { result } = renderHook(() => useSharedStylesClient());
    const usage = await result.current.usage(["c-card", "__proto__"], signal);

    expect(reads).toEqual([
      { path: sharedStyleUsagePath(["c-card", "__proto__"]) },
    ]);
    expect(usage.whole).toBe(false);
    // Whether a floor may still become whole travels with the answer.
    expect(usage.counting).toBe(true);
    expect(usage.mayLock).toBe(true);
    expect(usage.styles.get("c-card")?.documents).toBe(2);
    expect(usage.styles.get("__proto__")?.documents).toBe(1);
  });

  it("fails rather than answering an empty usage when the route says nothing", async () => {
    const { result } = renderHook(() => useSharedStylesClient());
    await expect(result.current.usage(["c-card"], signal)).rejects.toThrow();
  });
});

describe("reading where a shared style is used", () => {
  it("asks for the page named, and reads each document's collection, the hidden count and the floor", async () => {
    readAnswer = {
      items: [{ id: "p1", title: "Home", collection: "pages", kind: "pages" }],
      meta: {
        total: 21,
        page: 2,
        limit: 20,
        totalPages: 2,
        hasNext: false,
        hasPrev: true,
        hiddenCount: 3,
        notConsulted: ["uncounted-documents"],
      },
    };
    const { result } = renderHook(() => useSharedStylesClient());
    const page = await result.current.uses("c-card", 2, signal);

    expect(reads).toEqual([{ path: sharedStyleWhereUsedPath("c-card", 2) }]);
    // The collection is kept: an id is unique only within it.
    expect(page).toEqual({
      items: [{ id: "p1", title: "Home", collection: "pages", kind: "pages" }],
      total: 21,
      hidden: 3,
      hasNext: false,
      complete: false,
    });
  });
});

describe("locking and removing", () => {
  it("locks through the lock route, then reads the site style again", async () => {
    const { result } = renderHook(() => useSharedStylesClient());
    let refusal: string | undefined = "unset";
    await act(async () => {
      refusal = await result.current.lock("c-card", true);
    });

    expect(writes).toEqual([
      {
        path: SHARED_STYLE_LOCK_ROUTE_PATH,
        body: { classId: "c-card", locked: true },
      },
    ]);
    expect(refusal).toBeUndefined();
    expect(refetches).toBe(1);
  });

  it("removes through the remove route", async () => {
    const { result } = renderHook(() => useSharedStylesClient());
    await act(async () => {
      await result.current.remove(["c-card", "c-hero"]);
    });

    expect(writes).toEqual([
      {
        path: SHARED_STYLE_REMOVE_ROUTE_PATH,
        body: { ids: ["c-card", "c-hero"] },
      },
    ]);
  });

  it("answers a refusal in the route's own words, and reads nothing again", async () => {
    writeBehaviour = async () => {
      throw new Error(
        "Nothing was removed. Some pages are still being counted, so no shared style can be removed yet."
      );
    };
    const { result } = renderHook(() => useSharedStylesClient());
    let refusal: string | undefined;
    await act(async () => {
      refusal = await result.current.remove(["c-card"]);
    });

    expect(refusal).toBe(
      "Nothing was removed. Some pages are still being counted, so no shared style can be removed yet."
    );
    expect(refetches).toBe(0);
  });
});
