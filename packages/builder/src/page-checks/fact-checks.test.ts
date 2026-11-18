/**
 * The checks over what the caller knows of the page beyond its document:
 * bindings that no longer fit, the page's data against its limit (always a
 * line under Content and data, and over the limit an item per block that
 * shows empty), parts the page uses that aren't published, and a header or
 * footer shown twice. Called with facts and no DOM, as a script would.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { PageReadReport } from "../shell/read-budget";

import { CORE_PAGE_CHECKS } from "./core-checks";
import {
  BINDINGS_TO_FIX_CHECK,
  DOUBLED_REGIONS_CHECK,
  PAGE_DATA_CHECK,
  UNPUBLISHED_PARTS_CHECK,
} from "./fact-checks";
import { pageCheckGroups, runPageChecks, type PageCheck } from "./page-checks";
import type { PageFacts } from "./page-facts";

function node(
  id: string,
  type: string,
  props: Record<string, unknown> = {}
): BlockNode {
  return { id, type, version: 1, props };
}

const NODES = [
  node("h1", "core/heading", { text: "Harbour" }),
  node("c1", "nextly/component-instance", { componentId: "cta" }),
  node("c2", "nextly/component-instance", { componentId: "cta" }),
];

function checked(facts: PageFacts | undefined, checks: readonly PageCheck[]) {
  const document: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: NODES,
  };
  return runPageChecks(
    { document, ...(facts === undefined ? {} : { facts }) },
    checks
  );
}

function report(over: Partial<PageReadReport>): PageReadReport {
  return { cap: 500, used: 12, refused: 0, byKind: {}, unread: [], ...over };
}

describe("bindings to fix", () => {
  it("lists each binding the report names, in its words, on its block", () => {
    const { findings } = checked(
      {
        bindingsToFix: [
          {
            nodeId: "h1",
            prop: "text",
            where: "Heading text, bound to Title",
            change: "The Title field was removed. Visitors see its fallback.",
          },
        ],
      },
      [BINDINGS_TO_FIX_CHECK]
    );
    expect(findings).toMatchObject([
      {
        nodeId: "h1",
        part: "text",
        group: "content",
        what: "Binding no longer fits: Heading text, bound to Title",
        why: "The Title field was removed. Visitors see its fallback.",
      },
    ]);
  });
});

describe("page data", () => {
  it("says the page's data against its limit under Content and data, as an item never", () => {
    const run = checked(
      { pageData: { state: "counted", report: report({}) } },
      [PAGE_DATA_CHECK]
    );
    expect(run.findings).toEqual([]);
    expect(run.notes).toEqual([
      { check: "page-data", group: "content", text: "Page data: 12 of 500" },
    ]);
    expect(
      pageCheckGroups(run.findings, [PAGE_DATA_CHECK], run.notes).find(
        group => group.group === "content"
      )?.notes
    ).toEqual(["Page data: 12 of 500"]);
  });

  it("says so while counting, and when the count failed", () => {
    expect(
      checked({ pageData: { state: "counting" } }, [PAGE_DATA_CHECK]).notes[0]
        ?.text
    ).toBe("Page data: counting…");
    expect(
      checked({ pageData: { state: "failed" } }, [PAGE_DATA_CHECK]).notes[0]
        ?.text
    ).toBe("Page data: couldn’t count");
  });

  it("says nothing where the page has no count, as a component has none", () => {
    expect(checked({}, [PAGE_DATA_CHECK]).notes).toEqual([]);
  });

  it("is no item near the limit, which the top bar shows from", () => {
    const near = report({ used: 450 });
    expect(
      checked({ pageData: { state: "counted", report: near } }, [
        PAGE_DATA_CHECK,
      ]).findings
    ).toEqual([]);
  });

  it("is no item at exactly the limit, every read made", () => {
    const full = report({ used: 500 });
    const run = checked({ pageData: { state: "counted", report: full } }, [
      PAGE_DATA_CHECK,
    ]);
    expect(run.findings).toEqual([]);
    expect(run.notes[0]?.text).toBe("Page data: 500 of 500");
  });

  it("names each block that shows empty over the limit, once each", () => {
    const over = report({
      used: 500,
      refused: 3,
      unread: [
        { nodeId: "c2", what: "entries" },
        { nodeId: "h1", what: "image" },
        { nodeId: "c2", what: "image" },
      ],
    });
    const { findings } = checked(
      { pageData: { state: "counted", report: over } },
      [PAGE_DATA_CHECK]
    );
    // In page order, each block once with all it misses.
    expect(findings.map(({ nodeId, what }) => ({ nodeId, what }))).toEqual([
      {
        nodeId: "h1",
        what: "Over the page data limit: Its image doesn't load",
      },
      {
        nodeId: "c2",
        what: "Over the page data limit: Its entries don't load. Its image doesn't load",
      },
    ]);
    expect(findings[0]?.why).toContain("Page data: 500 of 500");
  });

  it("names a header's block with its region, linking to where it is changed", () => {
    const header: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        node("nav-list", "core/collection-loop", { collection: "posts" }),
      ],
    };
    const edit = {
      href: "/admin/layouts/main",
      text: "Edit header & footer",
      name: "Edit the Main header & footer, in a new tab",
    };
    const over = report({
      used: 500,
      refused: 2,
      unread: [
        { nodeId: "nav-list", what: "entries" },
        { nodeId: "undone", what: "image" },
      ],
    });
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: NODES,
    };
    const { findings } = runPageChecks(
      {
        document,
        regions: [
          {
            area: "header",
            document: header,
            label: "Site header · Main",
            edit,
          },
        ],
        facts: { pageData: { state: "counted", report: over } },
      },
      [PAGE_DATA_CHECK]
    );
    expect(
      findings.map(({ nodeId, what, opens }) => ({ nodeId, what, opens }))
    ).toEqual([
      {
        nodeId: undefined,
        // Named as Layers names it; with no registry here, by its type.
        what: "Over the page data limit in Site header · Main: Collection loop",
        opens: edit,
      },
      // Undone since the count: on neither, so the page's item, selecting nothing.
      {
        nodeId: undefined,
        what: "Over the page data limit: Its image doesn't load",
        opens: undefined,
      },
    ]);
  });

  it("is one item for the page where reads were refused with no block to name", () => {
    const over = report({ used: 500, refused: 1 });
    expect(
      checked({ pageData: { state: "counted", report: over } }, [
        PAGE_DATA_CHECK,
      ]).findings.map(({ nodeId, what }) => ({ nodeId, what }))
    ).toEqual([{ nodeId: undefined, what: "Page data over the limit" }]);
  });
});

describe("unpublished parts", () => {
  it("lists a component on its first placement, and the header & footer for the page", () => {
    const { findings } = checked(
      {
        unpublished: [
          {
            kind: "component",
            id: "cta",
            title: "Call to action",
            mayPublish: true,
          },
          { kind: "layout", id: "main", title: "Main", mayPublish: true },
        ],
      },
      [UNPUBLISHED_PARTS_CHECK]
    );
    expect(
      findings.map(({ nodeId, what, group }) => ({ nodeId, what, group }))
    ).toEqual([
      {
        nodeId: undefined,
        what: "Header & footer not published: Main",
        group: "publishing",
      },
      {
        nodeId: "c1",
        what: "Component not published: Call to action",
        group: "publishing",
      },
    ]);
  });

  it("asks someone who can publish where the person editing can't", () => {
    const { findings } = checked(
      {
        unpublished: [
          { kind: "component", id: "cta", title: null, mayPublish: false },
        ],
      },
      [UNPUBLISHED_PARTS_CHECK]
    );
    expect(findings[0]).toMatchObject({
      what: "Component not published: Untitled",
      todo: "Ask someone who can publish it to do so.",
    });
  });
});

describe("a header or footer shown twice", () => {
  it("selects the page's own block and says what the notice says", () => {
    const { findings } = checked(
      {
        doubledRegions: [
          {
            area: "header",
            nodeIds: ["h1"],
            said: "This page shows two headers: the site header (Main) and a header block on the page.",
          },
        ],
      },
      [DOUBLED_REGIONS_CHECK]
    );
    expect(findings).toMatchObject([
      {
        nodeId: "h1",
        part: "header",
        what: "Two headers on this page",
        why: "This page shows two headers: the site header (Main) and a header block on the page. Visitors see both.",
      },
    ]);
  });
});

it("runs every content, data and publishing check among the builder's own", () => {
  const ids = CORE_PAGE_CHECKS.map(check => check.id);
  for (const id of [
    "bindings-to-fix",
    "page-data",
    "doubled-regions",
    "empty-blocks",
    "unpublished-parts",
  ]) {
    expect(ids).toContain(id);
  }
});

it("names a check whose line throws among those that didn't run", () => {
  const broken: PageCheck = {
    id: "broken",
    group: "content",
    run: () => [],
    note: () => {
      throw new Error("no");
    },
  };
  const run = checked({}, [broken, PAGE_DATA_CHECK]);
  expect(run.notRun).toEqual(["broken"]);
  expect(run.notes).toEqual([]);
});
