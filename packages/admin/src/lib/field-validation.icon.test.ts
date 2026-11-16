/**
 * An icon field holds an icon id. The form checks the id's shape with the
 * predicate the server uses, and lets an optional field stay empty.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "nextly/config";

import { generateClientSchema } from "./field-validation";

const iconField = (required: boolean): FieldConfig =>
  ({ name: "badge", type: "icon", label: "Badge", required }) as FieldConfig;

describe("generateClientSchema for an icon field", () => {
  it("accepts an icon id and refuses text of another shape", () => {
    const schema = generateClientSchema([iconField(false)]);
    expect(schema.safeParse({ badge: "lucide:star" }).success).toBe(true);
    // An id the set no longer draws still has the shape, and is kept.
    expect(schema.safeParse({ badge: "lucide:rocket-2" }).success).toBe(true);
    expect(schema.safeParse({ badge: "star" }).success).toBe(false);
    expect(schema.safeParse({ badge: "Lucide:Star" }).success).toBe(false);
  });

  it("lets an optional field stay empty, and a required one report it", () => {
    expect(
      generateClientSchema([iconField(false)]).safeParse({ badge: "" }).success
    ).toBe(true);
    const required = generateClientSchema([iconField(true)]).safeParse({
      badge: "",
    });
    expect(required.success).toBe(false);
    expect(required.error?.issues[0]?.message).toBe("This field is required");
  });
});
