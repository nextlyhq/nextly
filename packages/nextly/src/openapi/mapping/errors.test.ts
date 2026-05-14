import { describe, expect, it } from "vitest";

import { NEXTLY_ERROR_STATUS } from "../../errors/error-codes";

import { buildErrorComponents } from "./errors";

describe("buildErrorComponents", () => {
  const { schemas, responses } = buildErrorComponents();

  describe("Error schema", () => {
    it("requires an `error` object with code + message", () => {
      expect(schemas.Error).toMatchObject({
        type: "object",
        required: ["error"],
      });
      const errorProp = (
        schemas.Error as { properties?: { error?: Record<string, unknown> } }
      ).properties?.error;
      expect(errorProp).toMatchObject({
        type: "object",
        required: ["code", "message"],
      });
    });

    it("code enum is exactly the keys of NEXTLY_ERROR_STATUS (in sync with runtime)", () => {
      const expected = Object.keys(NEXTLY_ERROR_STATUS).sort();
      const codeEnum =
        (
          schemas.Error as {
            properties?: {
              error?: {
                properties?: { code?: { enum?: string[] } };
              };
            };
          }
        ).properties?.error?.properties?.code?.enum
          ?.slice()
          .sort() ?? [];
      expect(codeEnum).toEqual(expected);
    });

    it("includes optional messageKey / requestId / data fields", () => {
      const errorProps = (
        schemas.Error as {
          properties?: {
            error?: { properties?: Record<string, unknown> };
          };
        }
      ).properties?.error?.properties;
      expect(errorProps).toHaveProperty("messageKey");
      expect(errorProps).toHaveProperty("requestId");
      expect(errorProps).toHaveProperty("data");
    });
  });

  describe("named responses", () => {
    const expectedNames = [
      "ValidationError",
      "Unauthorized",
      "Forbidden",
      "NotFound",
      "PayloadTooLarge",
      "UnsupportedMediaType",
      "Conflict",
      "RateLimited",
      "InternalServerError",
      "ServiceUnavailable",
    ];

    it("emits one named response per common error category", () => {
      for (const name of expectedNames) {
        expect(responses[name], `missing response: ${name}`).toBeDefined();
      }
    });

    it("every named response points at the Error schema", () => {
      for (const [name, response] of Object.entries(responses)) {
        const schema = response.content?.["application/json"]?.schema;
        expect(schema, `${name} has no application/json schema`).toEqual({
          $ref: "#/components/schemas/Error",
        });
      }
    });

    it("every named response has a non-empty description", () => {
      for (const [name, response] of Object.entries(responses)) {
        expect(
          response.description,
          `${name} has empty description`
        ).toBeTruthy();
      }
    });
  });
});
