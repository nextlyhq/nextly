/**
 * The apply/metadata endpoints and the ui-schema.json mirror must validate
 * field payloads with the same rules — a payload that applies to the DB
 * but fails the mirror write silently diverges the committed schema from
 * the database.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { assertValidFieldsPayload } from "../fields-payload";

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
});
