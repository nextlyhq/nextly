// @vitest-environment jsdom

/**
 * The blocks the canvas badges as "can't be checked", judged in the tree the
 * canvas composes, so a placed component's own block is judged as well as
 * the page's.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  resolveComponentInstances,
  revealConditioned,
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

/**
 * The id the composed tree gives the page's first drawn block, composed as
 * the canvas composes it.
 */
function composedRootId(
  document: BlockDocument,
  defined: DefinitionsById
): string | undefined {
  return resolveComponentInstances(revealConditioned(document), defined, {
    conditioned: "carry",
  }).document.nodes[0]?.id;
}

describe("the conditions the canvas can't check", () => {
  it("include a placed component's own block, judged in the composed tree", () => {
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined, undefined, definitions)
    );
    // By the id the composed tree gives it, the one the canvas draws it
    // with, never the placement's own.
    expect([...result.current]).toEqual([composedRootId(page, definitions)]);
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

  it("include the blocks a placement nested in a component gates in a shape nothing can read", () => {
    // "frame" places "promo" with conditions stored as a flat list; only the
    // composed tree carries them, on promo's block.
    const nested: DefinitionsById = new Map([
      [
        "frame",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "nested",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "promo" },
              visibility: { conditions: [{ field: "title", op: "exists" }] },
            },
          ],
        } as unknown as BlockDocument,
      ],
      [
        "promo",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [{ id: "leaf", type: "core/text", version: 1, props: {} }],
        } as unknown as BlockDocument,
      ],
    ]);
    const framed = {
      ...page,
      nodes: [
        {
          id: "card",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "frame" },
        },
      ],
    } as BlockDocument;
    const { result } = renderHook(() =>
      useConditionsUnchecked(framed, undefined, undefined, nested)
    );
    expect([...result.current]).toEqual([composedRootId(framed, nested)]);
  });

  it("include nothing for a placement gate a definition stores, which the renderer removes", () => {
    const stored: DefinitionsById = new Map([
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
              visibility: { within: "not a list" },
            },
          ],
        } as unknown as BlockDocument,
      ],
    ]);
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined, undefined, stored)
    );
    expect([...result.current]).toEqual([]);
    // CONTROL: the same block with conditions of its own that nothing can
    // read is marked, so the pass does judge this block.
    const own: DefinitionsById = new Map([
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
              visibility: { conditions: "not a list" },
            },
          ],
        } as unknown as BlockDocument,
      ],
    ]);
    const { result: control } = renderHook(() =>
      useConditionsUnchecked(page, undefined, undefined, own)
    );
    expect(control.current.size).toBe(1);
  });

  it("include none of them without the definitions, as before", () => {
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined)
    );
    expect(result.current.size).toBe(0);
  });
});
