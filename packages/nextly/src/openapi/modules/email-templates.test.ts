import { describe, expect, it } from "vitest";

import { emailTemplatesModule } from "./email-templates";

describe("emailTemplatesModule", () => {
  it("is named 'email-templates'", () => {
    expect(emailTemplatesModule.name).toBe("email-templates");
  });

  it("declares all 8 email-template operations", () => {
    const summary = emailTemplatesModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/email-templates/{id}",
      "GET /api/email-templates",
      "GET /api/email-templates/layout",
      "GET /api/email-templates/{id}",
      "PATCH /api/email-templates/layout",
      "PATCH /api/email-templates/{id}",
      "POST /api/email-templates",
      "POST /api/email-templates/{id}/preview",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of emailTemplatesModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("GET /api/email-templates returns ListEmailTemplatesResponse", () => {
    const op = emailTemplatesModule.operations.find(
      o => o.method === "GET" && o.path === "/api/email-templates"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/ListEmailTemplatesResponse",
    });
  });

  it("POST /api/email-templates requires CreateEmailTemplateRequest and returns 201", () => {
    const op = emailTemplatesModule.operations.find(
      o => o.method === "POST" && o.path === "/api/email-templates"
    )!;
    expect(op.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/CreateEmailTemplateRequest",
    });
    expect(op.responses["201"]).toBeDefined();
  });

  it("GET /api/email-templates/layout returns EmailLayout", () => {
    const op = emailTemplatesModule.operations.find(
      o => o.method === "GET" && o.path === "/api/email-templates/layout"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/EmailLayout",
    });
  });

  it("PATCH /api/email-templates/layout returns UpdateEmailLayoutResponse", () => {
    const op = emailTemplatesModule.operations.find(
      o => o.method === "PATCH" && o.path === "/api/email-templates/layout"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/UpdateEmailLayoutResponse",
    });
  });

  it("POST /api/email-templates/{id}/preview returns PreviewEmailTemplateResponse", () => {
    const op = emailTemplatesModule.operations.find(
      o => o.path === "/api/email-templates/{id}/preview"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/PreviewEmailTemplateResponse",
    });
  });

  describe("registered schemas", () => {
    const schemas = emailTemplatesModule.schemas ?? {};

    it("registers every schema referenced by the operations", () => {
      const names = Object.keys(schemas).sort();
      expect(names).toEqual([
        "CreateEmailTemplateRequest",
        "DeleteEmailTemplateResponse",
        "EmailLayout",
        "EmailTemplate",
        "ListEmailTemplatesResponse",
        "MutationResponseEmailTemplate",
        "PreviewEmailTemplateRequest",
        "PreviewEmailTemplateResponse",
        "TemplateVariable",
        "UpdateEmailLayoutRequest",
        "UpdateEmailLayoutResponse",
        "UpdateEmailTemplateRequest",
      ]);
    });

    it("EmailTemplate.slug pins the kebab-case pattern", () => {
      const schema = schemas.EmailTemplate as {
        properties?: Record<string, { pattern?: string }>;
      };
      expect(schema.properties?.slug?.pattern).toBe(
        "^[a-z0-9]+(?:-[a-z0-9]+)*$"
      );
    });

    it("EmailLayout requires both header and footer fields", () => {
      const schema = schemas.EmailLayout as { required?: string[] };
      expect(schema.required).toEqual(["header", "footer"]);
    });

    it("PreviewEmailTemplateRequest.data is an open object", () => {
      const schema = schemas.PreviewEmailTemplateRequest as {
        properties?: Record<
          string,
          { type?: string; additionalProperties?: unknown }
        >;
      };
      expect(schema.properties?.data?.type).toBe("object");
      expect(schema.properties?.data?.additionalProperties).toBe(true);
    });

    it("PreviewEmailTemplateResponse carries subject + html", () => {
      const schema = schemas.PreviewEmailTemplateResponse as {
        required?: string[];
      };
      expect(schema.required).toEqual(["subject", "html"]);
    });
  });
});
