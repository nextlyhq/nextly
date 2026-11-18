/**
 * The headings check: no main heading (H1), more than one, or a level
 * skipped, judged in the order a visitor reads the page, the site's header
 * before it and its footer after. Called over stored documents with no DOM.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { HEADING_CHECK } from "./heading-check";
import { runPageChecks, type PageRegionDocument } from "./page-checks";

function heading(id: string, level: string): BlockNode {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: `Heading ${id}`, level },
  };
}

/** A rich text block holding one heading of its own. */
function richHeading(id: string, tag: string): BlockNode {
  return {
    id,
    type: "core/rich-text",
    version: 1,
    props: {
      content: {
        root: {
          type: "root",
          children: [
            {
              type: "heading",
              tag,
              children: [{ type: "text", text: "In rich text" }],
            },
            { type: "paragraph", children: [{ type: "text", text: "Body" }] },
          ],
        },
      },
    },
  };
}

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

const region = (
  area: "header" | "footer",
  ...nodes: BlockNode[]
): PageRegionDocument => ({
  area,
  document: { formatVersion: 1, kind: "component", nodes },
});

function findings(document: BlockDocument, regions?: PageRegionDocument[]) {
  return runPageChecks(
    { document, ...(regions === undefined ? {} : { regions }) },
    [HEADING_CHECK]
  ).findings;
}

