/**
 * A component's variants as the editor changes them, and a placement's choice.
 *
 * The properties under test are what a plausible editor gets wrong: an edit
 * written as more than one undo step, a rename or delete that touches the
 * placements, a key reused after a delete in the same session, a stale key
 * read as "no variant", and a delete sentence that says "none" for a count it
 * never made.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockNode,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  addVariant,
  chooseVariantOp,
  defaultValueOf,
  deleteSentence,
  deleteVariant,
  nextVariantName,
  renameVariant,
  setVariantValue,
  valuesSummary,
  variantChoiceOf,
  type VariantEditContext,
} from "./component-variants";
import type { BuilderOp } from "./ops";

function card(variants?: ComponentDocument["variants"]): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "heading",
        type: "core/heading",
        version: 1,
        props: { text: "Default title" },
      },
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "heading",
        propPath: "text",
        type: "text",
      },
    ],
    ...(variants === undefined ? {} : { variants }),
  };
}

/** An editor that records the ops it is handed and accepts each. */
function recording(
  component: ComponentDocument,
  taken: readonly string[] = []
): { context: VariantEditContext; ops: BuilderOp[] } {
  const ops: BuilderOp[] = [];
  return {
    ops,
    context: {
      component,
      taken,
      editor: {
        limits: {
          maxDepth: 64,
          maxNodes: 5000,
          maxBytes: 2_000_000,
        } as VariantEditContext["editor"]["limits"],
        apply: op => {
          ops.push(op);
          return component;
        },
      },
    },
  };
}

describe("editing a component's variants", () => {
  it("writes an addition as one envelope op, never naming a seen key", () => {
    const { context, ops } = recording(card(), ["v-gone"]);
    const outcome = addVariant(context, "Featured");

    expect(outcome.applied).toBe(true);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "envelope" });
    const id = outcome.applied ? outcome.id : "";
    expect(id).not.toBe("v-gone");
    expect(ops[0]).toEqual({
      kind: "envelope",
      patch: { variants: { [id]: { label: "Featured", overrides: {} } } },
    });
  });

  it("renames in place, keeping the key", () => {
    const { context, ops } = recording(
      card({ promo: { label: "Promo", overrides: { title: "Sale" } } })
    );

    expect(renameVariant(context, "promo", "Promotion")).toEqual({
      applied: true,
      id: "promo",
    });
    expect(ops).toEqual([
      {
        kind: "envelope",
        patch: {
          variants: {
            promo: { label: "Promotion", overrides: { title: "Sale" } },
          },
        },
      },
    ]);
  });

  it("says why a taken name is refused, and applies nothing", () => {
    const { context, ops } = recording(
      card({
        a: { label: "Dark", overrides: {} },
        b: { label: "Light", overrides: {} },
      })
    );

    expect(renameVariant(context, "b", " dark")).toEqual({
      applied: false,
      reason: "There is already a variant called “Dark”. Choose another name.",
    });
    expect(ops).toEqual([]);
  });

  it("removes the record when the last variant is deleted", () => {
    const { context, ops } = recording(
      card({ a: { label: "A", overrides: {} } })
    );

    expect(deleteVariant(context, "a").applied).toBe(true);
    expect(ops).toEqual([{ kind: "envelope", patch: {}, unset: ["variants"] }]);
  });

  it("sets a value on one variant only", () => {
    const { context, ops } = recording(
      card({
        a: { label: "A", overrides: {} },
        b: { label: "B", overrides: {} },
      })
    );

    setVariantValue(context, "a", "title", "Big");
    expect(ops).toEqual([
      {
        kind: "envelope",
        patch: {
          variants: {
            a: { label: "A", overrides: { title: "Big" } },
            b: { label: "B", overrides: {} },
          },
        },
      },
    ]);
  });

  it("names a new variant past the ones there are", () => {
    expect(nextVariantName(card())).toBe("Variant 1");
    expect(
      nextVariantName(
        card({
          a: { label: "Variant 2", overrides: {} },
          b: { label: "variant 3", overrides: {} },
        })
      )
    ).toBe("Variant 4");
  });

  it("reads a field's default off the node it drives", () => {
    const component = card();
    expect(defaultValueOf(component, component.exposed![0]!)).toBe(
      "Default title"
    );
  });

  it("summarises an empty variant as no changes", () => {
    expect(
      valuesSummary({ id: "a", label: "A", empty: true, values: {} })
    ).toBe("(no changes)");
    expect(
      valuesSummary({ id: "a", label: "A", empty: false, values: { t: 1 } })
    ).toBe("1 value");
  });
});

describe("the delete sentence", () => {
  it("counts, and says at least when the count is a floor", () => {
    expect(
      deleteSentence({ placements: 3, documents: 2, complete: true })
    ).toMatch(/^Used by 3 placements in 2 documents\. /);
    expect(
      deleteSentence({ placements: 1, documents: 1, complete: false })
    ).toMatch(/^Used by at least 1 placement in 1 document\. /);
  });

  it("never says none for a count it could not make", () => {
    expect(deleteSentence(null)).toContain("could not be counted");
    expect(deleteSentence(null)).not.toContain("No placement");
    expect(deleteSentence(undefined)).toContain("Counting");
  });
});

describe("a placement's variant", () => {
  const placed = (props: Record<string, unknown>): BlockNode => ({
    id: "p1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "card", overrides: { title: "Mine" }, ...props },
  });
  const definition = card({
    featured: { label: "Featured", overrides: { title: "Big" } },
    quiet: { label: "Quiet", overrides: {} },
  });

  it("offers the component's variants, marking an empty one", () => {
    expect(
      variantChoiceOf(definition, placed({ variant: "featured" }))
    ).toEqual({
      options: [
        {
          id: "featured",
          label: "Featured",
          empty: false,
          values: { title: "Big" },
        },
        { id: "quiet", label: "Quiet", empty: true, values: {} },
      ],
      chosen: "featured",
      removed: false,
    });
  });

  it("reads a deleted variant's key as removed, not as none", () => {
    expect(
      variantChoiceOf(definition, placed({ variant: "gone" }))
    ).toMatchObject({ chosen: "gone", removed: true });
    expect(variantChoiceOf(definition, placed({}))).toMatchObject({
      removed: false,
    });
  });

  it("keeps the component and the placement's own values when choosing", () => {
    expect(chooseVariantOp(placed({}), "featured")).toEqual({
      kind: "update",
      id: "p1",
      patch: {
        props: {
          componentId: "card",
          overrides: { title: "Mine" },
          variant: "featured",
        },
      },
    });
    expect(chooseVariantOp(placed({ variant: "gone" }), undefined)).toEqual({
      kind: "update",
      id: "p1",
      patch: {
        props: { componentId: "card", overrides: { title: "Mine" } },
      },
    });
  });
});
