/**
 * What a page's bindings read, asked of stored documents before anything has
 * repaired them: the scan holds itself to the caps the read pipeline applies.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import { DEFAULT_LIMITS } from "./limits";
import { bindingDemand } from "./resolve-bindings";

/** A bound heading under `depth` nested boxes, built without recursion. */
function nestedUnder(depth: number): BlockDocument {
  let node: Record<string, unknown> = {
    id: "deep",
    type: "core/heading",
    version: 1,
    props: {},
    bindings: { text: { $bind: "subtitle" } },
  };
  for (let level = 0; level < depth; level += 1) {
    node = {
      id: `box-${String(level)}`,
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [node] },
    };
  }
  const top = {
    id: "top",
    type: "core/heading",
    version: 1,
    props: {},
    bindings: { text: { $bind: "title" } },
  };
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [top, node],
  } as unknown as BlockDocument;
}

describe("the fields a page's bindings read", () => {
  it("scans a slot chain deeper than the call stack, and reads nothing past the depth cap", () => {
    const demand = bindingDemand([nestedUnder(50_000)]);
    // The binding at the top is read for; the one past the cap, which the read
    // pipeline drops, is not.
    expect(demand.entry).toEqual(["title"]);
  });

  it("reads for a binding within the depth cap", () => {
    const demand = bindingDemand([nestedUnder(DEFAULT_LIMITS.maxDepth - 2)]);
    expect(demand.entry).toEqual(["title", "subtitle"]);
  });
});