describe("the headings check", () => {
  it("passes a page with one H1 and levels in order", () => {
    expect(
      findings(page(heading("a", "h1"), heading("b", "h2"), heading("c", "h3")))
    ).toEqual([]);
  });

  it("flags a page with no H1, for the page as a whole", () => {
    const [only, ...rest] = findings(page(heading("a", "h2")));
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      group: "accessibility",
      what: "Page has no main heading (H1)",
    });
    expect(only?.nodeId).toBeUndefined();
  });

  it("flags every H1 after the first, opening its level", () => {
    const found = findings(page(heading("a", "h1"), heading("b", "h1")));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      nodeId: "b",
      what: "More than one main heading (H1)",
      fix: { tab: "content", id: "level" },
    });
  });

  it("flags a heading that skips a level, naming both levels", () => {
    const found = findings(
      page(heading("a", "h1"), heading("b", "h2"), heading("c", "h4"))
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      nodeId: "c",
      what: "Heading skips a level: H2, then H4",
      fix: { tab: "content", id: "level" },
    });
  });

  it("lets a heading go back up any number of levels", () => {
    expect(
      findings(
        page(
          heading("a", "h1"),
          heading("b", "h2"),
          heading("c", "h3"),
          heading("d", "h2")
        )
      )
    ).toEqual([]);
  });

  it("reads a rich text block's own headings in place", () => {
    const found = findings(page(heading("a", "h1"), richHeading("r", "h3")));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      nodeId: "r",
      what: "Heading skips a level: H1, then H3",
    });
    // A heading inside rich text has no Level setting: the block is selected.
    expect(found[0]?.fix).toBeUndefined();
  });

  it("counts the site header's H1, so a page H1 is a second one", () => {
    const found = findings(page(heading("a", "h1")), [
      region("header", heading("logo", "h1")),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      nodeId: "a",
      what: "More than one main heading (H1)",
    });
  });

  it("names the site header when the heading at fault is in it", () => {
    const found = findings(page(heading("a", "h1")), [
      region("header", heading("logo", "h1"), heading("tag", "h4")),
    ]);
    const skipped = found.find(each => each.what.startsWith("Heading skips"));
    expect(skipped).toMatchObject({
      what: "Heading skips a level in the site header: H1, then H4",
    });
    // Not the page's block: nothing on the page to select.
    expect(skipped?.nodeId).toBeUndefined();
  });

  it("reads the footer after the page", () => {
    const found = findings(page(heading("a", "h1"), heading("b", "h2")), [
      region("footer", heading("f", "h4")),
    ]);
    expect(found).toEqual([
      expect.objectContaining({
        what: "Heading skips a level in the site footer: H2, then H4",
      }),
    ]);
  });

  it("finds the H1 in the header, so a page with none there is fine", () => {
    expect(
      findings(page(heading("b", "h2")), [
        region("header", heading("logo", "h1")),
      ])
    ).toEqual([]);
  });

  it("reads a heading with no level as the page draws it, a Heading 2", () => {
    const untold: BlockNode = {
      id: "b",
      type: "core/heading",
      version: 1,
      props: { text: "Untold" },
    };
    expect(
      findings(page(heading("a", "h1"), untold, heading("c", "h3")))
    ).toEqual([]);
  });

  it("draws the page's placements under one allowance for the whole page", () => {
    // Two placements of a 3,000-block component: drawn each with a fresh
    // allowance they would make 6,000 blocks; the page may draw 5,000.
    const big: BlockDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: Array.from({ length: 3000 }, (_, index) =>
        heading(`h-${String(index)}`, "h1")
      ),
    };
    const placed = (id: string): BlockNode => ({
      id,
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "big" },
    });
    const report = runPageChecks(
      {
        document: page(placed("p1"), placed("p2")),
        definitions: new Map([["big", big]]),
      },
      [HEADING_CHECK]
    );
    // The check ran, and every Heading 1 after the first is one finding:
    // the second placement stays a placement, so only the first's are read.
    expect(report.notRun).toEqual([]);
    expect(report.findings).toHaveLength(2999);
    expect(report.findings.every(each => each.nodeId === "p1")).toBe(true);
  });

  it("leaves a placement the resolver keeps, such as a missing component", () => {
    const missing: BlockNode = {
      id: "gone",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "deleted" },
    };
    const found = runPageChecks(
      {
        document: page(heading("a", "h1"), missing),
        definitions: new Map(),
      },
      [HEADING_CHECK]
    );
    // The check ran, and found nothing wrong with the page's own heading.
    expect(found.notRun).toEqual([]);
    expect(found.findings).toEqual([]);
  });

  it("keeps a heading the page puts in a component's slot as the page's own", () => {
    // A frame component whose Box takes the page's own blocks in its slot.
    const frame = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "d1",
          type: "core/box",
          version: 1,
          props: {},
          slots: { children: [] },
        },
      ],
      slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
    } as unknown as BlockDocument;
    const placed: BlockNode = {
      id: "p1",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "frame" },
      slots: { body: [heading("slot-h1", "h1")] },
    };
    const found = runPageChecks(
      {
        document: page(heading("a", "h1"), placed),
        definitions: new Map([["frame", frame]]),
      },
      [HEADING_CHECK]
    ).findings;
    // The page's second Heading 1 is its own block, with its Level to fix.
    expect(found).toEqual([
      expect.objectContaining({
        nodeId: "slot-h1",
        what: "More than one main heading (H1)",
        fix: { tab: "content", id: "level" },
      }),
    ]);
  });

  it("reads a component the canvas draws under its conditions, as drawn", () => {
    // The editing canvas draws conditioned blocks with their conditions
    // lifted, so the page's main heading in a conditioned component counts.
    const hero: BlockDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [heading("hero-title", "h1")],
    };
    const gated: BlockNode = {
      id: "p1",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "hero" },
      visibility: {
        conditions: {
          match: "all",
          rules: [{ source: "entry", path: "featured", op: "isTrue" }],
        },
      } as never,
    };
    const report = runPageChecks(
      {
        document: page(gated, heading("b", "h2")),
        definitions: new Map([["hero", hero]]),
      },
      [HEADING_CHECK]
    );
    expect(report.notRun).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it("reads a Collection list's entries, not also its empty state", () => {
    const list: BlockNode = {
      id: "list",
      type: "core/collection-loop",
      version: 1,
      props: {},
      slots: {
        children: [heading("entry-title", "h1")],
        empty: [heading("nothing-yet", "h1")],
      },
    };
    expect(findings(page(list))).toEqual([]);
  });

  it("counts a Heading 1 whose words come from a field", () => {
    const bound: BlockNode = {
      id: "title",
      type: "core/heading",
      version: 1,
      props: { text: "", level: "h1" },
      bindings: { text: { $bind: "title" } as never },
    };
    expect(findings(page(bound, heading("b", "h2")))).toEqual([]);
  });

  it("reads inside the page's component placements, pointing at the placement", () => {
    const placed = (id: string): BlockNode => ({
      id,
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "hero" },
    });
    const hero: BlockDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [heading("hero-title", "h1")],
    };
    const definitions = new Map([["hero", hero]]);
    const run = (...nodes: BlockNode[]) =>
      runPageChecks({ document: page(...nodes), definitions }, [HEADING_CHECK])
        .findings;

    // The component's Heading 1 is the page's main heading.
    expect(run(placed("p1"), heading("b", "h2"))).toEqual([]);
    // A second placement draws a second one: the item selects that placement,
    // and opens no Level, which is the component's to change.
    const [second, ...rest] = run(placed("p1"), placed("p2"));
    expect(rest).toEqual([]);
    expect(second).toMatchObject({
      nodeId: "p2",
      what: "More than one main heading (H1)",
    });
    expect(second?.fix).toBeUndefined();
  });
});
