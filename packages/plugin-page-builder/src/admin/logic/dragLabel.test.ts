import { describe, it, expect } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import "../../render/blocks"; // register core blocks

import { dragLabel } from "./dragLabel";

function rootWith(child: BlockNode): BlockNode {
  return makeNode("core/container", {}, undefined, { default: [child] });
}

describe("dragLabel", () => {
  it("uses the registry label for a library source", () => {
    expect(
      dragLabel(
        { kind: "library", blockType: "core/heading" },
        makeNode("core/container", {}, undefined, { default: [] }),
        defaultBlockRegistry
      )
    ).toBe("Heading");
  });

  it("resolves a node source to its block label via the document", () => {
    const para = makeNode("core/paragraph", { text: "x" });
    expect(
      dragLabel(
        { kind: "node", nodeId: para.id },
        rootWith(para),
        defaultBlockRegistry
      )
    ).toBe("Paragraph");
  });

  it("falls back to 'Block' for an unknown node", () => {
    expect(
      dragLabel(
        { kind: "node", nodeId: "missing" },
        makeNode("core/container", {}, undefined, { default: [] }),
        defaultBlockRegistry
      )
    ).toBe("Block");
  });
});
