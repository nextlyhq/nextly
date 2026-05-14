import { describe, expect, it } from "vitest";

import { emailSendModule } from "./email-send";

describe("emailSendModule", () => {
  it("is named 'email-send'", () => {
    expect(emailSendModule.name).toBe("email-send");
  });

  it("declares 2 send operations", () => {
    const summary = emailSendModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "POST /api/email/send",
      "POST /api/email/send-with-template",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of emailSendModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  describe("POST /api/email/send", () => {
    const op = emailSendModule.operations.find(
      o => o.path === "/api/email/send"
    )!;

    it("requires SendEmailRequest", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/SendEmailRequest",
      });
    });

    it("200 returns SendEmailResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/SendEmailResponse",
      });
    });
  });

  describe("POST /api/email/send-with-template", () => {
    const op = emailSendModule.operations.find(
      o => o.path === "/api/email/send-with-template"
    )!;

    it("requires SendEmailWithTemplateRequest", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/SendEmailWithTemplateRequest",
      });
    });

    it("200 returns SendEmailWithTemplateResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/SendEmailWithTemplateResponse",
      });
    });

    it("declares a 404 for unknown template slugs", () => {
      expect(op.responses["404"]).toEqual({
        $ref: "#/components/responses/NotFound",
      });
    });
  });

  describe("registered schemas", () => {
    const schemas = emailSendModule.schemas ?? {};

    it("registers every schema referenced by the operations", () => {
      const names = Object.keys(schemas).sort();
      expect(names).toEqual([
        "EmailAttachmentInput",
        "SendEmailRequest",
        "SendEmailResponse",
        "SendEmailWithTemplateRequest",
        "SendEmailWithTemplateResponse",
      ]);
    });

    it("SendEmailRequest requires to + subject + html", () => {
      const schema = schemas.SendEmailRequest as { required?: string[] };
      expect(schema.required).toEqual(["to", "subject", "html"]);
    });

    it("SendEmailWithTemplateRequest requires to + template (variables optional)", () => {
      const schema = schemas.SendEmailWithTemplateRequest as {
        required?: string[];
      };
      expect(schema.required).toEqual(["to", "template"]);
    });

    it("SendEmailWithTemplateResponse always echoes templateId", () => {
      const schema = schemas.SendEmailWithTemplateResponse as {
        required?: string[];
      };
      expect(schema.required).toEqual(["message", "success", "templateId"]);
    });

    it("EmailAttachmentInput requires mediaId; filename is optional", () => {
      const schema = schemas.EmailAttachmentInput as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual(["mediaId"]);
      expect(schema.properties?.filename).toBeDefined();
    });
  });
});
