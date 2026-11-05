/**
 * A Columns row's layout, as tiles, and where it stacks: what each choice
 * writes, and which column changes it makes or refuses.
 *
 * @module columns-layout.test
 */
import {
  clearBlocks,
  registerBlocks,
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
      block("core/columns", { allow: ["core/column"] }),
      block("core/column", {}),
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
    expect(plan.ok && JSON.stringify(plan.ops)).not.toContain(
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
      "Needs 1 column removed, and every column holds content. Empty one first."
    );
  });
});

describe("stacking", () => {
  it("finds the tablet and mobile tiers by width, as the device switcher does", () => {
    expect(stackTiers(BREAKPOINTS)).toEqual({ tablet: "md", mobile: "sm" });
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
