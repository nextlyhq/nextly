/**
 * Defining, renaming and deleting a component's variants.
 *
 * The properties under test are the ones a plausible implementation gets
 * wrong: a key derived from the label (so a rename strands every placement), a
 * new key that takes one a placement still holds, a name compared with its
 * case or spaces (so "Featured" and "featured " both exist), a delete that
 * takes the placement's own values with it, and an emptied variant refused
 * rather than warned about.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
} from "./document";
import { resolveComponentInstances } from "./resolve-instances";
import type { ValidationContext } from "./validation";
import { validate } from "./validation";
import {
  planAddVariant,
  planDeleteVariant,
  planRenameVariant,
  planResetVariantValue,
  planSetVariantValue,
  variantOptions,
  type VariantEdit,
  type VariantEditResult,
} from "./variant-planners";

const heading: BlockNode = {
  id: "heading",
  type: "core/heading",
  version: 1,
  props: { text: "Default title", tone: "light" },
};

function card(variants?: ComponentDocument["variants"]): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [heading],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "heading",
        propPath: "text",
        type: "text",
      },
      {
        id: "tone",
        label: "Tone",
        nodeId: "heading",
        propPath: "tone",
        type: "select",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
    ],
    ...(variants === undefined ? {} : { variants }),
  };
}

function edited(result: VariantEditResult): VariantEdit {
  if ("problem" in result) {
    throw new Error(`refused: ${result.problem}`);
  }
  return result;
}

/** What a page placing the card draws for its heading. */
function drawn(definition: ComponentDocument, props: Record<string, unknown>) {
  const page: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "placed",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "card", ...props },
      },
    ],
  };
  const resolved = resolveComponentInstances(
    page,
    new Map([["card", definition]])
  );
  return resolved.document.nodes[0]?.props;
}

const context: ValidationContext = {
  breakpoints: { viewport: [{ id: "base", label: "Desktop" }], container: [] },
  mode: "strict",
};

describe("adding a variant", () => {
  it("files it under an opaque key, not one made from its name", () => {
    const result = edited(planAddVariant(card(), "Featured"));

    expect(result.id).toMatch(/^v-[0-9a-f]{12}$/);
    expect(result.document.variants).toEqual({
      [result.id]: { label: "Featured", overrides: {} },
    });
  });

  it("never takes a key a placement may still hold", () => {
    // A draft that deleted a variant the published definition still has: the
    // published key is passed as taken, and a minter that offers it first must
    // be asked again. Taking it would hand those placements a stranger.
    const offered = ["v-live", "v-published", "v-new"];
    const result = edited(
      planAddVariant(
        card({ "v-live": { label: "Live", overrides: {} } }),
        "New",
        {
          taken: ["v-published"],
          mintKey: () => offered.shift() ?? "unreachable",
        }
      )
    );

    expect(result.id).toBe("v-new");
  });

  it("refuses a name another variant has, ignoring case and spaces", () => {
    const result = planAddVariant(
      card({ compact: { label: "Featured", overrides: {} } }),
      "  FEATURED "
    );

    expect(result).toEqual({ problem: "label-taken", clash: "Featured" });
  });

  it("refuses a blank name", () => {
    expect(planAddVariant(card(), "   ")).toEqual({ problem: "invalid-label" });
  });

  it("starts empty, which the save warns about and keeps", () => {
    const result = edited(planAddVariant(card(), "Quiet"));

    expect(result.warnings.map(issue => [issue.code, issue.severity])).toEqual([
      ["variant-empty", "warning"],
    ]);
    expect(variantOptions(result.document)).toEqual([
      { id: result.id, label: "Quiet", empty: true, values: {} },
    ]);
  });
});

describe("the variants a picker offers", () => {
  it("leaves out one filed under the empty key, which no placement keeps", () => {
    expect(
      variantOptions(
        card({
          "": { label: "Ghost", overrides: {} },
          a: { label: "A", overrides: {} },
        })
      ).map(option => option.id)
    ).toEqual(["a"]);
  });
});

describe("renaming a variant", () => {
  it("keeps its key, so a placement that chose it still draws it", () => {
    const before = card({
      promo: { label: "Promo", overrides: { title: "Sale" } },
    });
    const result = edited(planRenameVariant(before, "promo", "Promotion"));

    expect(result.document.variants).toEqual({
      promo: { label: "Promotion", overrides: { title: "Sale" } },
    });
    expect(drawn(result.document, { variant: "promo" })).toMatchObject({
      text: "Sale",
    });
  });

  it("may change its own name's case", () => {
    const result = edited(
      planRenameVariant(
        card({ promo: { label: "promo", overrides: {} } }),
        "promo",
        "Promo"
      )
    );

    expect(result.document.variants?.promo?.label).toBe("Promo");
  });

  it("refuses another variant's name", () => {
    const result = planRenameVariant(
      card({
        a: { label: "Dark", overrides: {} },
        b: { label: "Light", overrides: {} },
      }),
      "b",
      "dark"
    );

    expect(result).toEqual({ problem: "label-taken", clash: "Dark" });
  });

  it("refuses a key the component does not hold", () => {
    expect(planRenameVariant(card(), "gone", "Gone")).toEqual({
      problem: "unknown-variant",
    });
  });
});

