/**
 * A multi-target relationship validates in both the shapes it is served in.
 *
 * The value is stored as `{ relationTo, value }`, where `value` is the target's
 * id — or the target row itself once the entry was read at a depth that
 * populates relationships, which the edit page asks for. The form validates its
 * own defaults on every submit, so a schema that accepts only the id rejects a
 * save that touched nothing but some unrelated field.
 */

import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { generateClientSchema } from "./field-validation";

const polymorphicField = (hasMany: boolean): FieldConfig =>
  ({
    type: "relationship",
    name: "target",
    relationTo: ["posts", "pages"],
    ...(hasMany ? { hasMany: true } : {}),
  }) as unknown as FieldConfig;

const POPULATED_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "A page",
  slug: "a-page",
};

describe("generateClientSchema — multi-target relationships", () => {
  it("accepts a reference that carries the id", () => {
    const schema = generateClientSchema([polymorphicField(false)]);

    const result = schema.safeParse({
      target: { relationTo: "pages", value: POPULATED_ROW.id },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a reference whose target was populated", () => {
    const schema = generateClientSchema([polymorphicField(false)]);

    const result = schema.safeParse({
      target: { relationTo: "pages", value: POPULATED_ROW },
    });

    expect(result.success).toBe(true);
  });

  it("accepts populated entries in a list of references", () => {
    const schema = generateClientSchema([polymorphicField(true)]);

    const result = schema.safeParse({
      target: [
        { relationTo: "pages", value: POPULATED_ROW },
        { relationTo: "posts", value: "22222222-2222-4222-8222-222222222222" },
      ],
    });

    expect(result.success).toBe(true);
  });

  // The mirror: widening the shape must not turn the field into "anything
  // goes", or the schema stops catching a value that could never be stored.
  it("still rejects a reference whose target is neither an id nor a row", () => {
    const schema = generateClientSchema([polymorphicField(false)]);

    const result = schema.safeParse({
      target: { relationTo: "pages", value: { title: "no id here" } },
    });

    expect(result.success).toBe(false);
  });
});
