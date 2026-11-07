// @vitest-environment jsdom

/**
 * The blocks the canvas badges as "can't be checked", judged in the tree the
 * canvas composes, so a placed component's own block is judged as well as
 * the page's.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
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

  it("include none of them without the definitions, as before", () => {
    const { result } = renderHook(() =>
      useConditionsUnchecked(page, undefined)
    );
    expect(result.current.size).toBe(0);
  });
});
