/**
 * The page checks' runner, called the way a script, a route or an agent
 * would call it: over a stored document, with no DOM and no React in reach.
 *
 * - Each finding is stamped with the check and the group it came from, and
 *   keyed so the same problem keeps its key across runs.
 * - Findings come in the list's order: by group, then where their block is
 *   on the page.
 * - A check that throws is named as not run, and the others still run.
 * - The groups are Accessibility, Content and data and Publishing always,
 *   and Search only where a check offers it.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { pageCheckGroups, runPageChecks, type PageCheck } from "./page-checks";

function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  return {
    id,
    type: "acme/thing",
    version: 1,
    props: {},
    ...(slots === undefined ? {} : { slots }),
  };
}

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [node("a", { children: [node("b")] }), node("c")],
};

/** A check naming the blocks it is given, in the order it is given them. */
function naming(
  id: string,
  group: PageCheck["group"],
  ids: readonly string[]
): PageCheck {
  return {
    id,
    group,
    run: () =>
      ids.map(nodeId => ({
        nodeId,
        what: `${nodeId} is wrong`,
        why: "It matters.",
        todo: "Fix it.",
      })),
  };
}

describe("running the checks over a page", () => {
  it("runs with no DOM, as a script or a route would", () => {
    expect(typeof globalThis.document).toBe("undefined");
    const report = runPageChecks({ document: PAGE }, [
      naming("probe", "accessibility", ["b"]),
    ]);
    expect(report.findings).toHaveLength(1);
  });

  it("stamps each finding with its check and group, and keys it stably", () => {
    const checks = [naming("probe", "content", ["c", "a"])];
    const first = runPageChecks({ document: PAGE }, checks);
    expect(first.findings.map(each => [each.check, each.group])).toEqual([
      ["probe", "content"],
      ["probe", "content"],
    ]);
    const again = runPageChecks({ document: PAGE }, checks);
    expect(again.findings.map(each => each.key)).toEqual(
      first.findings.map(each => each.key)
    );
    expect(new Set(first.findings.map(each => each.key)).size).toBe(2);
  });

  it("keys two findings of one check on one block apart by their part", () => {
    const check: PageCheck = {
      id: "twice",
      group: "accessibility",
      run: () =>
        ["first", "second"].map(part => ({
          nodeId: "a",
          part,
          what: "Wrong",
          why: "It matters.",
          todo: "Fix it.",
        })),
    };
    const keys = runPageChecks({ document: PAGE }, [check]).findings.map(
      each => each.key
    );
    expect(new Set(keys).size).toBe(2);
  });

  it("orders findings by group, then by where their block is on the page", () => {
    const report = runPageChecks({ document: PAGE }, [
      naming("publish", "publishing", ["a"]),
      naming("later", "accessibility", ["c"]),
      naming("earlier", "accessibility", ["b", "a"]),
    ]);
    expect(report.findings.map(each => `${each.group}:${each.nodeId}`)).toEqual(
      ["accessibility:a", "accessibility:b", "accessibility:c", "publishing:a"]
    );
  });

  it("hands every check the header and footer drawn around the page, or none", () => {
    const seen: unknown[] = [];
    const reads: PageCheck = {
      id: "reads-regions",
      group: "accessibility",
      run: page => {
        seen.push(page.regions);
        return [];
      },
    };
    const header = {
      area: "header" as const,
      document: {
        formatVersion: 1 as const,
        kind: "component" as const,
        nodes: [],
      },
    };
    runPageChecks({ document: PAGE, regions: [header] }, [reads]);
    runPageChecks({ document: PAGE }, [reads]);
    // As given, with the stored document a read names kept beside it.
    expect(seen).toEqual([[{ ...header, stored: header.document }], []]);
  });

  it("reads a header placed as a component as its component's blocks", () => {
    // A set's header is one placement of a component; the checks read what
    // it draws, so a heading inside the component counts.
    let read: unknown;
    const reads: PageCheck = {
      id: "reads-header",
      group: "accessibility",
      run: page => {
        read = page.regions[0]?.document.nodes.map(node => node.type);
        return [];
      },
    };
    const definition: BlockDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "logo",
          type: "core/heading",
          version: 1,
          props: { text: "Site", level: "h1" },
        },
      ],
    };
    runPageChecks(
      {
        document: PAGE,
        regions: [
          {
            area: "header",
            document: {
              formatVersion: 1,
              kind: "component",
              nodes: [
                {
                  id: "placed",
                  type: "nextly/component-instance",
                  version: 1,
                  props: { componentId: "site-header" },
                },
              ],
            },
            definitions: new Map([["site-header", definition]]),
          },
        ],
      },
      [reads]
    );
    expect(read).toEqual(["core/heading"]);
  });

  it("names a check that throws as not run, and still runs the others", () => {
    const broken: PageCheck = {
      id: "broken",
      group: "search",
      run: () => {
        throw new Error("boom");
      },
    };
    const report = runPageChecks({ document: PAGE }, [
      broken,
      naming("probe", "accessibility", ["a"]),
    ]);
    expect(report.notRun).toEqual(["broken"]);
    expect(report.findings.map(each => each.check)).toEqual(["probe"]);
  });

  it("names the block each finding is on, as Layers names it", () => {
    const named: BlockDocument = {
      ...PAGE,
      nodes: [{ ...node("a"), name: "Team photo" }],
    };
    const report = runPageChecks({ document: named }, [
      naming("probe", "accessibility", ["a"]),
    ]);
    expect(report.findings[0]?.block).toBe("Team photo");
  });
});

describe("the groups the list shows", () => {
  it("shows Accessibility, Content and data and Publishing, with no plugin's check", () => {
    const groups = pageCheckGroups([], [naming("probe", "accessibility", [])]);
    expect(groups.map(group => group.label)).toEqual([
      "Accessibility",
      "Content and data",
      "Publishing",
    ]);
  });

  it("adds Search only where a check offers it, holding its findings", () => {
    const search = naming("seo", "search", ["a"]);
    const report = runPageChecks({ document: PAGE }, [search]);
    const groups = pageCheckGroups(report.findings, [search]);
    expect(groups.map(group => group.label)).toEqual([
      "Accessibility",
      "Content and data",
      "Publishing",
      "Search",
    ]);
    expect(groups[3]?.findings.map(each => each.nodeId)).toEqual(["a"]);
  });
});
