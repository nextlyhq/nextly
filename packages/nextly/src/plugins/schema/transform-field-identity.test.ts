import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";

import { applyPluginSchemaContributions } from "./apply-contributions";

/**
 * A field a disabled plugin's transform moves to another group is found again
 * by its name anywhere in the entity, so it keeps its access rule. Only the
 * entity's fields name a field: an index, or any other named record the entity
 * holds, shares the name without making the field ambiguous.
 */
const cfg = (partial: Partial<NextlyServiceConfig>): NextlyServiceConfig =>
  ({ imageProcessor: {}, ...partial }) as unknown as NextlyServiceConfig;

const disabledPlugin = (
  transform: (entity: Record<string, unknown>) => Record<string, unknown>
): PluginDefinition => ({
  name: "plugin-b",
  version: "1.0.0",
  nextly: ">=0.0.0",
  enabled: false,
  contributes: { transforms: [{ target: "a-forms", transform }] },
});

/** Moves every field of the first group into the second. */
const moveIntoSecondGroup = (
  entity: Record<string, unknown>
): Record<string, unknown> => {
  const [a, b, ...rest] = entity.fields as { fields: unknown[] }[];
  return {
    ...entity,
    fields: [{ ...a, fields: [] }, { ...b, fields: a?.fields ?? [] }, ...rest],
  };
};

const groups = (rule: unknown, ...more: unknown[]) => [
  {
    name: "a",
    type: "group",
    fields: [{ name: "idx_secret", type: "text", access: rule }],
  },
  { name: "b", type: "group", fields: [] },
  ...more,
];

const transformed = (definition: Record<string, unknown>) =>
  applyPluginSchemaContributions(
    cfg({
      // The app's own entity: a plugin reshaping the app's fields is what
      // transforms are for.
      collections: [
        { slug: "a-forms", ...definition } as unknown as CollectionConfig,
      ],
    }),
    [disabledPlugin(moveIntoSecondGroup)]
  ).collections?.[0] as unknown as {
    fields: { fields: Record<string, unknown>[] }[];
  };

describe("a disabled plugin's transform moving a field to another group", () => {
  it("keeps the field's access rule when an index shares the field's name", () => {
    const rule = { read: () => false };
    const forms = transformed({
      fields: groups(rule),
      indexes: [{ name: "idx_secret", fields: ["a_idx_secret"] }],
    });
    expect(forms.fields[1]?.fields[0]?.name).toBe("idx_secret");
    expect(forms.fields[1]?.fields[0]?.access).toBe(rule);
  });

  it("keeps it with no index of that name (control)", () => {
    const rule = { read: () => false };
    const forms = transformed({ fields: groups(rule) });
    expect(forms.fields[1]?.fields[0]?.access).toBe(rule);
  });

  it("credits the moved field with neither rule when two fields share its name", () => {
    // Two fields named alike are what makes a name ambiguous, and the moved
    // one is found as neither.
    const rule = { read: () => false };
    const forms = transformed({
      fields: groups(rule, {
        name: "c",
        type: "group",
        fields: [{ name: "idx_secret", type: "text" }],
      }),
    });
    expect(forms.fields[1]?.fields[0]?.name).toBe("idx_secret");
    expect(forms.fields[1]?.fields[0]).not.toHaveProperty("access");
  });
});
