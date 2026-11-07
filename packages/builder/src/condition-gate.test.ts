/**
 * The definitions as the renderer reads them, for the canvas's marks and the
 * conditions it can't check: stored placement gates removed, and stored data
 * the resolver repairs handed on rather than thrown on.
 */
import {
  resolveComponentInstances,
  type BlockDocument,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { asStoredDefinitions } from "./condition-gate";

/** Stored data in a shape the types don't allow, as a database may hold. */
function stored(json: string): BlockDocument {
  const parsed: BlockDocument = JSON.parse(json);
  return parsed;
}

const page = stored(
  JSON.stringify({
    version: 1,
    nodes: [
      {
        id: "placed",
        type: "core/component-instance",
        version: 1,
        props: { componentId: "card" },
      },
    ],
  })
);

describe("the definitions as the renderer reads them", () => {
  it("hands on a definition whose nodes are not a list, for the resolver to judge", () => {
    const definition = stored('{"version":1,"nodes":"not a list"}');
    const definitions: DefinitionsById = new Map([["card", definition]]);
    const lookup = asStoredDefinitions(definitions);
    // Kept as stored, rather than a throw from reading it as a list.
    expect(lookup.get("card")?.nodes).toBe("not a list");
    expect(() =>
      resolveComponentInstances(page, lookup, { conditioned: "carry" })
    ).not.toThrow();
  });

  it("keeps a null entry as stored and still removes the gate beside it", () => {
    const definitions: DefinitionsById = new Map([
      [
        "card",
        stored(
          JSON.stringify({
            version: 1,
            nodes: [
              null,
              {
                id: "title",
                type: "core/text",
                version: 1,
                props: {},
                visibility: { within: [[{ field: "title", op: "exists" }]] },
              },
            ],
          })
        ),
      ],
    ]);
    const nodes: readonly unknown[] =
      asStoredDefinitions(definitions).get("card")?.nodes ?? [];
    expect(nodes[0]).toBeNull();
    // The block beside it still loses its stored placement gate, so the
    // guard skips only what isn't a block.
    expect(nodes[1]).toMatchObject({ id: "title" });
    expect(JSON.stringify(nodes[1])).not.toContain("within");
  });
});
