/**
 * A component's variant may not change a block the component locks.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
} from "./document";
import {
  hostVariantLockChanges,
  variantLockChanges,
} from "./layers-lock-variants";

/** The changes a judged answer holds; an unchecked one fails the case. */
function judgedChanges(...args: Parameters<typeof variantLockChanges>) {
  const answer = variantLockChanges(...args);
  if (answer.kind !== "judged") throw new Error("expected a judged answer");
  return answer.changes;
}

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
      judgedChanges(component({ dark: { title: "Changed" } }), component())
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
      judgedChanges(component({ dark: { subtitle: "Sale" } }), component())
    ).toEqual([]);
  });

  it("keeps a variant the stored component already gave the locked block", () => {
    const stored = component({ dark: { title: "Changed" } });
    expect(
      judgedChanges(component({ dark: { title: "Changed" } }), stored)
    ).toEqual([]);
  });

  it("accepts the change in the write that unlocks the block", () => {
    expect(
      judgedChanges(
        component({ dark: { title: "Changed" } }, false),
        component()
      )
    ).toEqual([]);
  });

  it("refuses a lock this same write adds to a block an existing variant sets", () => {
    const stored = component({ dark: { title: "Changed" } }, false);
    expect(
      judgedChanges(component({ dark: { title: "Changed" } }), stored)
    ).toEqual([expect.objectContaining({ label: "Hero", variant: "dark" })]);
  });

  it("judges a new component's variants against it drawn with none", () => {
    expect(
      judgedChanges(component({ dark: { title: "Changed" } }), undefined)
    ).toEqual([expect.objectContaining({ label: "Hero", variant: "dark" })]);
    expect(
      judgedChanges(component({ dark: { subtitle: "Sale" } }), undefined)
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

    expect(judgedChanges(outer, undefined)).toEqual([]);
    expect(judgedChanges(outer, undefined, { components })).toEqual([
      expect.objectContaining({ label: "Hero", variant: "loud" }),
    ]);
  });

  it("reaches a block locked inside a component it places behind a condition gate", () => {
    // Gated, the nested placement is left unexpanded when drawn as served,
    // but its relayed value is stored and served once the condition lifts.
    const outer = (overrides: Record<string, string>) => ({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "nested",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "promo" },
          visibility: {
            conditions: [[{ field: "title", op: "eq", value: "Home" }]],
          },
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
        {
          id: "strap",
          label: "Strap",
          nodeId: "nested",
          propPath: "overrides.subtitle",
          type: "text",
        },
      ],
      variants: { loud: { label: "Loud", overrides } },
    });
    const components = new Map([["promo", component() as never]]);

    expect(
      judgedChanges(outer({ headline: "Changed" }), undefined, {
        components,
      })
    ).toEqual([expect.objectContaining({ label: "Hero", variant: "loud" })]);
    // CONTROL: the relayed value for the free block is the variant's to set.
    expect(
      judgedChanges(outer({ strap: "Sale" }), undefined, { components })
    ).toEqual([]);
  });

  describe("charged to a shared work allowance", () => {
    /** A component of `size` blocks offering `count` variants. */
    const many = (size: number, count: number) => ({
      ...component(),
      nodes: [
        ...component().nodes,
        ...Array.from({ length: size }, (_, i) => heading(`b${String(i)}`)),
      ],
      variants: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `v${String(i)}`,
          { label: `V${String(i)}`, overrides: { subtitle: String(i) } },
        ])
      ),
    });

    it("charges every draw to the allowance it is handed", () => {
      const work = { left: 1_000_000 };
      const answer = variantLockChanges(many(50, 10), many(50, 10), { work });

      expect(answer).toEqual({ kind: "judged", changes: [] });
      // The written component drawn once with no variant, then written and
      // stored drawn per variant: at least one entry each, of 52 blocks.
      expect(1_000_000 - work.left).toBeGreaterThanOrEqual(21 * 52);
    });

    it("answers unchecked once the allowance is spent, rather than judging a prefix", () => {
      const work = { left: 52 * 5 };

      expect(variantLockChanges(many(50, 10), undefined, { work })).toEqual({
        kind: "unchecked",
      });
      // CONTROL: a variant changing the locked block after the allowance
      // would run out is not passed as judged.
      const late = many(50, 10);
      late.variants.v9 = {
        label: "V9",
        overrides: { title: "Changed" },
      } as never;
      expect(
        variantLockChanges(late, undefined, { work: { left: 52 * 5 } })
      ).toEqual({ kind: "unchecked" });
    });
  });

  describe("a component placing one whose locks a write changes", () => {
    /** A banner placing the promo, whose variant relays a value onto `exposure`. */
    const banner = (exposure: "title" | "subtitle") => ({
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
          id: "relayed",
          label: "Relayed",
          nodeId: "nested",
          propPath: `overrides.${exposure}`,
          type: "text",
        },
      ],
      variants: { loud: { label: "Loud", overrides: { relayed: "Changed" } } },
    });
    const library = (heroLocked: boolean) =>
      new Map([["promo", component({}, heroLocked) as never]]);

    it("reports a block the write newly locks that the host's variant changes", () => {
      expect(
        hostVariantLockChanges(banner("title"), {
          before: library(false),
          after: library(true),
        })
      ).toEqual({
        kind: "judged",
        changes: [expect.objectContaining({ label: "Hero", variant: "loud" })],
      });
      // CONTROL: the lock lands on a block the variant leaves alone.
      expect(
        hostVariantLockChanges(banner("subtitle"), {
          before: library(false),
          after: library(true),
        })
      ).toEqual({ kind: "judged", changes: [] });
    });

    it("leaves out a change the host's variant already made before the write", () => {
      expect(
        hostVariantLockChanges(banner("title"), {
          before: library(true),
          after: library(true),
        })
      ).toEqual({ kind: "judged", changes: [] });
    });

    it("answers unchecked once the allowance is spent", () => {
      expect(
        hostVariantLockChanges(banner("title"), {
          before: library(false),
          after: library(true),
          work: { left: 1 },
        })
      ).toEqual({ kind: "unchecked" });
    });
  });
});
