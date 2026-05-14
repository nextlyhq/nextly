/**
 * Built-in module: `/api/email-providers/*`.
 *
 * Mirrors the real handlers under `packages/nextly/src/api/email-providers*.ts`:
 *
 *   GET    /api/email-providers              email-providers.ts:GET
 *   POST   /api/email-providers              email-providers.ts:POST
 *   GET    /api/email-providers/{id}         email-providers-detail.ts:GET
 *   PATCH  /api/email-providers/{id}         email-providers-detail.ts:PATCH
 *   DELETE /api/email-providers/{id}         email-providers-detail.ts:DELETE
 *   PATCH  /api/email-providers/{id}/default email-providers-default.ts:PATCH
 *   POST   /api/email-providers/{id}/test    email-providers-test.ts:POST
 *
 * All endpoints require authentication. Configuration is masked on
 * read — sensitive fields (API keys, passwords) are replaced with
 * "••••••••" before serialization.
 *
 * The list endpoint is *not* paginated; the wire shape is
 * `respondData({ providers })`. The default-toggle and test-send
 * endpoints return `respondAction` envelopes.
 *
 * @module nextly/openapi/modules/email-providers
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR, SecurityRequirementIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

const STANDARD_SECURITY: readonly SecurityRequirementIR[] = [
  { bearerAuth: [] },
  { cookieAuth: [] },
  { apiKeyAuth: [] },
];

const PATH_ID = {
  name: "id",
  in: "path" as const,
  required: true,
  description: "Email provider id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const STANDARD_ERROR_RESPONSES = {
  "400": { $ref: "#/components/responses/ValidationError" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/InternalServerError" },
} as const;

const NOT_FOUND_RESPONSE = {
  "404": { $ref: "#/components/responses/NotFound" },
} as const;

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const EmailProvider: OpenAPISchema = {
  type: "object",
  required: [
    "id",
    "name",
    "type",
    "fromEmail",
    "configuration",
    "isDefault",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    type: { type: "string", enum: ["smtp", "resend", "sendlayer"] },
    fromEmail: { type: "string", format: "email" },
    fromName: { type: ["string", "null"] },
    configuration: {
      type: "object",
      additionalProperties: true,
      description:
        "Provider-specific config. Sensitive fields (API keys, passwords) " +
        "are returned masked as `••••••••`; the unmasked values are only " +
        "ever held server-side.",
    },
    isDefault: { type: "boolean" },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const CreateEmailProviderRequest: OpenAPISchema = {
  type: "object",
  required: ["name", "type", "fromEmail", "configuration"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 255 },
    type: { type: "string", enum: ["smtp", "resend", "sendlayer"] },
    fromEmail: { type: "string", format: "email" },
    fromName: { type: ["string", "null"], maxLength: 255 },
    configuration: { type: "object", additionalProperties: true },
    isDefault: { type: "boolean" },
    isActive: { type: "boolean" },
  },
};

const UpdateEmailProviderRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    fromEmail: { type: "string", format: "email" },
    fromName: { type: ["string", "null"] },
    configuration: { type: "object", additionalProperties: true },
    isActive: { type: "boolean" },
  },
  description:
    "Partial update. `type` cannot change after creation; the field is " +
    "silently ignored if present.",
};

const TestEmailProviderRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    email: {
      type: "string",
      format: "email",
      description:
        "Test recipient. Defaults to the provider's `fromEmail` when omitted.",
    },
  },
};

const ListEmailProvidersResponse: OpenAPISchema = {
  type: "object",
  required: ["providers"],
  properties: {
    providers: {
      type: "array",
      items: { $ref: "#/components/schemas/EmailProvider" },
    },
  },
};

const MutationResponseEmailProvider: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/EmailProvider" },
  },
};

const DeleteEmailProviderResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "providerId"],
  properties: {
    message: { type: "string", example: "Email provider deleted." },
    providerId: { type: "string" },
  },
};

const SetDefaultProviderResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "provider"],
  properties: {
    message: { type: "string", example: "Default email provider updated." },
    provider: { $ref: "#/components/schemas/EmailProvider" },
  },
};

const TestEmailProviderResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "result"],
  properties: {
    message: { type: "string", example: "Test email dispatched." },
    result: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean" },
        error: {
          type: "string",
          description: "Failure reason. Present only when `success` is false.",
        },
      },
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listOp: OperationIR = {
  path: "/api/email-providers",
  method: "GET",
  versions: ["1.0"],
  operationId: "emailProviders.list",
  tags: ["Email Providers"],
  summary: "List email providers",
  description:
    "Returns every configured provider with masked configuration. " +
    "Non-paginated.",
  parameters: [],
  responses: {
    "200": {
      description: "Provider list.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListEmailProvidersResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createOp: OperationIR = {
  path: "/api/email-providers",
  method: "POST",
  versions: ["1.0"],
  operationId: "emailProviders.create",
  tags: ["Email Providers"],
  summary: "Create an email provider",
  description:
    "Stores the supplied configuration encrypted at rest. When `isDefault: " +
    "true` is set, the previous default provider is unset atomically.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateEmailProviderRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Provider created.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseEmailProvider",
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

const getOp: OperationIR = {
  path: "/api/email-providers/{id}",
  method: "GET",
  versions: ["1.0"],
  operationId: "emailProviders.findById",
  tags: ["Email Providers"],
  summary: "Get an email provider",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Email provider document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/EmailProvider" },
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
  path: "/api/email-providers/{id}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "emailProviders.update",
  tags: ["Email Providers"],
  summary: "Update an email provider",
  parameters: [PATH_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateEmailProviderRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Provider updated.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseEmailProvider",
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
  path: "/api/email-providers/{id}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "emailProviders.delete",
  tags: ["Email Providers"],
  summary: "Delete an email provider",
  description:
    "Deleting the current default provider is blocked; set a different " +
    "provider as default first.",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Provider deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DeleteEmailProviderResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const setDefaultOp: OperationIR = {
  path: "/api/email-providers/{id}/default",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "emailProviders.setDefault",
  tags: ["Email Providers"],
  summary: "Set the default email provider",
  description:
    "Atomically unsets the previous default and marks the target provider " +
    "as the new default.",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Default provider updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SetDefaultProviderResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const testOp: OperationIR = {
  path: "/api/email-providers/{id}/test",
  method: "POST",
  versions: ["1.0"],
  operationId: "emailProviders.test",
  tags: ["Email Providers"],
  summary: "Send a test email through the provider",
  description:
    "Sends a synthetic test message through the named provider. Always " +
    "returns 200 at the request layer; per-attempt delivery success is " +
    "carried in `result.success` (with `result.error` populated on " +
    "failure).",
  parameters: [PATH_ID],
  requestBody: {
    required: false,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/TestEmailProviderRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Test dispatch result.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/TestEmailProviderResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const emailProvidersModule = defineModule({
  name: "email-providers",
  tag: {
    name: "Email Providers",
    description:
      "Email transport adapters: create, configure, set default, and test SMTP / Resend / SendLayer providers.",
  },
  operations: [
    listOp,
    createOp,
    getOp,
    updateOp,
    deleteOp,
    setDefaultOp,
    testOp,
  ],
  schemas: {
    EmailProvider,
    CreateEmailProviderRequest,
    UpdateEmailProviderRequest,
    TestEmailProviderRequest,
    ListEmailProvidersResponse,
    MutationResponseEmailProvider,
    DeleteEmailProviderResponse,
    SetDefaultProviderResponse,
    TestEmailProviderResponse,
  },
});
