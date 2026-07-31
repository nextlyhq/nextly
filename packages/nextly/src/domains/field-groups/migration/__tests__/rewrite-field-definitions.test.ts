import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../manifest";
import {
  rewriteFieldDefinitions,
  type FieldGroupVocabulary,
} from "../rewrite-field-definitions";

/** The real pair, so the tests exercise the vocabulary that actually ships. */
const LEGACY: FieldGroupVocabulary = {
  fieldType: STORAGE_FORMAT.fieldType,
  refKeys: {
    single: STORAGE_FORMAT.refKeys.single,
    many: STORAGE_FORMAT.refKeys.many,
    legacy: STORAGE_FORMAT.refKeys.legacy,
  },
};
const MIGRATED: FieldGroupVocabulary = {
  fieldType: MIGRATION_TARGET.fieldType,
  refKeys: {
    single: MIGRATION_TARGET.refKeys.single,
    many: MIGRATION_TARGET.refKeys.many,
  },
};

function up(fields: unknown): unknown {
  return rewriteFieldDefinitions(fields, LEGACY, MIGRATED);
}

describe("rewriting field-group vocabulary in stored definitions", () => {
  it("renames the type and the single reference together", () => {
    expect(
      up([{ name: "hero", type: "component", component: "hero" }])
    ).toEqual([{ name: "hero", type: "fieldGroup", fieldGroup: "hero" }]);
  });

  it("renames a dynamic zone's accepted list", () => {
    expect(
      up([{ name: "blocks", type: "component", components: ["a", "b"] }])
    ).toEqual([
      { name: "blocks", type: "fieldGroup", fieldGroups: ["a", "b"] },
    ]);
  });

  it("leaves a user's own field named like a reference key alone", () => {
    const authored = [
      { name: "components", type: "text" },
      { name: "component", type: "text" },
    ];
    expect(up(authored)).toEqual(authored);
  });

  // 🔴 The trap the whole design exists for, and the one the test above does
  // NOT cover: the reference keys are property names, so a field of some other
  // type carrying a property called `component` or `components` — a plugin
  // type's own option, say — would be rewritten by a rule keyed on the property
  // name alone. That silently rewrites another type's configuration into
  // something it cannot read.
  it("leaves reference-key property names alone on a field that is not a field group", () => {
    const authored = [
      { name: "picker", type: "my-plugin-field", components: ["a", "b"] },
      { name: "single", type: "my-plugin-field", component: "hero" },
      { name: "old", type: "relationship", componentSlug: "hero" },
    ];
    expect(up(authored)).toEqual(authored);
  });

  // The same word appears as a value in author data. Only `type` on a
  // field-group node means the discriminator; everywhere else it is content.
  it("leaves the word alone when it is a stored value rather than a type", () => {
    const authored = [
      { name: "label", type: "text", defaultValue: "component" },
      { name: "kind", type: "select", options: ["component", "components"] },
    ];
    expect(up(authored)).toEqual(authored);
  });

  it("normalises the legacy reference key onto the canonical one", () => {
    expect(
      up([{ name: "old", type: "component", componentSlug: "hero" }])
    ).toEqual([{ name: "old", type: "fieldGroup", fieldGroup: "hero" }]);
  });

  // A node carrying both spellings keeps the canonical value: the legacy key
  // predates it, so the newer one was written deliberately.
  it("prefers the canonical value when a node carries both spellings", () => {
    expect(
      up([
        {
          name: "both",
          type: "component",
          component: "current",
          componentSlug: "stale",
        },
      ])
    ).toEqual([{ name: "both", type: "fieldGroup", fieldGroup: "current" }]);
  });

  it("descends into the container types that nest field definitions", () => {
    expect(
      up([
        {
          name: "rows",
          type: "repeater",
          fields: [{ name: "hero", type: "component", component: "hero" }],
        },
      ])
    ).toEqual([
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "hero", type: "fieldGroup", fieldGroup: "hero" }],
      },
    ]);
  });

  // 🔴 A plugin field type is open-ended and may carry its own `fields` option
  // as private configuration. Walking it would run these rules over data that is
  // not a field list, which is why only the container types are descended into.
  it("does not descend into a `fields` option on a non-container type", () => {
    const authored = [
      {
        name: "custom",
        type: "my-plugin-field",
        fields: [{ name: "x", type: "component", component: "hero" }],
      },
    ];
    expect(up(authored)).toEqual(authored);
  });

  it("keeps property order so a rename does not reshuffle stored JSON", () => {
    const [rewritten] = up([
      { name: "hero", type: "component", component: "hero", required: true },
    ]) as Record<string, unknown>[];
    expect(Object.keys(rewritten!)).toEqual([
      "name",
      "type",
      "fieldGroup",
      "required",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ name: "hero", type: "component", component: "hero" }];
    const snapshot = structuredClone(input);
    up(input);
    expect(input).toEqual(snapshot);
  });

  // Running the migration twice must not undo or double-apply it, because a
  // resume re-runs whatever step was in flight.
  it("is idempotent", () => {
    const once = up([{ name: "hero", type: "component", component: "hero" }]);
    expect(up(once)).toEqual(once);
  });

  // Direction is the argument order, so a rollback is the same function with
  // the vocabularies swapped rather than a second implementation.
  it("reverses when the vocabularies are swapped", () => {
    const migrated = up([
      { name: "blocks", type: "component", components: ["a"] },
    ]);
    expect(rewriteFieldDefinitions(migrated, MIGRATED, LEGACY)).toEqual([
      { name: "blocks", type: "component", components: ["a"] },
    ]);
  });

  it("passes through anything that is not a field list", () => {
    expect(up(null)).toBeNull();
    expect(up("text")).toBe("text");
    expect(up([null, 3, "x"])).toEqual([null, 3, "x"]);
  });
});

