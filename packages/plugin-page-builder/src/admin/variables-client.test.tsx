// @vitest-environment jsdom

/**
 * The Variables tab's route client: which path each read asks, what the tab
 * is handed back, where a document using a variable opens, and the count
 * shared with the Shared styles tab.
 *
 * The admin's route helpers are replaced with recorders; the paths themselves
 * are held to what the routes parse in the variable routes' own tests.
 *
 * @module admin/variables-client.test
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUILDER_VIEW_PATH } from "../builder-view";
import {
  SHARED_STYLE_COUNT_ROUTE_PATH,
  SHARED_STYLE_WHERE_USED_PAGES_MAX,
  variableUsagePath,
  variableWhereUsedPath,
} from "../library-contract";

const reads: { path: string }[] = [];
const writes: { path: string; body: unknown }[] = [];
let readAnswer: unknown;
let writeBehaviour: () => Promise<unknown> = async () => ({});

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

// The shared-style client the count comes from reads the stored style; the
// variables reads never do.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: undefined,
    isPending: false,
    error: null,
    refetch: async () => ({ isError: false }),
  }),
}));

const { useVariablesClient } = await import("./variables-client");

const signal = new AbortController().signal;

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  readAnswer = undefined;
  writeBehaviour = async () => ({});
});

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

describe("reading how widely variables are used", () => {
  it("asks for the variables named, and hands back each by identity", async () => {
    const usage = (
      documents: number,
      sharedStyles: string[],
      blockDefaults: string[] = []
    ) => ({
      documents,
      byKind: { ...NONE, pages: documents },
      sharedStyles,
      blockDefaults,
      complete: false,
    });
    // Parsed from JSON, as the transport parses it, so `__proto__` arrives
    // as an own key: an identity naming a prototype key is still a variable.
    readAnswer = JSON.parse(
      `{"whole":false,"counting":true,"mayCount":true,"variables":{"color.brand":${JSON.stringify(usage(12, ["c-card", "c-hero"], ["core/button"]))},"__proto__":${JSON.stringify(usage(1, []))}}}`
    );
    const { result } = renderHook(() => useVariablesClient());
    const read = await result.current.usage(
      ["color.brand", "__proto__"],
      signal
    );

    expect(reads).toEqual([
      { path: variableUsagePath(["color.brand", "__proto__"]) },
    ]);
    expect(read.whole).toBe(false);
    expect(read.counting).toBe(true);
    expect(read.mayCount).toBe(true);
    // The block types whose default styles name it travel with the rest.
    expect(read.variables.get("color.brand")).toEqual(
      usage(12, ["c-card", "c-hero"], ["core/button"])
    );
    expect(read.variables.get("__proto__")?.documents).toBe(1);
  });

  it("fails rather than answering an empty usage when the route says nothing", async () => {
    const { result } = renderHook(() => useVariablesClient());
    await expect(
      result.current.usage(["color.brand"], signal)
    ).rejects.toThrow();
  });
});

describe("reading where a variable is used", () => {
  it("asks for the page named, gives each document where it opens, and a shared style or block default none", async () => {
    readAnswer = {
      items: [
        {
          id: "c-card",
          title: "Card",
          collection: "site-style",
          kind: "shared-style",
        },
        {
          id: "core/button",
          title: "Button",
          collection: "",
          kind: "block-default",
        },
        { id: "p 1", title: "Home", collection: "pages", kind: "pages" },
        {
          id: "h1",
          title: "Site header",
          collection: "components",
          kind: "components",
        },
      ],
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
    const { result } = renderHook(() => useVariablesClient());
    const page = await result.current.uses("color.brand", 2, signal);

    expect(reads).toEqual([{ path: variableWhereUsedPath("color.brand", 2) }]);
    expect(page).toEqual({
      items: [
        {
          id: "c-card",
          title: "Card",
          collection: "site-style",
          kind: "shared-style",
        },
        // A block type's default style: nowhere to open, so no address.
        {
          id: "core/button",
          title: "Button",
          collection: "",
          kind: "block-default",
        },
        {
          id: "p 1",
          title: "Home",
          collection: "pages",
          kind: "pages",
          // The document's own Page Builder view, its id encoded.
          href: `/admin/collections/pages/p%201/${BUILDER_VIEW_PATH}`,
        },
        {
          id: "h1",
          title: "Site header",
          collection: "components",
          kind: "components",
          href: `/admin/collections/components/h1/${BUILDER_VIEW_PATH}`,
        },
      ],
      total: 21,
      hidden: 3,
      hasNext: false,
      complete: false,
    });
  });

  it("links a Single's document by the Single's own route, and a collection's by its collection and id", async () => {
    // The route names a Single's one document by the Single's slug, with no
    // id: a collection address would read /collections/homepage//builder.
    readAnswer = {
      items: [
        { id: "", title: "Homepage", collection: "homepage", kind: "pages" },
        { id: "p1", title: "Pricing", collection: "pages", kind: "pages" },
      ],
      meta: { total: 2, hasNext: false },
    };
    const { result } = renderHook(() => useVariablesClient());
    const page = await result.current.uses("color.brand", 1, signal);
    expect(page.items.map(item => item.href)).toEqual([
      `/admin/singles/homepage/${BUILDER_VIEW_PATH}`,
      `/admin/collections/pages/p1/${BUILDER_VIEW_PATH}`,
    ]);
  });

  it("follows the route's own next page past the shared styles' page cap", async () => {
    // The variables route bounds its list by the places the site has, past
    // the shared styles' 250 pages, and says itself when none follows.
    readAnswer = {
      items: [],
      meta: { total: 6000, hasNext: true },
    };
    const { result } = renderHook(() => useVariablesClient());
    const capped = await result.current.uses(
      "color.brand",
      SHARED_STYLE_WHERE_USED_PAGES_MAX,
      signal
    );
    // Page 251 is offered, since the route says it follows.
    expect(capped.hasNext).toBe(true);
    readAnswer = {
      items: [],
      meta: { total: 6000, hasNext: false },
    };
    const last = await result.current.uses(
      "color.brand",
      SHARED_STYLE_WHERE_USED_PAGES_MAX + 1,
      signal
    );
    expect(reads.at(-1)).toEqual({
      path: variableWhereUsedPath(
        "color.brand",
        SHARED_STYLE_WHERE_USED_PAGES_MAX + 1
      ),
    });
    expect(last.hasNext).toBe(false);
    expect(last.total).toBe(6000);
  });

  it("reads a whole list with nothing hidden", async () => {
    readAnswer = {
      items: [],
      meta: { total: 0, hasNext: false },
    };
    const { result } = renderHook(() => useVariablesClient());
    const page = await result.current.uses("color.brand", 1, signal);
    expect(page).toEqual({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    });
  });
});

describe("counting the pages now", () => {
  it("counts through the shared styles' count route, which fills every usage index", async () => {
    writeBehaviour = async () => ({
      message: "Every page is counted.",
      item: { ran: true, whole: true, counting: false },
    });
    const { result } = renderHook(() => useVariablesClient());
    const counted = await result.current.count?.();

    expect(writes).toEqual([{ path: SHARED_STYLE_COUNT_ROUTE_PATH, body: {} }]);
    expect(counted).toEqual({ kind: "counted", whole: true, counting: false });
  });
});

describe("opening a shared style", () => {
  it("hands on the host's way to Shared styles, and offers none without one", () => {
    const open = vi.fn();
    const withWay = renderHook(() => useVariablesClient(open));
    withWay.result.current.openSharedStyle?.("c-card");
    expect(open).toHaveBeenCalledWith("c-card");

    const without = renderHook(() => useVariablesClient());
    expect(without.result.current.openSharedStyle).toBeUndefined();
  });

  it("hands on the host's way to edit a block look, and offers none without one", () => {
    const openLook = vi.fn();
    const withWay = renderHook(() => useVariablesClient(undefined, openLook));
    withWay.result.current.openLook?.({
      id: "look-primary",
      blockType: "core/button",
    });
    expect(openLook).toHaveBeenCalledWith({
      id: "look-primary",
      blockType: "core/button",
    });
    expect(withWay.result.current.openSharedStyle).toBeUndefined();

    const without = renderHook(() => useVariablesClient(vi.fn()));
    expect(without.result.current.openLook).toBeUndefined();
  });

  it("keeps one access across renders, so the tab's reads are not asked again", () => {
    const open = vi.fn();
    const { result, rerender } = renderHook(() => useVariablesClient(open));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
