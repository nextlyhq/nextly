/**
 * A component's variant may not change a block the component locks.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockNode } from "./document";
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
});
