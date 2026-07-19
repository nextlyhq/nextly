import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../users/config/types";

import {
  buildCreateUserSchema,
  buildUpdateUserSchema,
  buildUserFieldsSchema,
} from "../user-fields";

// UserFieldConfig is a broad discriminated union; the value-mapping under test
// keys off `type` and reads bounds/options structurally, so a single typed
// helper keeps the fixtures readable without repeating the cast per field.
type FieldFixture = {
  name: string;
  type: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  hasMany?: boolean;
  options?: { label: string; value: string }[];
};

function userField(cfg: FieldFixture): UserFieldConfig {
  return cfg as unknown as UserFieldConfig;
}

// buildUserFieldsSchema turns each field config into the zod schema that guards
// a user's value for that field, so these cases pin the per-type value rules
// (fieldConfigToZod) that the write path relies on.
describe("buildUserFieldsSchema value validation", () => {
  it("validates a url field and enforces its length bounds", () => {
    const schema = buildUserFieldsSchema([
      userField({ name: "site", type: "url", required: true, maxLength: 20 }),
    ]);
    expect(schema.safeParse({ site: "https://nextly.dev" }).success).toBe(true);
    expect(schema.safeParse({ site: "not-a-url" }).success).toBe(false);
    // A valid URL that exceeds maxLength is still rejected.
    expect(
      schema.safeParse({ site: "https://example.com/very/long/path" }).success
    ).toBe(false);
  });

  it("accepts a well-formed phone and rejects separator-only or out-of-range values", () => {
    const schema = buildUserFieldsSchema([
      userField({ name: "tel", type: "phone", required: true }),
    ]);
    expect(schema.safeParse({ tel: "+1 (312) 847-1928" }).success).toBe(true);
    // The digit lookahead rejects a separators-only string.
    expect(schema.safeParse({ tel: "---" }).success).toBe(false);
    // Default bounds are 3..32 characters.
    expect(schema.safeParse({ tel: "12" }).success).toBe(false);
    expect(schema.safeParse({ tel: "1".repeat(40) }).success).toBe(false);
  });

  it("enforces text minLength and maxLength", () => {
    // A text field's declared length bounds become zod min/max on the string.
    const schema = buildUserFieldsSchema([
      userField({
        name: "bio",
        type: "text",
        required: true,
        minLength: 2,
        maxLength: 5,
      }),
    ]);
    expect(schema.safeParse({ bio: "hey" }).success).toBe(true);
    expect(schema.safeParse({ bio: "a" }).success).toBe(false);
    expect(schema.safeParse({ bio: "toolong" }).success).toBe(false);
  });

  it("enforces number min and max", () => {
    // A number field's min/max bound the numeric value, not its length.
    const schema = buildUserFieldsSchema([
      userField({
        name: "age",
        type: "number",
        required: true,
        min: 18,
        max: 65,
      }),
    ]);
    expect(schema.safeParse({ age: 30 }).success).toBe(true);
    expect(schema.safeParse({ age: 10 }).success).toBe(false);
    expect(schema.safeParse({ age: 99 }).success).toBe(false);
  });

  it("validates an email field", () => {
    // An email field must parse as an email address, not just any string.
    const schema = buildUserFieldsSchema([
      userField({ name: "work", type: "email", required: true }),
    ]);
    expect(schema.safeParse({ work: "a@b.com" }).success).toBe(true);
    expect(schema.safeParse({ work: "nope" }).success).toBe(false);
  });

  it("restricts a single select to its option values", () => {
    const schema = buildUserFieldsSchema([
      userField({
        name: "dept",
        type: "select",
        required: true,
        options: [
          { label: "Eng", value: "eng" },
          { label: "Sales", value: "sales" },
        ],
      }),
    ]);
    expect(schema.safeParse({ dept: "eng" }).success).toBe(true);
    expect(schema.safeParse({ dept: "marketing" }).success).toBe(false);
    // A single select is a scalar, not an array.
    expect(schema.safeParse({ dept: ["eng"] }).success).toBe(false);
  });

  it("accepts an array of option values for a hasMany select and rejects a bare value", () => {
    // hasMany wraps the option enum in an array, so a scalar value is rejected.
    const schema = buildUserFieldsSchema([
      userField({
        name: "tags",
        type: "select",
        required: true,
        hasMany: true,
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      }),
    ]);
    expect(schema.safeParse({ tags: ["a", "b"] }).success).toBe(true);
    expect(schema.safeParse({ tags: ["a", "c"] }).success).toBe(false);
    expect(schema.safeParse({ tags: "a" }).success).toBe(false);
  });

  it("enforces required on a plugin field type whose value shape is unknown", () => {
    // The default branch accepts any value but still rejects a missing/empty
    // one for a required plugin field (z.unknown() alone would let it through).
    const schema = buildUserFieldsSchema([
      userField({ name: "rating", type: "stars", required: true }),
    ]);
    expect(schema.safeParse({ rating: 4 }).success).toBe(true);
    expect(schema.safeParse({ rating: "" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("treats a non-required field as nullable and optional", () => {
    // An optional field wraps its schema in nullable().optional(), so a missing
    // key, an explicit null, and a value are all accepted.
    const schema = buildUserFieldsSchema([
      userField({ name: "note", type: "text" }),
    ]);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ note: null }).success).toBe(true);
    expect(schema.safeParse({ note: "hi" }).success).toBe(true);
  });
});

// The create and update schemas merge the same custom fields onto the core user
// schema but treat `required` differently, so these pin that difference.
describe("buildCreateUserSchema vs buildUpdateUserSchema", () => {
  // A required custom field, reused across both create and update expectations.
  const requiredCustom = userField({
    name: "company",
    type: "text",
    required: true,
  });

  it("enforces a required custom field on create", () => {
    const schema = buildCreateUserSchema([requiredCustom]);
    expect(
      schema.safeParse({ email: "a@b.com", name: "A", company: "Acme" }).success
    ).toBe(true);
    // Missing the required custom field fails create validation.
    expect(schema.safeParse({ email: "a@b.com", name: "A" }).success).toBe(
      false
    );
  });

  it("makes the same required custom field optional on update (partial saves)", () => {
    // Updates are partial, so even a required custom field may be omitted.
    const schema = buildUpdateUserSchema([requiredCustom]);
    expect(schema.safeParse({}).success).toBe(true);
  });
});
