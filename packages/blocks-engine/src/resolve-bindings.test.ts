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
    const demand = bindingDemand([nestedUnder(50_000)], DEFAULT_LIMITS);
    // The binding at the top is read for; the one past the cap, which the read
    // pipeline drops, is not.
    expect(demand.entry?.fields).toEqual(["title"]);
  });

  it("reads for a binding within the depth cap", () => {
    const demand = bindingDemand(
      [nestedUnder(DEFAULT_LIMITS.maxDepth - 2)],
      DEFAULT_LIMITS
    );
    expect(demand.entry?.fields).toEqual(["title", "subtitle"]);
  });

  it("reads past the stored document's depth cap when given no caps, as for a composed tree", () => {
    // A tree the pipeline already prepared is within its own caps; reapplying
    // the stored document's depth cap would drop a component's binding.
    const demand = bindingDemand([nestedUnder(DEFAULT_LIMITS.maxDepth + 5)]);
    expect(demand.entry?.fields).toEqual(["title", "subtitle"]);
  });

  it("lists what each path follows into a related entry, and whether a date is formatted", () => {
    const document = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "core/heading",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "author.name" },
            label: {
              $bind: "publishedAt",
              format: { type: "date", options: { dateStyle: "long" } },
            },
          },
        },
      ],
    } as unknown as BlockDocument;
    const demand = bindingDemand([document]);
    expect(demand.entry?.fields).toEqual(["author", "publishedAt"]);
    expect([...(demand.entry?.follows ?? [])]).toEqual([["author", ["name"]]]);
    expect(demand.formatsDates).toBe(true);
  });
});
