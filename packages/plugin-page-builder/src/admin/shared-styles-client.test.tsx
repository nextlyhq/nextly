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
  SHARED_STYLE_COUNT_ROUTE_PATH,
  SHARED_STYLE_LOCK_ROUTE_PATH,
  SHARED_STYLE_REMOVE_ROUTE_PATH,
  SHARED_STYLE_WHERE_USED_PAGES_MAX,
  sharedStyleUsagePath,
  sharedStyleWhereUsedPath,
} from "../library-contract";

const reads: { path: string }[] = [];
const writes: { path: string; body: unknown }[] = [];
let readAnswer: unknown;
let writeBehaviour: () => Promise<unknown> = async () => ({});
let refetches = 0;

// The real error readers, so a refusal is read as the admin reads it.
const admin = await vi.importActual<typeof import("@nextlyhq/admin/kit")>(
  "@nextlyhq/admin/kit"
);

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
  validationIssues: admin.validationIssues,
  apiErrorMessage: admin.apiErrorMessage,
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
      `{"whole":false,"counting":true,"mayLock":true,"mayCount":true,"styles":{"c-card":${JSON.stringify(reach(2))},"__proto__":${JSON.stringify(reach(1))}}}`
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
    // Whether this author may count the pages now travels with it too.
    expect(usage.mayCount).toBe(true);
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

describe("the last where-used page", () => {
  it("offers no page past the last the shared-style route may be asked for", async () => {
    // The route refuses a page past its cap, so the list stops there; the
    // documents beyond stay counted in the total.
    readAnswer = { items: [], meta: { total: 6000, hasNext: true } };
    const { result } = renderHook(() => useSharedStylesClient());
    const before = await result.current.uses(
      "c-card",
      SHARED_STYLE_WHERE_USED_PAGES_MAX - 1,
      signal
    );
    expect(before.hasNext).toBe(true);
    const last = await result.current.uses(
      "c-card",
      SHARED_STYLE_WHERE_USED_PAGES_MAX,
      signal
    );
    expect(last.hasNext).toBe(false);
    expect(last.total).toBe(6000);
  });
});

describe("counting the pages now", () => {
  it("asks the count route, and answers how far the counting got", async () => {
    // The mutation envelope, as the route answers it.
    writeBehaviour = async () => ({
      message: "Some pages are still to count.",
      item: { ran: true, whole: false, counting: true },
    });
    const { result } = renderHook(() => useSharedStylesClient());
    const counted = await result.current.count?.();

    expect(writes).toEqual([{ path: SHARED_STYLE_COUNT_ROUTE_PATH, body: {} }]);
    expect(counted).toEqual({ kind: "counted", whole: false, counting: true });
    // Counting writes no site style, so none is read again.
    expect(refetches).toBe(0);
  });

  it("answers a refusal in its own words", async () => {
    writeBehaviour = async () => {
      throw Object.assign(new Error("Forbidden"), {
        code: "FORBIDDEN",
        status: 403,
      });
    };
    const { result } = renderHook(() => useSharedStylesClient());
    const counted = await result.current.count?.();

    expect(counted?.kind).toBe("refused");
  });

  it("refuses an answer that says nothing of how far it got", async () => {
    writeBehaviour = async () => ({ message: "done" });
    const { result } = renderHook(() => useSharedStylesClient());
    const counted = await result.current.count?.();

    expect(counted).toEqual({
      kind: "refused",
      reason: expect.any(String),
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

  it("answers an issue naming no field in its own words, not the envelope's", async () => {
    // The in-use refusal as the admin's fetcher raises it (`parseApiError`,
    // not exported): the envelope's message, its status and code, and a
    // validation payload whose one issue names no field.
    const words =
      "Still used on Home and 2 more. Remove it from those pages first.";
    writeBehaviour = async () => {
      throw Object.assign(new Error("Validation failed."), {
        status: 400,
        code: "VALIDATION_ERROR",
        data: { errors: [{ path: "", code: "IN_USE", message: words }] },
      });
    };
    const { result } = renderHook(() => useSharedStylesClient());
    let words_: string | undefined;
    let refusal: unknown;
    await act(async () => {
      words_ = await result.current.remove(["c-card"]);
      refusal = await result.current.removeWithReason?.(["c-card"]);
    });
    // `remove` answers words, as it always has; `removeWithReason` marks
    // the route's in-use refusal.
    expect(words_).toBe(words);
    expect(refusal).toEqual({ reason: words, inUse: true });
  });

  it("marks a conflict refusal as saying nothing of use", async () => {
    writeBehaviour = async () => {
      throw Object.assign(new Error("Nothing was removed. Card is locked."), {
        status: 409,
        code: "CONFLICT",
      });
    };
    const { result } = renderHook(() => useSharedStylesClient());
    let refusal: unknown;
    await act(async () => {
      refusal = await result.current.removeWithReason?.(["c-card"]);
    });
    expect(refusal).toEqual({
      reason: "Nothing was removed. Card is locked.",
      inUse: false,
    });
  });

  it("answers a refusal in the route's own words, and reads nothing again", async () => {
    writeBehaviour = async () => {
      throw new Error(
        "Nothing was removed. Some pages haven't been counted yet, so no shared style can be removed."
      );
    };
    const { result } = renderHook(() => useSharedStylesClient());
    let refusal: string | undefined;
    await act(async () => {
      refusal = await result.current.remove(["c-card"]);
    });

    expect(refusal).toBe(
      "Nothing was removed. Some pages haven't been counted yet, so no shared style can be removed."
    );
    expect(refetches).toBe(0);
  });
});
