/**
 * A node marked "never quote this": the op layer sets and clears the mark,
 * refuses a value that is not on or off, and a document written before the
 * mark existed reads exactly as it did.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import { applyOps } from "./ops";
import { validate } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

const section = (extra: Partial<BlockNode> = {}): BlockNode => ({
  id: "s",
  type: "core/section",
  version: 1,
  props: { as: "section" },
  ...extra,
});

describe("the nosnippet mark", () => {
  it("is set by an update and cleared by unsetting it", () => {
    const marked = applyOps(page([section()]), [
      { kind: "update", id: "s", patch: { nosnippet: true } },
    ]).document;
    expect(marked.nodes[0]!.nosnippet).toBe(true);

    const cleared = applyOps(marked, [
      { kind: "update", id: "s", patch: {}, unset: ["nosnippet"] },
    ]).document;
    expect(cleared.nodes[0]).not.toHaveProperty("nosnippet");
  });

  it("refuses an update that sets it to anything but on or off", () => {
    expect(() =>
      applyOps(page([section()]), [
        {
          kind: "update",
          id: "s",
          patch: { nosnippet: "yes" } as unknown as BlockNode,
        },
      ])
    ).toThrow();
  });

  it("leaves a document written before it unchanged and valid", () => {
    const before = page([section({ name: "Pricing table", cssId: "pricing" })]);
    const copy = structuredClone(before);
    expect(
      validate(copy, { mode: "strict", breakpoints: FIXTURE_BREAKPOINTS })
    ).toEqual([]);
    expect(copy).toEqual(before);
    expect(copy.nodes[0]).not.toHaveProperty("nosnippet");
  });
});
