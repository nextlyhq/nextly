import { describe, expect, it } from "vitest";

import { emailProvidersModule } from "./email-providers";

describe("emailProvidersModule", () => {
  it("is named 'email-providers'", () => {
    expect(emailProvidersModule.name).toBe("email-providers");
  });

  it("declares all 7 email-provider operations", () => {
    const summary = emailProvidersModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/email-providers/{id}",
      "GET /api/email-providers",
      "GET /api/email-providers/{id}",
      "PATCH /api/email-providers/{id}",
      "PATCH /api/email-providers/{id}/default",
      "POST /api/email-providers",
      "POST /api/email-providers/{id}/test",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of emailProvidersModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("GET /api/email-providers returns the non-paginated ListEmailProvidersResponse", () => {
    const op = emailProvidersModule.operations.find(
      o => o.method === "GET" && o.path === "/api/email-providers"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/ListEmailProvidersResponse",
    });
  });

  it("POST /api/email-providers requires CreateEmailProviderRequest and returns 201 MutationResponseEmailProvider", () => {
    const op = emailProvidersModule.operations.find(
      o => o.method === "POST" && o.path === "/api/email-providers"
    )!;
    expect(op.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/CreateEmailProviderRequest",
    });
    const schema = (
      op.responses["201"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/MutationResponseEmailProvider",
    });
  });

  it("PATCH /api/email-providers/{id}/default returns SetDefaultProviderResponse", () => {
    const op = emailProvidersModule.operations.find(
      o => o.path === "/api/email-providers/{id}/default"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/SetDefaultProviderResponse",
    });
  });

  it("POST /api/email-providers/{id}/test accepts an optional body and returns TestEmailProviderResponse", () => {
    const op = emailProvidersModule.operations.find(
      o => o.path === "/api/email-providers/{id}/test"
    )!;
    expect(op.requestBody?.required).toBe(false);
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/TestEmailProviderResponse",
    });
  });

  describe("registered schemas", () => {
    const schemas = emailProvidersModule.schemas ?? {};

    it("registers every schema referenced by the operations", () => {
      const names = Object.keys(schemas).sort();
      expect(names).toEqual([
        "CreateEmailProviderRequest",
        "DeleteEmailProviderResponse",
        "EmailProvider",
        "ListEmailProvidersResponse",
        "MutationResponseEmailProvider",
        "SetDefaultProviderResponse",
        "TestEmailProviderRequest",
        "TestEmailProviderResponse",
        "UpdateEmailProviderRequest",
      ]);
    });

    it("EmailProvider.type is a closed enum of supported transports", () => {
      const schema = schemas.EmailProvider as {
        properties?: Record<string, { enum?: string[] }>;
      };
      expect(schema.properties?.type?.enum).toEqual([
        "smtp",
        "resend",
        "sendlayer",
      ]);
    });

    it("EmailProvider.configuration accepts arbitrary keys and documents masking", () => {
      const schema = schemas.EmailProvider as {
        properties?: Record<
          string,
          { additionalProperties?: unknown; description?: string }
        >;
      };
      expect(schema.properties?.configuration?.additionalProperties).toBe(true);
      expect(schema.properties?.configuration?.description).toMatch(/mask/i);
    });

    it("CreateEmailProviderRequest requires name + type + fromEmail + configuration", () => {
      const schema = schemas.CreateEmailProviderRequest as {
        required?: string[];
      };
      expect(schema.required).toEqual([
        "name",
        "type",
        "fromEmail",
        "configuration",
      ]);
    });
  });
});
