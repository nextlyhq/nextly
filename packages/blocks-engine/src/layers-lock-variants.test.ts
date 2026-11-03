/**
 * A component's variant may not change a block the component locks.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
} from "./document";
import { variantLockChanges } from "./layers-lock-variants";

const heading = (id: string, extra: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

/** A component with a locked "Hero" exposed as `title` and a free block as `subtitle`. */
function component(
  variants: Record<string, Record<string, string>> = {},
  heroLocked = true
) {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      heading("hero", {
        name: "Hero",
        ...(heroLocked ? { locked: true } : {}),
      }),
      heading("sub"),
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "hero",
        propPath: "text",
        type: "text",
      },
      {
        id: "subtitle",
        label: "Subtitle",
        nodeId: "sub",
        propPath: "text",
        type: "text",
      },
    ],
    variants: Object.fromEntries(
      Object.entries(variants).map(([name, overrides]) => [
        name,
        { label: name, overrides },
      ])
    ),
  };
}

describe("variantLockChanges", () => {
  it("refuses a variant that sets a value on the locked block, naming it", () => {
    expect(
      variantLockChanges(component({ dark: { title: "Changed" } }), component())
    ).toEqual([
      expect.objectContaining({
        kind: "changed",
        label: "Hero",
        variant: "dark",
      }),
    ]);
  });

  it("accepts a variant that sets a value on a free block", () => {
    expect(
      variantLockChanges(component({ dark: { subtitle: "Sale" } }), component())
    ).toEqual([]);
  });

  it("keeps a variant the stored component already gave the locked block", () => {
    const stored = component({ dark: { title: "Changed" } });
    expect(
      variantLockChanges(component({ dark: { title: "Changed" } }), stored)
    ).toEqual([]);
  });

  it("accepts the change in the write that unlocks the block", () => {
    expect(
      variantLockChanges(
        component({ dark: { title: "Changed" } }, false),
        component()
      )
    ).toEqual([]);
  });

  it("refuses a lock this same write adds to a block an existing variant sets", () => {
    const stored = component({ dark: { title: "Changed" } }, false);
    expect(
      variantLockChanges(component({ dark: { title: "Changed" } }), stored)
    ).toEqual([expect.objectContaining({ label: "Hero", variant: "dark" })]);
  });

  it("judges a new component's variants against it drawn with none", () => {
    expect(
      variantLockChanges(component({ dark: { title: "Changed" } }), undefined)
    ).toEqual([expect.objectContaining({ label: "Hero", variant: "dark" })]);
    expect(
      variantLockChanges(component({ dark: { subtitle: "Sale" } }), undefined)
    ).toEqual([]);
  });

  it("reaches a block locked inside a component it places, through the library", () => {
    // The outer component places the promo and relays the promo's `title`
    // as its own `headline`; its variant sets that headline.
    const outer = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "nested",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "promo" },
        },
      ],
      exposed: [
        {
          id: "headline",
          label: "Headline",
          nodeId: "nested",
          propPath: "overrides.title",
          type: "text",
        },
      ],
      variants: { loud: { label: "Loud", overrides: { headline: "Changed" } } },
    };
    const components = new Map([["promo", component() as never]]);

    expect(variantLockChanges(outer, undefined)).toEqual([]);
    expect(variantLockChanges(outer, undefined, { components })).toEqual([
      expect.objectContaining({ label: "Hero", variant: "loud" }),
    ]);
  });
});
