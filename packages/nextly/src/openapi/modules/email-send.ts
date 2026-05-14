/**
 * Built-in module: `/api/email/*`.
 *
 * Mirrors the handlers under `packages/nextly/src/api/email-send*.ts`:
 *
 *   POST /api/email/send                 email-send.ts:POST
 *   POST /api/email/send-with-template   email-send-template.ts:POST
 *
 * Both endpoints share an `EmailSendResult` wire shape (`{ message,
 * success, messageId? }`) emitted via `respondAction`. The
 * send-with-template variant additionally echoes the resolved template
 * id so callers can correlate the queued message without storing the
 * original payload.
 *
 * Attachments are referenced by `mediaId` (the upload module's `Media`
 * id); the resolver throws caller-fixable failures as canonical
 * validation errors with the machine-readable `EMAIL_ATTACHMENT_*` codes.
 *
 * @module nextly/openapi/modules/email-send
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

import { STANDARD_ERROR_RESPONSES, STANDARD_SECURITY } from "./_shared";

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const EmailAttachmentInput: OpenAPISchema = {
  type: "object",
  required: ["mediaId"],
  properties: {
    mediaId: {
      type: "string",
      minLength: 1,
      description:
        "Id of an uploaded `Media` record (from the media module) to " +
        "attach. The resolver loads the bytes server-side.",
    },
    filename: {
      type: "string",
      minLength: 1,
      description:
        "Override the filename presented to the recipient. Defaults to " +
        "the media record's original filename.",
    },
  },
};

const SendEmailRequest: OpenAPISchema = {
  type: "object",
  required: ["to", "subject", "html"],
  properties: {
    to: { type: "string", format: "email" },
    subject: { type: "string", minLength: 1 },
    html: { type: "string", minLength: 1 },
    plainText: { type: "string" },
    cc: {
      type: "array",
      items: { type: "string", format: "email" },
    },
    bcc: {
      type: "array",
      items: { type: "string", format: "email" },
    },
    providerId: {
      type: "string",
      description:
        "Send through this specific provider. Defaults to the configured " +
        "default provider.",
    },
    attachments: {
      type: "array",
      items: { $ref: "#/components/schemas/EmailAttachmentInput" },
    },
  },
};

const SendEmailWithTemplateRequest: OpenAPISchema = {
  type: "object",
  required: ["to", "template"],
  properties: {
    to: { type: "string", format: "email" },
    template: {
      type: "string",
      minLength: 1,
      description: "Slug of an existing `EmailTemplate` record.",
    },
    variables: {
      type: "object",
      additionalProperties: true,
      description:
        "Interpolation values for the template's `{{...}}` placeholders. " +
        "Supports dot-notation for nested values.",
    },
    cc: { type: "array", items: { type: "string", format: "email" } },
    bcc: { type: "array", items: { type: "string", format: "email" } },
    providerId: { type: "string" },
    attachments: {
      type: "array",
      items: { $ref: "#/components/schemas/EmailAttachmentInput" },
    },
  },
};

const SendEmailResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "success"],
  properties: {
    message: { type: "string", example: "Email queued." },
    success: { type: "boolean" },
    messageId: {
      type: "string",
      description:
        "Provider-issued message id. Present when the provider returned " +
        "one synchronously.",
    },
  },
};

const SendEmailWithTemplateResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "success", "templateId"],
  properties: {
    message: { type: "string", example: "Email queued." },
    success: { type: "boolean" },
    messageId: { type: "string" },
    templateId: {
      type: "string",
      description:
        "Echo of the template slug the caller requested, so the response " +
        "is self-describing without storing the original payload.",
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const sendOp: OperationIR = {
  path: "/api/email/send",
  method: "POST",
  versions: ["1.0"],
  operationId: "email.send",
  tags: ["Email Send"],
  summary: "Send a raw email",
  description:
    "Dispatches the supplied subject / HTML through the named provider " +
    "(or the default when `providerId` is omitted). Attachments are " +
    "resolved by `mediaId`.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SendEmailRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Email queued.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SendEmailResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const sendWithTemplateOp: OperationIR = {
  path: "/api/email/send-with-template",
  method: "POST",
  versions: ["1.0"],
  operationId: "email.sendWithTemplate",
  tags: ["Email Send"],
  summary: "Send an email rendered from a template",
  description:
    "Looks up the template by slug, renders it with the supplied " +
    "`variables`, then dispatches the result through the named provider " +
    "(or the default).",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SendEmailWithTemplateRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Email queued.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/SendEmailWithTemplateResponse",
          },
        },
      },
    },
    "404": { $ref: "#/components/responses/NotFound" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const emailSendModule = defineModule({
  name: "email-send",
  tag: {
    name: "Email Send",
    description:
      "Dispatch raw or template-rendered emails through a configured provider.",
  },
  operations: [sendOp, sendWithTemplateOp],
  schemas: {
    EmailAttachmentInput,
    SendEmailRequest,
    SendEmailWithTemplateRequest,
    SendEmailResponse,
    SendEmailWithTemplateResponse,
  },
});
