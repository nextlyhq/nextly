/**
 * A Columns row's layout, as tiles, and where it stacks: what each choice
 * writes, and which column changes it makes or refuses.
 *
 * @module columns-layout.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  layoutOf,
  planLayout,
  planStack,
  stackOf,
  stackTiers,
} from "./columns-layout";
import { applyOp } from "./ops";

beforeAll(() => {
  // The row and its column as the core pair declare them: a slot that admits
  // only the column, and a column with a slot of its own.
  const block = (name: string, slot: Record<string, unknown>) => ({
    name,
    version: 1,
    description: name,
    example: { props: {} },
    editor: { label: name },
    props: {},
    defaultProps: {},
    slots: { children: slot },
    render: () => null,
  });
  registerBlocks(
    [
      {
        ...block("core/columns", { allow: ["core/column"] }),
        baseStyles: {
          base: {
            base: {
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            },
          },
        },
      },
      block("core/column", {}),
      // A column as production declares one: every new one carries these.
      {
        ...block("acme/column", {}),
        defaultProps: { as: "div", contained: false },
      },
      { ...block("core/text", {}), slots: undefined },
    ] as never,
    { source: "columns-layout-test" }
  );
});
afterAll(clearBlocks);

const BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: "lg", label: "Laptop", maxWidth: 1280 },
    { id: "md", label: "Tablet", maxWidth: 1024 },
    { id: "sm", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

function column(id: string, children: BlockNode[] = []): BlockNode {
  return {
    id,
    type: "core/column",
    version: 1,
    props: {},
    slots: { children },
  };
}

function row(columns: BlockNode[], styles?: BlockNode["styles"]): BlockNode {
  return {
    id: "row",
    type: "core/columns",
    version: 1,
    props: {},
    slots: { children: columns },
    ...(styles === undefined ? {} : { styles }),
  };
}

const text: BlockNode = {
  id: "t1",
  type: "core/text",
  version: 1,
  props: { text: "Words" },
};

const at = { state: "base", breakpoint: "base" } as const;

describe("layoutOf", () => {
  it("names a stored template by its tile, and anything else as custom", () => {
    expect(layoutOf(undefined)).toBe("auto");
    expect(layoutOf("1fr 1fr")).toBe("50-50");
    expect(layoutOf("1fr 2fr")).toBe("33-67");
    expect(layoutOf("2fr 1fr")).toBe("67-33");
    expect(layoutOf("1fr 3fr")).toBe("25-75");
    expect(layoutOf("repeat(3, 1fr)")).toBe("3");
    expect(layoutOf("repeat(4, 1fr)")).toBe("4");
    expect(layoutOf("repeat(5, 1fr)")).toBe("custom");
  });
});

describe("planLayout", () => {
  it("writes the template at the edited device", () => {
    const plan = planLayout(row([column("a"), column("b")]), "33-67", at);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ops).toHaveLength(1);
    expect(JSON.stringify(plan.ops[0])).toContain(
      '"gridTemplateColumns":"1fr 2fr"'
    );
  });

  it("clears the template for Auto, back to the block's own wrapping columns", () => {
    const plan = planLayout(
      row([column("a"), column("b")], {
        base: { base: { gridTemplateColumns: "1fr 2fr" } },
      }),
      "auto",
      at
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // One op, which applied leaves the row with no template of its own.
    expect(plan.ops).toHaveLength(1);
    const after = plan.ops.reduce(
      (document, op) => applyOp(document, op).document,
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          row([column("a"), column("b")], {
            base: { base: { gridTemplateColumns: "1fr 2fr" } },
          }),
        ],
      } as unknown as BlockDocument
    );
    expect(JSON.stringify(after.nodes[0]?.styles ?? {})).not.toContain(
      "gridTemplateColumns"
    );
  });

  it("adds empty columns for a layout with more tracks, in the same step", () => {
    const plan = planLayout(row([column("a"), column("b")]), "4", at);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const inserts = plan.ops.filter(op => op.kind === "insert");
    expect(inserts).toHaveLength(2);
    expect(inserts.map(op => op.kind === "insert" && op.at.index)).toEqual([
      2, 3,
    ]);
    expect(
      inserts.every(
        op => op.kind === "insert" && op.node.type === "core/column"
      )
    ).toBe(true);
  });

  it("removes only empty columns for a layout with fewer tracks", () => {
    const plan = planLayout(
      row([column("a", [text]), column("b"), column("c")]),
      "50-50",
      at
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      plan.ops
        .filter(op => op.kind === "remove")
        .map(op => op.kind === "remove" && op.id)
    ).toEqual(["c"]);
  });

  it("refuses to remove a column that holds content, and says why", () => {
    const plan = planLayout(
      row([column("a", [text]), column("b", [text]), column("c", [text])]),
      "50-50",
      at
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe(
      "Needs 2 columns. This row has 3 with content; empty one out first."
    );
  });
});

describe("stacking", () => {
  it("finds the tablet and mobile tiers by width, as the device switcher does", () => {
    expect(stackTiers(BREAKPOINTS)).toMatchObject({
      tablet: "md",
      mobile: "sm",
    });
    expect(stackTiers(undefined)).toEqual({});
  });

  it("stacks the row at a tier and below, reversed when asked, writing the row only", () => {
    const plan = planStack(row([column("a"), column("b")]), "tablet", true, {
      tiers: stackTiers(BREAKPOINTS),
      state: "base",
    });
    expect(plan).not.toBeNull();
    const styles = JSON.stringify(plan);
    expect(styles).toContain(
      '"md":{"display":"flex","flexDirection":"column-reverse"}'
    );
    expect(styles).not.toContain('"sm":{"display"');
  });

  it("reads where a row stacks, and whether it is reversed", () => {
    const stacked = row([column("a")], {
      base: { md: { display: "flex", flexDirection: "column-reverse" } },
    });
    expect(stackOf(stacked, stackTiers(BREAKPOINTS), "base")).toEqual({
      on: "tablet",
      reversed: true,
    });
    expect(
      stackOf(row([column("a")]), stackTiers(BREAKPOINTS), "base")
    ).toEqual({ on: "never", reversed: false });
  });

  it("writes nothing at either tier for Never, clearing a stack set before", () => {
    const stacked = row([column("a")], {
      base: { md: { display: "flex", flexDirection: "column" } },
    });
    const plan = planStack(stacked, "never", false, {
      tiers: stackTiers(BREAKPOINTS),
      state: "base",
    });
    expect(JSON.stringify(plan)).not.toContain("flexDirection");
  });
});

describe("round one: what counts, what is kept", () => {
  it("removes only truly blank columns, keeping a styled one", () => {
    const styled: BlockNode = {
      ...column("b"),
      styles: { base: { base: { padding: { blockStart: "8px" } } } },
    };
    const plan = planLayout(
      row([column("a", [text]), styled, column("c")]),
      "50-50",
      at
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      plan.ops
        .filter(op => op.kind === "remove")
        .map(op => op.kind === "remove" && op.id)
    ).toEqual(["c"]);
    // With no blank column left, the styled one is content, and held.
    const held = planLayout(row([column("a", [text]), styled]), "4", at);
    expect(held.ok).toBe(true);
    const fewer = planLayout(
      row([column("a", [text]), styled, column("c", [text])]),
      "50-50",
      at
    );
    expect(fewer.ok).toBe(false);
  });

  it("leaves a responsive display that is not a stack alone on Never", () => {
    const hidden = row([column("a")], {
      base: { sm: { display: "none" } },
    });
    expect(stackOf(hidden, stackTiers(BREAKPOINTS), "base").on).toBe("never");
    expect(
      planStack(hidden, "never", false, {
        tiers: stackTiers(BREAKPOINTS),
        state: "base",
      })
    ).toBeNull();
  });

  it("finds and clears a stack set at a tier no longer the widest tablet", () => {
    // Stacked at 768px; the site later added a 1024px tablet tier.
    const devices: BreakpointSet = {
      viewport: [
        { id: "lg", label: "Large tablet", maxWidth: 1024 },
        { id: "md", label: "Tablet", maxWidth: 768 },
        { id: "sm", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    };
    const stacked = row([column("a")], {
      base: { md: { display: "flex", flexDirection: "column" } },
    });
    expect(stackOf(stacked, stackTiers(devices), "base").on).toBe("tablet");
    const cleared = planStack(stacked, "never", false, {
      tiers: stackTiers(devices),
      state: "base",
    });
    expect(JSON.stringify(cleared)).not.toContain("flexDirection");
  });
});

describe("round two: defaults and the devices offered", () => {
  const defaulted = (
    id: string,
    props: Record<string, unknown>
  ): BlockNode => ({
    id,
    type: "acme/column",
    version: 1,
    props,
    slots: { children: [] },
  });

  it("removes a column whose props are only its block's defaults", () => {
    const plan = planLayout(
      row([
        column("a", [text]),
        column("b", [text]),
        defaulted("c", { as: "div", contained: false }),
      ]),
      "50-50",
      at
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      plan.ops
        .filter(op => op.kind === "remove")
        .map(op => op.kind === "remove" && op.id)
    ).toEqual(["c"]);
  });

  it("keeps a column carrying anything else an author set, its visibility or its name", () => {
    for (const extra of [
      { visibility: { hideOn: ["sm"] } },
      { name: "Sidebar" },
      { customCss: "& { outline: 1px solid; }" },
    ]) {
      const plan = planLayout(
        row([
          column("a", [text]),
          { ...column("b"), ...extra } as BlockNode,
          column("c"),
        ]),
        "50-50",
        at
      );
      expect(plan.ok, JSON.stringify(extra)).toBe(true);
      if (!plan.ok) continue;
      // The blank one goes, though it came first and the other came last.
      expect(
        plan.ops
          .filter(op => op.kind === "remove")
          .map(op => op.kind === "remove" && op.id)
      ).toEqual(["c"]);
      const held = planLayout(
        row([column("a", [text]), { ...column("b"), ...extra } as BlockNode]),
        "4",
        at
      );
      expect(held.ok).toBe(true);
      const fewer = planLayout(
        row([
          column("a", [text]),
          { ...column("c"), ...extra } as BlockNode,
          column("d", [text]),
        ]),
        "50-50",
        at
      );
      expect(fewer.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it("reads the later of two equal-width tiers first, as the browser applies it", () => {
    const devices: BreakpointSet = {
      viewport: [
        { id: "tab-a", label: "Tablet A", maxWidth: 1024 },
        { id: "tab-b", label: "Tablet B", maxWidth: 1024 },
        { id: "sm", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    };
    const both = row([column("a")], {
      base: {
        "tab-a": { display: "flex", flexDirection: "column" },
        "tab-b": { display: "flex", flexDirection: "column-reverse" },
      },
    });
    expect(stackOf(both, stackTiers(devices), "base")).toEqual({
      on: "tablet",
      reversed: true,
    });
  });

  it("masks a style's stack wider than the chosen tier, and none narrower", () => {
    const plain = row([column("a")]);
    const tiers = stackTiers(BREAKPOINTS);
    const reached = [{ id: "md", reversed: false }];
    expect(stackOf(plain, tiers, "base", reached).on).toBe("tablet");
    const mobile = JSON.stringify(
      planStack(plain, "mobile", false, { tiers, state: "base", reached })
    );
    expect(mobile).toContain('"md":{"display":"grid"}');
    expect(mobile).toContain(
      '"sm":{"display":"flex","flexDirection":"column"}'
    );
    // Chosen where the style already stacks: nothing of the style's to mask.
    const tablet = JSON.stringify(
      planStack(plain, "tablet", false, { tiers, state: "base", reached })
    );
    expect(tablet).not.toContain('"display":"grid"');
  });

  it("keeps a column whose props differ from its defaults", () => {
    const plan = planLayout(
      row([
        column("a", [text]),
        column("b", [text]),
        defaulted("c", { as: "section", contained: false }),
      ]),
      "50-50",
      at
    );
    expect(plan.ok).toBe(false);
  });

  it("stacks at the tier the device switcher offers when two share a width", () => {
    // The later of two equal widths wins in the browser, and is the one the
    // switcher offers: a stack written at the earlier would be overridden.
    const devices: BreakpointSet = {
      viewport: [
        { id: "tab-a", label: "Tablet A", maxWidth: 1024 },
        { id: "tab-b", label: "Tablet B", maxWidth: 1024 },
        { id: "sm", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    };
    const tiers = stackTiers(devices);
    expect(tiers.tablet).toBe("tab-b");
    // Both stay managed, so a stack written at either is still found.
    expect(tiers.managed?.map(tier => tier.id)).toEqual(
      expect.arrayContaining(["tab-a", "tab-b", "sm"])
    );
  });
});

describe("an inherited layout", () => {
  const wide = row([column("a"), column("b")], {
    base: { base: { gridTemplateColumns: "1fr 2fr" } },
  });
  const mobile = { state: "base", breakpoint: "sm" } as const;

  it("is overridden by Auto with the block's own template, not by clearing nothing", () => {
    const plan = planLayout(wide, "auto", mobile, "1fr 2fr");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(JSON.stringify(plan.ops)).toContain('"sm":{"gridTemplateColumns":');
  });
});
