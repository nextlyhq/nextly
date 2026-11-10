/**
 * The definitions as the renderer reads them, for the canvas's marks and the
 * conditions it can't check: the renderer's own repair, so the editor
 * composes the tree the canvas draws, and malformed stored data is repaired
 * or refused rather than thrown on.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  resolveComponentInstances,
  type BlockDocument,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { asStoredDefinitions } from "./condition-gate";

/** Stored data in a shape the types don't allow, as a database may hold. */
function stored(value: unknown): BlockDocument {
  const parsed: BlockDocument = JSON.parse(JSON.stringify(value));
  return parsed;
}

const page = stored({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "placed",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "card" },
    },
  ],
});

const title = {
  id: "title",
  type: "core/text",
  version: 1,
  props: {},
  visibility: { within: [[{ field: "title", op: "exists" }]] },
};

describe("the definitions as the renderer reads them", () => {
  it("leaves a definition whose nodes are not a list for the resolver to report unreadable", () => {
    const definitions: DefinitionsById = new Map([
      [
        "card",
        stored({
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: "not a list",
        }),
      ],
    ]);
    const lookup = asStoredDefinitions(definitions);
    // Supplied, so not missing; unreadable, so no document to compose.
    expect(lookup.has("card")).toBe(true);
    expect(lookup.get("card")).toBeUndefined();
    const composed = resolveComponentInstances(page, lookup, {
      conditioned: "carry",
    });
    expect(composed.unresolved.map(entry => entry.instanceId)).toEqual([
      "placed",
    ]);
  });

  it("drops an entry that is not a block, as the renderer drops it, and removes a stored gate", () => {
    const definitions: DefinitionsById = new Map([
      [
        "card",
        stored({
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [null, title],
        }),
      ],
    ]);
    const lookup = asStoredDefinitions(definitions);
    const nodes: readonly unknown[] = lookup.get("card")?.nodes ?? [];
    // Dropped rather than kept, so it counts against no node budget the
    // composition spends.
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: "title" });
    // A placement gate is the resolver's to write, never stored data's.
    expect(JSON.stringify(nodes[0])).not.toContain("within");
    const composed = resolveComponentInstances(page, lookup, {
      conditioned: "carry",
    });
    expect(composed.unresolved).toEqual([]);
    expect(composed.document.nodes).toHaveLength(1);
  });
});
