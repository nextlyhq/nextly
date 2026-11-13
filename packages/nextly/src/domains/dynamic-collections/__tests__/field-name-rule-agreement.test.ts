/**
 * The Schema Builder's panel and its save judge a field's name by one rule.
 *
 * The panel asks `fieldNameProblem` as a name is typed; the save refuses a payload through
 * `assertValidFieldsPayload`, which parses it against the field-payload schema and then asks the
 * same rule of every name new at its place. Each case gives one list of names to both, for every
 * surface (collection, Single, field group), at the top level and inside a group, with the
 * Draft/Published lifecycle on and off, and expects the same answer from each: the panel never
 * accepts a name the save then refuses, nor refuses one the save takes.
 *
 * The list holds names the save takes that an older admin list refused (`status` with drafts off,
 * `order`), system columns' names in both spellings, a collection's owner column, the lifecycle's
 * own names, malformed spellings, and columns either side of the longest a database keeps whole.
 *
 * The collection create road's own check (`fieldNameSchema`) asks the same rule with the camelCase
 * it accepts, and adds a length cap, a wider reserved list and SQL keywords of its own; every name
 * spelled the Builder's way that the panel refuses at a collection's top level is refused there too.
 */
import { describe, expect, it } from "vitest";

import { assertValidFieldsPayload } from "../../../api/fields-payload";
import { fieldNameProblem, type FieldNameSurface } from "../field-name-rule";
import { fieldNameSchema } from "../services/dynamic-collection-validation-service";

const NAMES = [
  // Ordinary names, and names the save takes that an earlier admin list refused.
  "body",
  "meta_title",
  "order",
  "group",
  "title",
  "slug",
  "status",
  // System columns, in both spellings.
  "id",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  // A collection's owner column, in both spellings.
  "created_by",
  "createdBy",
  // The lifecycle's own names, in both spellings.
  "first_published_at",
  "firstPublishedAt",
  // Spellings the Builder never gives a name.
  "Body",
  "fooBar",
  "1st",
  "_draft",
  "foo-bar",
  // Columns exactly as long as every database keeps, and one longer.
  "a".repeat(63),
  "a".repeat(64),
];

const KIND: Record<FieldNameSurface, "collection" | "single" | "component"> = {
  collection: "collection",
  single: "single",
  fieldGroup: "component",
};

/** Whether the save refuses a new field named `name` at the place described. */
function saveRefuses(
  name: string,
  surface: FieldNameSurface,
  nested: boolean,
  lifecycleEnabled: boolean
): boolean {
  const field = { name, type: "text" };
  const fields = nested
    ? [{ name: "box", type: "group", fields: [field] }]
    : [field];
  try {
    assertValidFieldsPayload(fields, {
      kind: KIND[surface],
      stored: [],
      lifecycleEnabled,
    });
    return false;
  } catch {
    return true;
  }
}

describe("the panel's check and the save's rule", () => {
  const places = (["collection", "single", "fieldGroup"] as const).flatMap(
    surface =>
      [false, true].flatMap(nested =>
        (surface === "fieldGroup" ? [false] : [false, true]).map(
          lifecycleEnabled => ({ surface, nested, lifecycleEnabled })
        )
      )
  );

  for (const { surface, nested, lifecycleEnabled } of places) {
    it(`agree on one list of names, reserved names in both spellings among them — ${surface}, ${nested ? "inside a group" : "top level"}, drafts ${lifecycleEnabled ? "on" : "off"}`, () => {
      const panel = NAMES.map(name => ({
        name,
        refused:
          fieldNameProblem(name, { surface, nested, lifecycleEnabled }) !==
          null,
      }));
      const save = NAMES.map(name => ({
        name,
        refused: saveRefuses(name, surface, nested, lifecycleEnabled),
      }));
      expect(panel).toEqual(save);
      // The list reaches both answers on every place, so agreement is not two empty sets.
      expect(panel.some(entry => entry.refused)).toBe(true);
      expect(panel.some(entry => !entry.refused)).toBe(true);
    });
  }

  it("refuse the lifecycle's names at the top level only while drafts are on", () => {
    for (const surface of ["collection", "single"] as const) {
      for (const name of ["status", "first_published_at"]) {
        expect(
          fieldNameProblem(name, {
            surface,
            nested: false,
            lifecycleEnabled: true,
          })
        ).toMatchObject({ kind: "lifecycle", code: "RESERVED" });
        expect(
          fieldNameProblem(name, {
            surface,
            nested: false,
            lifecycleEnabled: false,
          })
        ).toBeNull();
        expect(
          fieldNameProblem(name, {
            surface,
            nested: true,
            lifecycleEnabled: true,
          })
        ).toBeNull();
      }
    }
  });

  it("refuse a collection's owner column on a collection only", () => {
    expect(
      fieldNameProblem("created_by", { surface: "collection", nested: false })
    ).toMatchObject({ kind: "reserved" });
    expect(
      fieldNameProblem("created_by", { surface: "single", nested: false })
    ).toBeNull();
    expect(
      fieldNameProblem("created_by", { surface: "fieldGroup", nested: false })
    ).toBeNull();
  });
});

describe("the collection create road's own check", () => {
  it("refuses every Builder-spelled name the panel refuses at a collection's top level", () => {
    const builderSpelled = NAMES.filter(name => /^[a-z][a-z0-9_]*$/.test(name));
    for (const name of builderSpelled) {
      const panelRefuses =
        fieldNameProblem(name, { surface: "collection", nested: false }) !==
        null;
      if (panelRefuses) {
        expect(fieldNameSchema.safeParse(name).success, name).toBe(false);
      }
    }
  });

  // Its own extras stay its own: the Builder's field save takes these.
  it("keeps its SQL keywords and wider reserved list to itself", () => {
    for (const name of ["order", "group", "title"]) {
      expect(fieldNameSchema.safeParse(name).success, name).toBe(false);
      expect(
        fieldNameProblem(name, { surface: "collection", nested: false })
      ).toBeNull();
    }
  });
});

describe("a name the entity already holds", () => {
  // A `status` field saved while drafts were off still saves its other edits once they are on;
  // only a new or renamed field is refused the name.
  it("keeps working where it is stored, while a new or renamed one is refused", () => {
    const stored = [
      { name: "body", type: "text" },
      { name: "status", type: "text" },
    ];
    const opts = {
      kind: "collection" as const,
      stored,
      lifecycleEnabled: true,
    };

    expect(() =>
      assertValidFieldsPayload(
        [...stored, { name: "summary", type: "text" }],
        opts
      )
    ).not.toThrow();
    // `body` renamed to `status`: a name new at its place, refused naming the field.
    let refusal: unknown;
    try {
      assertValidFieldsPayload(
        [
          { name: "status", type: "text" },
          { name: "state", type: "text" },
        ],
        { ...opts, stored: [{ name: "body", type: "text" }] }
      );
    } catch (error) {
      refusal = error;
    }
    expect(
      (refusal as { publicData?: { errors?: unknown[] } } | undefined)
        ?.publicData?.errors
    ).toEqual([
      expect.objectContaining({
        path: "0.name",
        code: "RESERVED",
        message: expect.stringContaining(
          "Field name 'status' is owned by the Draft/Published lifecycle"
        ),
      }),
    ]);
  });
});
