/**
 * A block's custom CSS goes with the block: saved as a section, saved as a
 * component, turned into one in place. The stored CSS keeps `selector`, so it
 * scopes to the block wherever the copy lands.
 */
import { describe, expect, it } from "vitest";

import {
  planConvertToComponent,
  planSaveAsComponent,
  planSaveAsPattern,
} from "./composition-planners";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import { walkNodes } from "./tree";

const CSS = "selector { border: 4px solid blue; }";

const node = (
  id: string,
  extra: Partial<BlockNode> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  ...extra,
  ...(slots === undefined ? {} : { slots }),
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const anyParent = { parentsOf: () => undefined };

/** Every custom CSS value in a forest, in document order. */
function cssIn(nodes: readonly BlockNode[]): string[] {
  const out: string[] = [];
  walkNodes(nodes as BlockNode[], n => {
    if (n.customCss !== undefined) out.push(n.customCss);
  });
  return out;
}

/** A section holding a block with CSS, and the block itself with CSS. */
const withCss = () =>
  page([
    node(
      "a",
      { customCss: CSS },
      { children: [node("inner", { customCss: CSS })] }
    ),
    node("b"),
  ]);

describe("a block's custom CSS", () => {
  it("is kept when the block is saved as a section", () => {
    const plan = planSaveAsPattern(
      withCss(),
      ["a"],
      { collection: "patterns", fields: {} },
      anyParent
    );
    expect(plan.problem).toBeUndefined();
    expect(cssIn(plan.create?.document.nodes ?? [])).toEqual([CSS, CSS]);
  });

  it("is kept when the block is saved as a component", () => {
    const plan = planSaveAsComponent(
      withCss(),
      ["a"],
      { collection: "components", fields: {} },
      {},
      anyParent
    );
    expect(plan.problem).toBeUndefined();
    expect(cssIn(plan.create?.document.nodes ?? [])).toEqual([CSS, CSS]);
  });

  it("is kept in the component a block is turned into", () => {
    const plan = planConvertToComponent(
      withCss(),
      ["a"],
      { collection: "components", fields: {} },
      "def-1",
      {},
      anyParent
    );
    expect(plan.problem).toBeUndefined();
    expect(cssIn(plan.create?.document.nodes ?? [])).toEqual([CSS, CSS]);
  });
});
