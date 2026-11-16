/**
 * The apply/metadata endpoints and the ui-schema.json mirror must validate
 * field payloads with the same rules — a payload that applies to the DB
 * but fails the mirror write silently diverges the committed schema from
 * the database.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { assertValidFieldsPayload } from "../fields-payload";
import { parseUiSchema } from "../../schemas/_zod/ui-schema";

describe("assertValidFieldsPayload", () => {
  it("accepts an upload field without relationTo (runtime ignores it; builder never collects it)", () => {
    expect(() =>
      assertValidFieldsPayload([{ name: "hero", type: "upload" }])
    ).not.toThrow();
  });

  it("rejects a relationship field without relationTo, with a field path", () => {
    try {
      assertValidFieldsPayload([{ name: "author", type: "relationship" }]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      const err = error as NextlyError;
      expect(err.code).toBe("VALIDATION_ERROR");
      const errors = (err.publicData as { errors: Array<{ path: string }> })
        .errors;
      expect(errors.some(e => e.path.includes("relationTo"))).toBe(true);
    }
  });

  it("rejects select fields without options and reserved field names", () => {
    expect(() =>
      assertValidFieldsPayload([{ name: "choice", type: "select" }])
    ).toThrow(NextlyError);
    expect(() =>
      assertValidFieldsPayload([{ name: "id", type: "text" }])
    ).toThrow(NextlyError);
  });

  it("does not mutate or strip the payload (validation-only)", () => {
    const payload = [
      {
        name: "hero",
        type: "upload",
        // A builder-specific passthrough key the manifest schema does not
        // declare; validation must leave it in place for persistence.
        builderOnlyKey: "kept",
      },
    ];
    assertValidFieldsPayload(payload);
    expect(payload[0]).toHaveProperty("builderOnlyKey", "kept");
  });

  it("validates nested container fields recursively", () => {
    expect(() =>
      assertValidFieldsPayload([
        {
          name: "sections",
          type: "repeater",
          fields: [{ name: "link", type: "relationship" }],
        },
      ])
    ).toThrow(NextlyError);
  });

  it("accepts a component field referencing a component by slug (leaf ref, no fields[])", () => {
    // A component field points at a separately defined component schema and
    // carries no nested fields[]; the gate must not demand one.
    expect(() =>
      assertValidFieldsPayload([
        { name: "seo", type: "component", component: "seo" },
      ])
    ).not.toThrow();
    expect(() =>
      assertValidFieldsPayload([
        { name: "block", type: "component", components: ["hero", "cta"] },
      ])
    ).not.toThrow();
  });

  it("rejects a component field that names neither component nor components", () => {
    try {
      assertValidFieldsPayload([{ name: "seo", type: "component" }]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      const errors = (
        (error as NextlyError).publicData as {
          errors: Array<{ path: string }>;
        }
      ).errors;
      expect(errors.some(e => e.path.includes("component"))).toBe(true);
    }
  });

  it("rejects a component field that sets both component and components", () => {
    expect(() =>
      assertValidFieldsPayload([
        {
          name: "seo",
          type: "component",
          component: "seo",
          components: ["hero"],
        },
      ])
    ).toThrow(NextlyError);
  });

  it("rejects blank or malformed component slug references", () => {
    // A reference that is present but not a real slug points at no loadable
    // component; the gate must reject it rather than accept the empty shape.
    expect(() =>
      assertValidFieldsPayload([
        { name: "seo", type: "component", component: " " },
      ])
    ).toThrow(NextlyError);
    expect(() =>
      assertValidFieldsPayload([
        { name: "seo", type: "component", component: "Not A Slug" },
      ])
    ).toThrow(NextlyError);
    expect(() =>
      assertValidFieldsPayload([
        { name: "block", type: "component", components: [""] },
      ])
    ).toThrow(NextlyError);
    expect(() =>
      assertValidFieldsPayload([
        { name: "block", type: "component", components: [] },
      ])
    ).toThrow(NextlyError);
    expect(() =>
      assertValidFieldsPayload([
        { name: "block", type: "component", components: ["hero", " "] },
      ])
    ).toThrow(NextlyError);
  });

  // A payload alone cannot say whether two fields of one name are a pair the
  // entity already holds, which keeps working, or one this save creates; each
  // road asks the sibling rule with the stored fields beside the payload. The
  // manifest's entity validator leaves it to the same rule (parity kept).
  it("leaves two fields of one name to the sibling rule, as the manifest does", () => {
    const fields = [
      { name: "title", type: "text" },
      { name: "title", type: "textarea" },
    ];
    expect(() => assertValidFieldsPayload(fields)).not.toThrow();
    expect(
      parseUiSchema({ collections: [{ slug: "x", fields }] }).success
    ).toBe(true);
  });
});

// A plugin or the API may have given an entity a camelCase field, and the
// admin sends every field on each save, so such a name keeps working where the
// entity already holds it. A name the Builder would create is still its own.
describe("the Builder's field names, against the fields as stored", () => {
  const stored = [
    { name: "firstName", type: "text" },
    {
      name: "seo",
      type: "group",
      fields: [{ name: "metaTitle", type: "text" }],
    },
  ];
  const nameRefusal = (name: string, path: string) => ({
    code: "VALIDATION_ERROR",
    publicData: {
      errors: [expect.objectContaining({ path, code: "INVALID_FIELD_NAME" })],
    },
    message: expect.any(String),
  });
  const refusedFor = (fields: unknown, opts = {}) => {
    try {
      assertValidFieldsPayload(fields, opts);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it("keeps a camelCase name the entity already holds, at any depth", () => {
    expect(() =>
      assertValidFieldsPayload(stored, { kind: "collection", stored })
    ).not.toThrow();
  });

  it("refuses a camelCase name the entity does not hold yet", () => {
    const fields = [...stored, { name: "lastName", type: "text" }];
    expect(refusedFor(fields, { kind: "collection", stored })).toMatchObject(
      nameRefusal("lastName", "2.name")
    );
  });

  it("holds a stored name only where it is stored", () => {
    // `metaTitle` is held inside `seo`, not at the top level, and `firstName`
    // at the top level, not inside `seo`.
    expect(
      refusedFor([{ name: "metaTitle", type: "text" }], { stored })
    ).toMatchObject(nameRefusal("metaTitle", "0.name"));
    expect(
      refusedFor(
        [
          {
            name: "seo",
            type: "group",
            fields: [{ name: "firstName", type: "text" }],
          },
        ],
        { stored }
      )
    ).toMatchObject(nameRefusal("firstName", "0.fields.0.name"));
  });

  it("refuses every camelCase name when nothing is stored, as for a new entity", () => {
    expect(refusedFor(stored)).toMatchObject(
      nameRefusal("firstName", "0.name")
    );
  });
});
