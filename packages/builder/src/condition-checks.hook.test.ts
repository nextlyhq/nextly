// @vitest-environment jsdom

/**
 * The blocks the canvas badges as "can't be checked", judged in the tree the
 * canvas composes, so a placed component's own block is judged as well as
 * the page's.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
} from "@nextlyhq/blocks-engine";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useConditionsUnchecked } from "./condition-checks";

afterEach(cleanup);

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "card",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "promo" },
    },
  ],
} as BlockDocument;

// The component's own block holds conditions stored as a flat list, a shape
// no condition row can show: the page leaves it out.
const definitions: DefinitionsById = new Map([
  [
    "promo",
    {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "inner",
          type: "core/text",
          version: 1,
          props: {},
          visibility: { conditions: [{ field: "title", op: "exists" }] },
        },
      ],
    } as unknown as BlockDocument,
  ],
]);

describe("the conditions the canvas can't check", () => {
  it("include a placed component's own block, judged in the composed tree", () => {
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined, undefined, definitions)
    );
    expect(result.current.size).toBe(1);
    // By the id the composed tree gives it, never the placement's own.
    expect(result.current.has("card")).toBe(false);
  });

  it("judge a component's block deeper than the default depth under the depth the site raised", () => {
    // The unreadable block sits two levels past the default depth, which a
    // site may raise and the canvas then composes and draws under.
    const depth = DEFAULT_LIMITS.maxDepth + 2;
    let nested: BlockNode = {
      id: "deep",
      type: "core/text",
      version: 1,
      props: {},
      visibility: { conditions: [{ field: "title", op: "exists" }] },
    } as unknown as BlockNode;
    for (let level = 0; level < depth; level += 1) {
      nested = {
        id: `box-${String(level)}`,
        type: "core/box",
        version: 1,
        props: {},
        slots: { children: [nested] },
      };
    }
    const deep: DefinitionsById = new Map([
      [
        "promo",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [nested],
        } as unknown as BlockDocument,
      ],
    ]);
    const raised = { ...DEFAULT_LIMITS, maxDepth: depth + 4 };
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined, raised, deep)
    );
    expect(result.current.size).toBe(1);
    // CONTROL: under the default depth the definition is not composed, so
    // nothing of it is judged, which is what a dropped depth did.
    const { result: control } = renderHook(() =>
      useConditionsUnchecked(page, undefined, DEFAULT_LIMITS, deep)
    );
    expect(control.current.size).toBe(0);
  });

  it("include none of them without the definitions, as before", () => {
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined)
    );
    expect(result.current.size).toBe(0);
  });
});
