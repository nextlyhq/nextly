import { describe, expect, it } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import { TypeGenerator } from "./type-generator";
import { ZodGenerator } from "./zod-generator";
import {
  fieldAdmitsNull,
  nullableTypeExpression,
  renderFieldMember,
} from "./field-nullability";

describe("fieldAdmitsNull", () => {
  it("says yes for a field that is not required", () => {
    // A non-required field becomes a nullable column, so a read hands back
    // NULL rather than omitting the key.
    expect(fieldAdmitsNull({})).toBe(true);
    expect(fieldAdmitsNull({ required: false })).toBe(true);
  });

  it("says no for a required field", () => {
    // Its column is NOT NULL, so offering null would send every consumer down
    // a branch that cannot happen.
    expect(fieldAdmitsNull({ required: true })).toBe(false);
  });
});

describe("nullableTypeExpression", () => {
  it("appends the union directly to an atomic type", () => {
    // Union binds looser than identifiers, generics and arrays, so brackets
    // here would be noise in a file a user reads.
    expect(nullableTypeExpression("string")).toBe("string | null");
    expect(nullableTypeExpression("Rating<5>")).toBe("Rating<5> | null");
    expect(nullableTypeExpression("string[]")).toBe("string[] | null");
  });

  it("leaves `unknown` alone, which already admits null", () => {
    expect(nullableTypeExpression("unknown")).toBe("unknown");
  });

  it("parenthesizes a conditional type, whose false branch would capture the union", () => {
    // `A extends B ? X : Y | null` parses as `A extends B ? X : (Y | null)`,
    // so the TRUE branch still rejects null while the column can return it.
    // Confirmed against the compiler: assigning null to the true branch of an
    // unparenthesized form is rejected with TS2322.
    expect(nullableTypeExpression("A extends B ? X : Y")).toBe(
      "(A extends B ? X : Y) | null"
    );
  });

  it("parenthesizes a function type, whose RETURN would otherwise take the union", () => {
    // `() => X | null` makes the return nullable and leaves the field itself
    // non-null, which is the opposite of what is meant.
    expect(nullableTypeExpression("() => X")).toBe("(() => X) | null");
  });
});

describe("renderFieldMember", () => {
  it("keeps `?` alongside `| null` for an optional field", () => {
    // Both, not one: `| null` describes what a READ returns, `?` is what keeps
    // the key omittable on create, and the input types are derived from this
    // interface by `Omit` rather than generated separately.
    expect(renderFieldMember("subtitle", "string", {})).toBe(
      "  subtitle?: string | null;"
    );
  });

  it("emits neither for a required field", () => {
    expect(renderFieldMember("title", "string", { required: true })).toBe(
      "  title: string;"
    );
  });
});

describe("the two generated artifacts agree about null", () => {
  // The regression this guards is what a shared `fieldAdmitsNull` exists to
  // prevent, and it is not caught by either generator's own suite: the type
  // said `subtitle?: string | null` while the validator generated from the
  // same field said `.optional()`, which admits undefined and REJECTS null. A
  // payload was then statically legal, accepted by the API, and refused by the
  // validator shipped beside it. Asserting the two OUTPUTS rather than that
  // both call the helper, since a call proves nothing about what was emitted.
  const collection = (fields: unknown[]) =>
    ({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields,
      timestamps: true,
    }) as unknown as DynamicCollectionRecord;

  it("both admit null for a non-required field", () => {
    const fields = [{ name: "subtitle", type: "text" }];

    expect(
      new TypeGenerator().generateTypesFile([collection(fields)]).code
    ).toContain("subtitle?: string | null;");
    expect(
      new ZodGenerator().generateSchema(collection(fields)).code
    ).toContain("subtitle: z.string().nullish(),");
  });

  it("neither admits null for a required field", () => {
    const fields = [{ name: "title", type: "text", required: true }];

    const ts = new TypeGenerator().generateTypesFile([collection(fields)]).code;
    const zod = new ZodGenerator().generateSchema(collection(fields)).code;

    expect(ts).toContain("title: string;");
    expect(ts).not.toContain("title?:");
    expect(zod).not.toContain("title: z.string().nullish()");
  });
});
