/**
 * Built-in module: `/api/email-templates/*`.
 *
 * Mirrors the handlers under `packages/nextly/src/api/email-templates*.ts`:
 *
 *   GET    /api/email-templates                  email-templates.ts:GET
 *   POST   /api/email-templates                  email-templates.ts:POST
 *   GET    /api/email-templates/layout           email-templates-layout.ts:GET
 *   PATCH  /api/email-templates/layout           email-templates-layout.ts:PATCH
 *   GET    /api/email-templates/{id}             email-templates-detail.ts:GET
 *   PATCH  /api/email-templates/{id}             email-templates-detail.ts:PATCH
 *   DELETE /api/email-templates/{id}             email-templates-detail.ts:DELETE
 *   POST   /api/email-templates/{id}/preview     email-templates-preview.ts:POST
 *
 * Layout is two reserved rows (`_email-header` / `_email-footer`) wrapping
 * every template's body when the template has `useLayout: true`. The list
 * endpoint excludes those rows by convention; the dedicated layout
 * endpoints expose them as a single `{ header, footer }` pair.
 *
 * The preview endpoint renders a template with caller-supplied
 * interpolation data, returning `{ subject, html }` for sandboxed admin
 * preview (never raw HTML in the response body).
 *
 * @module nextly/openapi/modules/email-templates
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

import {
  NOT_FOUND_RESPONSE,
  STANDARD_ERROR_RESPONSES,
  STANDARD_SECURITY,
} from "./_shared";

const PATH_ID = {
  name: "id",
  in: "path" as const,
  required: true,
  description: "Email template id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const TemplateVariable: OpenAPISchema = {
  type: "object",
  required: ["name", "description"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    required: { type: "boolean" },
  },
  description:
    "Declared interpolation variable. `name` is the placeholder key " +
    "(e.g. `user.name`); `description` is shown in the admin form.",
};

const EmailTemplate: OpenAPISchema = {
  type: "object",
  required: [
    "id",
    "name",
    "slug",
    "subject",
    "htmlContent",
    "useLayout",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: {
      type: "string",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      description:
        "Lowercase alphanumeric slug with hyphens. Reserved values " +
        "`_email-header` / `_email-footer` are managed via the layout " +
        "endpoint and excluded from the list response.",
    },
    subject: { type: "string", maxLength: 500 },
    htmlContent: { type: "string" },
    plainTextContent: { type: ["string", "null"] },
    variables: {
      type: ["array", "null"],
      items: { $ref: "#/components/schemas/TemplateVariable" },
    },
    useLayout: { type: "boolean" },
    isActive: { type: "boolean" },
    providerId: { type: ["string", "null"], format: "uuid" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const CreateEmailTemplateRequest: OpenAPISchema = {
  type: "object",
  required: ["name", "slug", "subject", "htmlContent"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 255 },
    slug: {
      type: "string",
      minLength: 1,
      maxLength: 255,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    subject: { type: "string", minLength: 1, maxLength: 500 },
    htmlContent: { type: "string", minLength: 1 },
    plainTextContent: { type: ["string", "null"] },
    variables: {
      type: ["array", "null"],
      items: { $ref: "#/components/schemas/TemplateVariable" },
    },
    useLayout: { type: "boolean" },
    isActive: { type: "boolean" },
    providerId: { type: ["string", "null"], format: "uuid" },
  },
};

const UpdateEmailTemplateRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    subject: { type: "string" },
    htmlContent: { type: "string" },
    plainTextContent: { type: ["string", "null"] },
    variables: {
      type: ["array", "null"],
      items: { $ref: "#/components/schemas/TemplateVariable" },
    },
    useLayout: { type: "boolean" },
    isActive: { type: "boolean" },
    providerId: { type: ["string", "null"], format: "uuid" },
  },
  description:
    "Partial update. `slug` is immutable after creation; the field is " +
    "silently ignored if present.",
};

const ListEmailTemplatesResponse: OpenAPISchema = {
  type: "object",
  required: ["templates"],
  properties: {
    templates: {
      type: "array",
      items: { $ref: "#/components/schemas/EmailTemplate" },
    },
  },
  description:
    "Non-paginated list. Reserved layout rows (`_email-header` / " +
    "`_email-footer`) are excluded — use the layout endpoint to read them.",
};

const MutationResponseEmailTemplate: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/EmailTemplate" },
  },
};

const DeleteEmailTemplateResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "templateId"],
  properties: {
    message: { type: "string", example: "Email template deleted." },
    templateId: { type: "string" },
  },
};

const EmailLayout: OpenAPISchema = {
  type: "object",
  required: ["header", "footer"],
  properties: {
    header: { type: "string" },
    footer: { type: "string" },
  },
  description:
    "Shared header/footer HTML wrapping every template with " +
    "`useLayout: true`. Both fields default to empty strings until first " +
    "saved.",
};

const UpdateEmailLayoutRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    header: { type: "string" },
    footer: { type: "string" },
  },
  description:
    "Both fields optional. Non-string values are silently dropped, " +
    "matching the legacy handler's selective copy.",
};

const UpdateEmailLayoutResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "layout"],
  properties: {
    message: { type: "string", example: "Email layout updated." },
    layout: { $ref: "#/components/schemas/EmailLayout" },
  },
};

const PreviewEmailTemplateRequest: OpenAPISchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: true,
      description:
        "Variable interpolation values. Supports dot-notation keys for " +
        "nested values (e.g. `user.name`). String values are HTML-escaped.",
    },
  },
};

const PreviewEmailTemplateResponse: OpenAPISchema = {
  type: "object",
  required: ["subject", "html"],
  properties: {
    subject: { type: "string" },
    html: {
      type: "string",
      description:
        "Fully rendered HTML, including layout wrapper when the template " +
        "has `useLayout: true`. Admin renders this inside a sandboxed iframe.",
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listOp: OperationIR = {
  path: "/api/email-templates",
  method: "GET",
  versions: ["1.0"],
  operationId: "emailTemplates.list",
  tags: ["Email Templates"],
  summary: "List email templates",
  parameters: [],
  responses: {
    "200": {
      description: "Template list (non-paginated).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListEmailTemplatesResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createOp: OperationIR = {
  path: "/api/email-templates",
  method: "POST",
  versions: ["1.0"],
  operationId: "emailTemplates.create",
  tags: ["Email Templates"],
  summary: "Create an email template",
  description:
    "Reserved layout slugs (`_email-header`, `_email-footer`) are " +
    "rejected — use the layout endpoint instead.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateEmailTemplateRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Template created.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseEmailTemplate",
          },
        },
      },
    },
    "409": { $ref: "#/components/responses/Conflict" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getLayoutOp: OperationIR = {
  path: "/api/email-templates/layout",
  method: "GET",
  versions: ["1.0"],
  operationId: "emailTemplates.getLayout",
  tags: ["Email Templates"],
  summary: "Read the shared email layout",
  parameters: [],
  responses: {
    "200": {
      description: "Layout bundle.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/EmailLayout" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateLayoutOp: OperationIR = {
  path: "/api/email-templates/layout",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "emailTemplates.updateLayout",
  tags: ["Email Templates"],
  summary: "Update the shared email layout",
  description:
    "Upsert: the reserved layout rows are created on first save. Both " +
    "`header` and `footer` are optional; only supplied fields are changed.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateEmailLayoutRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Layout updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UpdateEmailLayoutResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getOp: OperationIR = {
  path: "/api/email-templates/{id}",
  method: "GET",
  versions: ["1.0"],
  operationId: "emailTemplates.findById",
  tags: ["Email Templates"],
  summary: "Get an email template",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Email template document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/EmailTemplate" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateOp: OperationIR = {
  path: "/api/email-templates/{id}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "emailTemplates.update",
  tags: ["Email Templates"],
  summary: "Update an email template",
  parameters: [PATH_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateEmailTemplateRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Template updated.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseEmailTemplate",
          },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const deleteOp: OperationIR = {
  path: "/api/email-templates/{id}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "emailTemplates.delete",
  tags: ["Email Templates"],
  summary: "Delete an email template",
  description:
    "Layout rows cannot be deleted; the handler returns 403 if a caller " +
    "targets `_email-header` or `_email-footer`.",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Template deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DeleteEmailTemplateResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const previewOp: OperationIR = {
  path: "/api/email-templates/{id}/preview",
  method: "POST",
  versions: ["1.0"],
  operationId: "emailTemplates.preview",
  tags: ["Email Templates"],
  summary: "Render a template with sample data",
  parameters: [PATH_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/PreviewEmailTemplateRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Rendered preview.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/PreviewEmailTemplateResponse",
          },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const emailTemplatesModule = defineModule({
  name: "email-templates",
  tag: {
    name: "Email Templates",
    description:
      "Reusable email bodies + shared layout (header / footer) + sandboxed render preview.",
  },
  operations: [
    listOp,
    createOp,
    getLayoutOp,
    updateLayoutOp,
    getOp,
    updateOp,
    deleteOp,
    previewOp,
  ],
  schemas: {
    EmailTemplate,
    TemplateVariable,
    CreateEmailTemplateRequest,
    UpdateEmailTemplateRequest,
    ListEmailTemplatesResponse,
    MutationResponseEmailTemplate,
    DeleteEmailTemplateResponse,
    EmailLayout,
    UpdateEmailLayoutRequest,
    UpdateEmailLayoutResponse,
    PreviewEmailTemplateRequest,
    PreviewEmailTemplateResponse,
  },
});