describe("deleting a variant", () => {
  it("leaves its placements on the defaults, with their own values kept", () => {
    const before = card({
      promo: { label: "Promo", overrides: { title: "Sale", tone: "dark" } },
    });
    const result = edited(planDeleteVariant(before, "promo"));

    expect(result.document.variants).toBeUndefined();
    // The placement still holds the deleted key and its own tone.
    expect(
      drawn(result.document, { variant: "promo", overrides: { tone: "dark" } })
    ).toEqual({ text: "Default title", tone: "dark" });
    // Under the variant, before the delete, the title was the variant's.
    expect(drawn(before, { variant: "promo" })).toMatchObject({ text: "Sale" });
  });

  it("keeps the other variants", () => {
    const result = edited(
      planDeleteVariant(
        card({
          a: { label: "A", overrides: { title: "a" } },
          b: { label: "B", overrides: { title: "b" } },
        }),
        "a"
      )
    );

    expect(Object.keys(result.document.variants ?? {})).toEqual(["b"]);
  });

  it("refuses a key the component does not hold", () => {
    expect(planDeleteVariant(card(), "gone")).toEqual({
      problem: "unknown-variant",
    });
  });
});

describe("a variant's values", () => {
  it("are set per exposed field and drawn before the placement's own", () => {
    const added = edited(planAddVariant(card(), "Dark"));
    const set = edited(
      planSetVariantValue(added.document, added.id, "tone", "dark")
    );

    expect(drawn(set.document, { variant: added.id })).toEqual({
      text: "Default title",
      tone: "dark",
    });
    expect(
      drawn(set.document, { variant: added.id, overrides: { tone: "light" } })
    ).toMatchObject({ tone: "light" });
    expect(set.warnings).toEqual([]);
  });

  it("refuse a value the field does not take, saying what it needs", () => {
    const withLink: ComponentDocument = {
      ...card({ a: { label: "A", overrides: {} } }),
      exposed: [
        ...(card().exposed ?? []),
        {
          id: "href",
          label: "Link",
          nodeId: "heading",
          propPath: "href",
          type: "link",
        },
      ],
    };

    expect(
      planSetVariantValue(withLink, "a", "href", "javascript:alert(1)")
    ).toMatchObject({
      problem: "invalid-value",
      needs: expect.stringContaining("link") as unknown,
    });
    expect(planSetVariantValue(withLink, "a", "tone", "neon")).toMatchObject({
      problem: "invalid-value",
    });
    expect(
      "problem" in planSetVariantValue(withLink, "a", "href", "/pricing")
    ).toBe(false);
  });

  it("refuse a field the component does not expose", () => {
    const result = planSetVariantValue(
      card({ a: { label: "A", overrides: {} } }),
      "a",
      "subtitle",
      "x"
    );

    expect(result).toEqual({ problem: "unknown-exposure" });
  });

  it("reset to the default, leaving an emptied variant warned about", () => {
    const result = edited(
      planResetVariantValue(
        card({ a: { label: "A", overrides: { title: "x" } } }),
        "a",
        "title"
      )
    );

    expect(result.document.variants?.a?.overrides).toEqual({});
    expect(result.warnings.map(issue => issue.code)).toEqual(["variant-empty"]);
  });
});

describe("variant names on save", () => {
  const clashing = card({
    a: { label: "Featured", overrides: { title: "a" } },
    b: { label: " featured", overrides: { title: "b" } },
  });

  it("refuse a clash the save creates, naming both", () => {
    const issues = validate(clashing, context).filter(
      issue => issue.code === "variant-label-clash"
    );

    expect(issues).toEqual([
      expect.objectContaining({
        severity: "error",
        path: "/variants/b/label",
        message: expect.stringContaining('"featured"') as unknown,
      }),
    ]);
    expect(issues[0]?.message).toContain('"Featured"');
  });

  it("only warn about a clash the stored definition already holds", () => {
    const issues = validate(clashing, { ...context, stored: [clashing] });

    expect(
      issues
        .filter(issue => issue.code === "variant-label-clash")
        .map(issue => issue.severity)
    ).toEqual(["warning"]);
  });

  it("refuse a new clash beside a stored one", () => {
    const stored = clashing;
    const next = card({
      ...clashing.variants,
      c: { label: "Dark", overrides: { tone: "dark" } },
      d: { label: "DARK", overrides: { tone: "dark" } },
    });

    expect(
      validate(next, { ...context, stored: [stored] })
        .filter(issue => issue.code === "variant-label-clash")
        .map(issue => [issue.path, issue.severity])
    ).toEqual([
      ["/variants/b/label", "warning"],
      ["/variants/d/label", "error"],
    ]);
  });

  it("refuse a variant newly given a name a stored pair already shares", () => {
    const next = card({
      ...clashing.variants,
      c: { label: "FEATURED", overrides: { title: "c" } },
    });

    expect(
      validate(next, { ...context, stored: [clashing] })
        .filter(issue => issue.code === "variant-label-clash")
        .map(issue => [issue.path, issue.severity])
    ).toEqual([
      ["/variants/b/label", "warning"],
      ["/variants/c/label", "error"],
    ]);
  });

  it("refuse a newcomer ordered before the variants that shared the name", () => {
    const next = card({
      c: { label: "featured", overrides: { title: "c" } },
      ...clashing.variants,
    });

    expect(
      validate(next, { ...context, stored: [clashing] })
        .filter(issue => issue.code === "variant-label-clash")
        .map(issue => [issue.path, issue.severity])
    ).toEqual([
      ["/variants/c/label", "error"],
      ["/variants/b/label", "warning"],
    ]);
  });

  it("accept distinct names", () => {
    const issues = validate(
      card({
        a: { label: "Featured", overrides: { title: "a" } },
        b: { label: "Compact", overrides: { title: "b" } },
      }),
      context
    );

    expect(
      issues.filter(issue => issue.code === "variant-label-clash")
    ).toEqual([]);
  });
});