describe("rebuilding a definition without letting a key decide how", () => {
  // Same hazard as the content walk: a stored definition is parsed JSON, so an
  // own `__proto__` reaches this rebuild, and plain assignment would drop it.
  it("keeps an own __proto__ key on a field definition", () => {
    const stored: unknown = JSON.parse(
      '[{"name":"hero","type":"component","component":"hero","__proto__":{"tainted":true}}]'
    );
    const rewritten = rewriteFieldDefinitions(
      stored,
      LEGACY,
      MIGRATED
    ) as Record<string, unknown>[];
    const field = rewritten[0];
    if (field === undefined) throw new Error("fixture produced no field");

    expect(Object.prototype.hasOwnProperty.call(field, "__proto__")).toBe(true);
    // Built through JSON for the same reason: a literal's `__proto__` sets the
    // prototype instead of an own key.
    expect(JSON.parse(JSON.stringify(field))).toEqual(
      JSON.parse(
        '{"name":"hero","type":"fieldGroup","fieldGroup":"hero","__proto__":{"tainted":true}}'
      )
    );
    expect(Object.getPrototypeOf(field)).toBe(Object.prototype);
  });
});

describe("deciding a reference-key collision rather than letting key order", () => {
  // A node carrying both the source key and a property already named the target
  // one: without a rule, whichever came later in the stored JSON wins and the
  // other reference is dropped silently. Both orders are asserted, because a
  // single-order test passes whether or not the rule exists.
  it.each([
    [
      "source key first",
      '[{"type":"component","component":"a","fieldGroup":"b"}]',
    ],
    [
      "target key first",
      '[{"type":"component","fieldGroup":"b","component":"a"}]',
    ],
  ])("keeps the value already under the target key (%s)", (_label, stored) => {
    const rewritten = up(JSON.parse(stored)) as Record<string, unknown>[];
    expect(rewritten[0]).toEqual({ type: "fieldGroup", fieldGroup: "b" });
  });

  it.each([
    [
      "source key first",
      '[{"type":"component","components":["a"],"fieldGroups":["b"]}]',
    ],
    [
      "target key first",
      '[{"type":"component","fieldGroups":["b"],"components":["a"]}]',
    ],
  ])("does the same for the dynamic-zone list (%s)", (_label, stored) => {
    const rewritten = up(JSON.parse(stored)) as Record<string, unknown>[];
    expect(rewritten[0]).toEqual({ type: "fieldGroup", fieldGroups: ["b"] });
  });

  // Rewriting a key onto itself is not a collision. Treating it as one would
  // drop the value entirely, which is why the guard compares the keys first.
  it("does not drop a reference when the vocabulary does not rename the key", () => {
    const same: FieldGroupVocabulary = {
      fieldType: "component",
      refKeys: { single: "component", many: "components" },
    };
    expect(
      rewriteFieldDefinitions(
        [{ type: "component", component: "hero" }],
        same,
        same
      )
    ).toEqual([{ type: "component", component: "hero" }]);
  });
});
