/**
 * A placement's variant key, judged on write: a key the write newly sets must
 * name one of the component's variants, and a key the stored page already
 * held is kept, so a deleted variant does not make the page unsavable.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type ComponentDocument,
} from "./document";
import { placementVariantIssues } from "./placement-variants";

const card: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [],
  variants: { featured: { label: "Featured", overrides: {} } },
};
const definitions = new Map([["card", card]]);

function page(variant?: string, nodeId = "p1"): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: nodeId,
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: {
          componentId: "card",
          ...(variant === undefined ? {} : { variant }),
        },
      },
    ],
  };
}

describe("a placement's variant on write", () => {
  it("accepts a variant the component defines, and none", () => {
    expect(placementVariantIssues(page("featured"), definitions)).toEqual([]);
    expect(placementVariantIssues(page(), definitions)).toEqual([]);
  });

  it("refuses a key the write newly sets that the component lacks", () => {
    expect(placementVariantIssues(page("gone"), definitions)).toEqual([
      expect.objectContaining({
        nodeId: "p1",
        componentId: "card",
        variantId: "gone",
        message: expect.stringContaining('"gone"') as unknown,
      }),
    ]);
  });

  it("keeps a stale key the stored page already held there", () => {
    expect(
      placementVariantIssues(page("gone"), definitions, [page("gone")])
    ).toEqual([]);
  });

  it("does not keep it for another placement or another key", () => {
    expect(
      placementVariantIssues(page("gone"), definitions, [page("gone", "p2")])
    ).toHaveLength(1);
    expect(
      placementVariantIssues(page("gone"), definitions, [page("older")])
    ).toHaveLength(1);
  });

  it("leaves a placement whose component it cannot read to the composition", () => {
    expect(placementVariantIssues(page("gone"), new Map())).toEqual([]);
  });
});
