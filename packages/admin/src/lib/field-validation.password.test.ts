/**
 * Password fields are write-only server-side: stored hashes never
 * round-trip, so edit forms seed them blank and blank must mean "keep the
 * current password" rather than a validation failure.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "nextly/config";

import { generateClientSchema } from "./field-validation";

const passwordField = {
  name: "secret",
  type: "password",
  label: "Secret",
  required: true,
  minLength: 8,
} as unknown as FieldConfig;

describe("generateClientSchema password mode handling", () => {
  it("requires a password on create", () => {
    const schema = generateClientSchema([passwordField], { mode: "create" });
    expect(schema.safeParse({ secret: "" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ secret: "longenough" }).success).toBe(true);
  });

  it("accepts blank on edit (keep current) but still validates typed values", () => {
    const schema = generateClientSchema([passwordField], { mode: "edit" });
    expect(schema.safeParse({ secret: "" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    // A typed value must still meet the strength rules.
    expect(schema.safeParse({ secret: "short" }).success).toBe(false);
    expect(schema.safeParse({ secret: "longenough" }).success).toBe(true);
  });

  it("defaults to create semantics when mode is omitted", () => {
    const schema = generateClientSchema([passwordField]);
    expect(schema.safeParse({ secret: "" }).success).toBe(false);
  });
});
