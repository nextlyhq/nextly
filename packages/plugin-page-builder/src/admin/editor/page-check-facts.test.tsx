// @vitest-environment jsdom

/**
 * What Page checks reads of the open page beyond its document, each from
 * the surface that already answers it: the chip's bindings in its words,
 * the meter's count as counted, counting or failed, the publish question's
 * unpublished parts (asked of a page only), and the two-headers notice's
 * doubled header with its own sentence.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageReadReport } from "@nextlyhq/blocks-react";

const asked = vi.fn();
vi.mock("../publish-offer", () => ({
  askReadiness: async (request: unknown) => {
    asked(request);
    return {
      dependencies: [
        {
          kind: "component",
          id: "cta",
          title: "Call to action",
          mayPublish: false,
        },
      ],
      missing: 0,
    };
  },
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentActions: () => ({ storedAt: null }),
}));
vi.mock("../bindings-report/page-rows", () => ({
  usePageBindingsToFix: () => ({
    key: "collection:pages:p1",
    item: { collectionLabel: "Posts" },
    rows: [{ nodeId: "h1", prop: "text" }],
  }),
}));
vi.mock("../bindings-report/words", () => ({
  whereBound: () => "Heading · Text",
  changeSentence: () => "The field is gone. Visitors see the fallback.",
}));

import { pageDataFact, usePageCheckFacts } from "./page-check-facts";
import type { PageDataCount } from "./page-read-meter";

afterEach(() => {
  cleanup();
  asked.mockReset();
});

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "own", type: "core/section", version: 1, props: { as: "header" } },
  ],
};

const REPORT: PageReadReport = {
  cap: 500,
  used: 3,
  refused: 0,
  byKind: {},
  unread: [],
};

function count(over: Partial<PageDataCount>): PageDataCount {
  return { report: undefined, retry: undefined, ...over } as PageDataCount;
}

function facts(document: BlockDocument = PAGE) {
  return renderHook(() =>
    usePageCheckFacts({
      field: "content",
      document,
      applied: undefined,
      regionCards: [{ area: "header", setId: "main", setTitle: "Main" }],
      areaOf: () => undefined,
      currentPage: { id: "p1" },
      pageData: count({ report: REPORT }),
      layout: { layout: "main", siteDefault: false },
    })
  );
}

describe("the page data count as a fact", () => {
  it("is counted, counting or failed as the meter has it, and none without a count", () => {
    expect(pageDataFact(count({ report: REPORT }))).toEqual({
      state: "counted",
      report: REPORT,
    });
    expect(pageDataFact(count({}))).toEqual({ state: "counting" });
    expect(pageDataFact(count({ retry: () => {} }))).toEqual({
      state: "failed",
    });
    expect(pageDataFact(null)).toBeUndefined();
  });
});

describe("the facts of the open page", () => {
  it("carries the bindings in the chip's words, and the doubled header in the notice's", () => {
    const { result } = facts();
    expect(result.current.bindingsToFix).toEqual([
      {
        nodeId: "h1",
        prop: "text",
        where: "Heading · Text",
        change: "The field is gone. Visitors see the fallback.",
      },
    ]);
    expect(result.current.doubledRegions).toEqual([
      {
        area: "header",
        nodeIds: ["own"],
        said: "This page shows two headers: the site header (Main) and a header block on the page.",
      },
    ]);
    expect(result.current.pageData).toEqual({
      state: "counted",
      report: REPORT,
    });
  });

  it("asks the publish question's route about the page and its Layout", async () => {
    const { result } = facts();
    await waitFor(() =>
      expect(result.current.unpublished).toEqual([
        {
          kind: "component",
          id: "cta",
          title: "Call to action",
          mayPublish: false,
        },
      ])
    );
    expect(asked).toHaveBeenCalledWith({ documents: [PAGE], layout: "main" });
  });

  it("asks nothing of a component, which is published with the pages using it", async () => {
    const { result } = facts({ ...PAGE, kind: "component" });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(asked).not.toHaveBeenCalled();
    expect(result.current.unpublished).toBeUndefined();
  });
});
