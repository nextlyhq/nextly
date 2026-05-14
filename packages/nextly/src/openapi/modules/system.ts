/**
 * Built-in module: admin / system endpoints.
 *
 * Covers the remaining handlers that don't belong to a domain module:
 *
 *   /api/api-keys           per-user API key management (5 ops)
 *   /api/dashboard/*        admin dashboard widgets (3 ops)
 *   /api/general-settings   key/value app config (2 ops)
 *   /api/schema-journal     append-only schema-change log (1 op)
 *   /api/image-sizes        image-variant config + regen (7 ops)
 *   /api/user-fields        custom user field defs (6 ops)
 *   /api/admin-meta         admin navigation metadata (2 ops)
 *
 * 26 operations. All authenticated.
 *
 * Wire shapes match the corresponding `api/*.ts` handlers' respond*
 * helpers; non-paginated lists use `respondData({ <named-field> })` and
 * mutating endpoints use `respondMutation` / `respondAction`.
 *
 * @module nextly/openapi/modules/system
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
  description: "Resource id.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const ApiKey: OpenAPISchema = {
  type: "object",
  required: ["id", "name", "prefix", "createdAt"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    prefix: {
      type: "string",
      description:
        "Public-safe key prefix (first ~6 chars). The full token is " +
        "returned only at creation time.",
    },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    lastUsedAt: { type: ["string", "null"], format: "date-time" },
  },
};

const CreateApiKeyRequest: OpenAPISchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: ["string", "null"] },
    expiresAt: { type: ["string", "null"], format: "date-time" },
  },
};

const CreateApiKeyResponse: OpenAPISchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["doc", "key"],
      properties: {
        doc: { $ref: "#/components/schemas/ApiKey" },
        key: {
          type: "string",
          description:
            "The full bearer token. Returned only at creation time and " +
            "never again — clients must store it now.",
        },
      },
    },
  },
};

const UpdateApiKeyRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    description: { type: ["string", "null"] },
  },
  description: "Session-only — refreshing the key itself is not supported.",
};

const ListApiKeysResponse: OpenAPISchema = {
  type: "object",
  required: ["apiKeys"],
  properties: {
    apiKeys: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } },
  },
};

const MutationResponseApiKey: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/ApiKey" },
  },
};

const RevokeApiKeyResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "id"],
  properties: {
    message: { type: "string", example: "API key revoked." },
    id: { type: "string" },
  },
};

const DashboardStats: OpenAPISchema = {
  type: "object",
  additionalProperties: true,
  description:
    "Headline counts for collections / users / media etc. Shape is " +
    "intentionally open so plugins can contribute widgets.",
};

const DashboardRecentEntries: OpenAPISchema = {
  type: "object",
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: { type: "object", additionalProperties: true },
      description:
        "Most-recently-touched records across all collections. Each entry " +
        "carries `id`, `collection`, `title?`, `updatedAt`.",
    },
  },
};

const DashboardActivity: OpenAPISchema = {
  type: "object",
  required: ["activity"],
  properties: {
    activity: {
      type: "array",
      items: { type: "object", additionalProperties: true },
      description:
        "Recent audit events (login, role assignment, …) ordered newest-first.",
    },
  },
};

const GeneralSettings: OpenAPISchema = {
  type: "object",
  additionalProperties: true,
  description:
    "Key/value app config. Shape is plugin-extensible; v1 callers should " +
    "treat unknown keys as additive.",
};

const UpdateGeneralSettingsRequest: OpenAPISchema = {
  type: "object",
  additionalProperties: true,
  description: "Partial merge over the existing settings document.",
};

const UpdateGeneralSettingsResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "settings"],
  properties: {
    message: { type: "string" },
    settings: { $ref: "#/components/schemas/GeneralSettings" },
  },
};

const SchemaJournalEntry: OpenAPISchema = {
  type: "object",
  required: ["id", "createdAt", "kind"],
  properties: {
    id: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    kind: {
      type: "string",
      description: "Event type (e.g. `collection.create`, `field.rename`, …).",
    },
    target: { type: "string" },
    actorId: { type: ["string", "null"] },
    metadata: { type: "object", additionalProperties: true },
  },
};

const SchemaJournalResponse: OpenAPISchema = {
  type: "object",
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: { $ref: "#/components/schemas/SchemaJournalEntry" },
    },
  },
};

const ImageSize: OpenAPISchema = {
  type: "object",
  required: ["id", "name", "width", "height"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    fit: {
      type: "string",
      enum: ["cover", "contain", "fill", "inside", "outside"],
    },
    position: { type: "string" },
    background: { type: "string" },
    formats: { type: "array", items: { type: "string" } },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
};

const CreateImageSizeRequest: OpenAPISchema = {
  type: "object",
  required: ["name", "width", "height"],
  properties: {
    name: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    fit: {
      type: "string",
      enum: ["cover", "contain", "fill", "inside", "outside"],
    },
    position: { type: "string" },
    background: { type: "string" },
    formats: { type: "array", items: { type: "string" } },
  },
};

const UpdateImageSizeRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    fit: {
      type: "string",
      enum: ["cover", "contain", "fill", "inside", "outside"],
    },
    position: { type: "string" },
    background: { type: "string" },
    formats: { type: "array", items: { type: "string" } },
  },
};

const ListImageSizesResponse: OpenAPISchema = {
  type: "object",
  required: ["imageSizes"],
  properties: {
    imageSizes: {
      type: "array",
      items: { $ref: "#/components/schemas/ImageSize" },
    },
  },
};

const MutationResponseImageSize: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/ImageSize" },
  },
};

const RegenerationStatusResponse: OpenAPISchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["pending", "total", "inProgress"],
      properties: {
        pending: { type: "integer" },
        total: { type: "integer" },
        inProgress: { type: "boolean" },
        message: { type: "string" },
      },
    },
  },
};

const RegenerateBatchRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    sizeIds: {
      type: "array",
      items: { type: "string" },
      description: "Restrict regen to these image sizes; omit for all.",
    },
  },
};

const UserFieldDefinition: OpenAPISchema = {
  type: "object",
  required: ["id", "name", "label", "type", "source"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    label: { type: "string" },
    type: {
      type: "string",
      enum: [
        "text",
        "textarea",
        "number",
        "email",
        "select",
        "radio",
        "checkbox",
        "date",
      ],
    },
    required: { type: "boolean" },
    defaultValue: { type: ["string", "null"] },
    options: {
      type: ["array", "null"],
      items: {
        type: "object",
        required: ["label", "value"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
      },
    },
    placeholder: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    sortOrder: { type: "integer", minimum: 0 },
    isActive: { type: "boolean" },
    source: {
      type: "string",
      enum: ["code", "ui"],
      description:
        "Where the field came from. UI-managed fields can be edited via " +
        "this API; code-sourced fields are read-only.",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const ListUserFieldsResponse: OpenAPISchema = {
  type: "object",
  required: ["fields"],
  properties: {
    fields: {
      type: "array",
      items: { $ref: "#/components/schemas/UserFieldDefinition" },
    },
    adminConfig: {
      type: "object",
      additionalProperties: true,
      description:
        "Optional admin-side config from `defineConfig({ users: { admin: " +
        "... } })` — listFields / group ordering.",
    },
  },
};

const CreateUserFieldRequest: OpenAPISchema = {
  type: "object",
  required: ["name", "label", "type"],
  properties: {
    name: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9]*$" },
    label: { type: "string", minLength: 1, maxLength: 255 },
    type: {
      type: "string",
      enum: [
        "text",
        "textarea",
        "number",
        "email",
        "select",
        "radio",
        "checkbox",
        "date",
      ],
    },
    required: { type: "boolean" },
    defaultValue: { type: ["string", "null"] },
    options: {
      type: ["array", "null"],
      items: {
        type: "object",
        required: ["label", "value"],
        properties: {
          label: { type: "string", minLength: 1 },
          value: { type: "string", minLength: 1 },
        },
      },
    },
    placeholder: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    sortOrder: { type: "integer", minimum: 0 },
    isActive: { type: "boolean" },
  },
};

const UpdateUserFieldRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    label: { type: "string" },
    required: { type: "boolean" },
    defaultValue: { type: ["string", "null"] },
    options: {
      type: ["array", "null"],
      items: { type: "object", additionalProperties: true },
    },
    placeholder: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    sortOrder: { type: "integer", minimum: 0 },
    isActive: { type: "boolean" },
  },
  description: "`name` and `type` are immutable post-creation.",
};

const MutationResponseUserField: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/UserFieldDefinition" },
  },
};

const ReorderUserFieldsRequest: OpenAPISchema = {
  type: "object",
  required: ["order"],
  properties: {
    order: {
      type: "array",
      items: { type: "string" },
      description:
        "Field ids in their new display order. Must include every " +
        "currently active UI-managed field.",
    },
  },
};

const ReorderUserFieldsResponse: OpenAPISchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", example: "Field order updated." },
  },
};

const AdminMeta: OpenAPISchema = {
  type: "object",
  additionalProperties: true,
  description:
    "Admin-side metadata bundle: branding, collection summaries, " +
    "sidebar groups, plugin contributions. Shape is plugin-extensible; " +
    "consumers should treat unknown keys as additive.",
};

const UpdateAdminSidebarGroupsRequest: OpenAPISchema = {
  type: "object",
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: { type: "object", additionalProperties: true },
      description: "Desired sidebar-group ordering.",
    },
  },
};

const UpdateAdminSidebarGroupsResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string", example: "Sidebar groups updated." },
    item: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

function op(
  spec: Omit<OperationIR, "tags" | "security" | "versions" | "extensions">
): OperationIR {
  return {
    versions: ["1.0"],
    tags: ["System"],
    security: STANDARD_SECURITY,
    extensions: {},
    ...spec,
  };
}

function jsonResponse(ref: string, description: string) {
  return {
    description,
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
    },
  };
}

function jsonRequestBody(ref: string) {
  return {
    required: true,
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${ref}` } },
    },
  };
}

const apiKeyOps: OperationIR[] = [
  op({
    path: "/api/api-keys",
    method: "GET",
    operationId: "system.listApiKeys",
    summary: "List API keys for the authenticated user",
    parameters: [],
    responses: {
      "200": jsonResponse("ListApiKeysResponse", "API key list."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/api-keys",
    method: "POST",
    operationId: "system.createApiKey",
    summary: "Create an API key (session-only)",
    description:
      "Returns the full bearer token once, alongside the persisted record. " +
      "Subsequent reads only surface the public prefix.",
    parameters: [],
    requestBody: jsonRequestBody("CreateApiKeyRequest"),
    responses: {
      "201": jsonResponse("CreateApiKeyResponse", "API key issued."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/api-keys/{id}",
    method: "GET",
    operationId: "system.findApiKeyById",
    summary: "Get an API key",
    parameters: [PATH_ID],
    responses: {
      "200": jsonResponse("ApiKey", "API key document."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/api-keys/{id}",
    method: "PATCH",
    operationId: "system.updateApiKey",
    summary: "Update an API key's metadata (session-only)",
    parameters: [PATH_ID],
    requestBody: jsonRequestBody("UpdateApiKeyRequest"),
    responses: {
      "200": jsonResponse("MutationResponseApiKey", "API key updated."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/api-keys/{id}",
    method: "DELETE",
    operationId: "system.revokeApiKey",
    summary: "Revoke an API key (session-only)",
    parameters: [PATH_ID],
    responses: {
      "200": jsonResponse("RevokeApiKeyResponse", "API key revoked."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

const dashboardOps: OperationIR[] = [
  op({
    path: "/api/dashboard/stats",
    method: "GET",
    operationId: "system.dashboardStats",
    summary: "Get dashboard headline stats",
    parameters: [],
    responses: {
      "200": jsonResponse("DashboardStats", "Stats bundle."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/dashboard/recent-entries",
    method: "GET",
    operationId: "system.dashboardRecentEntries",
    summary: "List recently touched records",
    parameters: [],
    responses: {
      "200": jsonResponse("DashboardRecentEntries", "Recent entries."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/dashboard/activity",
    method: "GET",
    operationId: "system.dashboardActivity",
    summary: "List recent audit events",
    parameters: [],
    responses: {
      "200": jsonResponse("DashboardActivity", "Activity log."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

const generalSettingsOps: OperationIR[] = [
  op({
    path: "/api/general-settings",
    method: "GET",
    operationId: "system.getGeneralSettings",
    summary: "Read general settings",
    parameters: [],
    responses: {
      "200": jsonResponse("GeneralSettings", "Settings bundle."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/general-settings",
    method: "PATCH",
    operationId: "system.updateGeneralSettings",
    summary: "Update general settings",
    parameters: [],
    requestBody: jsonRequestBody("UpdateGeneralSettingsRequest"),
    responses: {
      "200": jsonResponse("UpdateGeneralSettingsResponse", "Settings updated."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

const schemaJournalOps: OperationIR[] = [
  op({
    path: "/api/schema-journal",
    method: "GET",
    operationId: "system.getSchemaJournal",
    summary: "Read the schema-change audit log",
    description:
      "Append-only history of schema mutations applied through Schema-" +
      "Builder, including code-deploy diffs. Newest first.",
    parameters: [],
    responses: {
      "200": jsonResponse("SchemaJournalResponse", "Journal entries."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

const imageSizeOps: OperationIR[] = [
  op({
    path: "/api/image-sizes",
    method: "GET",
    operationId: "system.listImageSizes",
    summary: "List image-size variants",
    parameters: [],
    responses: {
      "200": jsonResponse("ListImageSizesResponse", "Image size list."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/image-sizes",
    method: "POST",
    operationId: "system.createImageSize",
    summary: "Create an image-size variant",
    parameters: [],
    requestBody: jsonRequestBody("CreateImageSizeRequest"),
    responses: {
      "201": jsonResponse("MutationResponseImageSize", "Image size created."),
      "409": { $ref: "#/components/responses/Conflict" },
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/image-sizes/{id}",
    method: "GET",
    operationId: "system.findImageSizeById",
    summary: "Get an image-size variant",
    parameters: [PATH_ID],
    responses: {
      "200": jsonResponse("ImageSize", "Image size document."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/image-sizes/{id}",
    method: "PATCH",
    operationId: "system.updateImageSize",
    summary: "Update an image-size variant",
    parameters: [PATH_ID],
    requestBody: jsonRequestBody("UpdateImageSizeRequest"),
    responses: {
      "200": jsonResponse("MutationResponseImageSize", "Image size updated."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/image-sizes/{id}",
    method: "DELETE",
    operationId: "system.deleteImageSize",
    summary: "Delete an image-size variant",
    parameters: [PATH_ID],
    responses: {
      "200": jsonResponse("MutationResponseImageSize", "Image size deleted."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/image-sizes/regeneration-status",
    method: "GET",
    operationId: "system.imageSizesRegenerationStatus",
    summary: "Get image regeneration status",
    description:
      "Status placeholder — currently always reports `{ pending: 0, total: 0, " +
      "inProgress: false }` with a `coming soon` message until batch regen " +
      "supports cross-adapter downloads.",
    parameters: [],
    responses: {
      "200": jsonResponse("RegenerationStatusResponse", "Status bundle."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/image-sizes/regenerate",
    method: "POST",
    operationId: "system.imageSizesRegenerate",
    summary: "Trigger image-size regeneration",
    description:
      "Stub endpoint — accepts the request and returns the same `not-yet-" +
      "available` placeholder until batch regen ships.",
    parameters: [],
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RegenerateBatchRequest" },
        },
      },
    },
    responses: {
      "200": jsonResponse("RegenerationStatusResponse", "Status echo."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

const userFieldsOps: OperationIR[] = [
  op({
    path: "/api/user-fields",
    method: "GET",
    operationId: "system.listUserFields",
    summary: "List user field definitions",
    parameters: [],
    responses: {
      "200": jsonResponse("ListUserFieldsResponse", "Field list."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/user-fields",
    method: "POST",
    operationId: "system.createUserField",
    summary: "Create a user field definition (UI-source)",
    parameters: [],
    requestBody: jsonRequestBody("CreateUserFieldRequest"),
    responses: {
      "201": jsonResponse("MutationResponseUserField", "Field created."),
      "409": { $ref: "#/components/responses/Conflict" },
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/user-fields/reorder",
    method: "PATCH",
    operationId: "system.reorderUserFields",
    summary: "Bulk reorder user field definitions",
    parameters: [],
    requestBody: jsonRequestBody("ReorderUserFieldsRequest"),
    responses: {
      "200": jsonResponse("ReorderUserFieldsResponse", "Order updated."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/user-fields/{id}",
    method: "GET",
    operationId: "system.findUserFieldById",
    summary: "Get a user field definition",
    parameters: [PATH_ID],
    responses: {
      "200": jsonResponse("UserFieldDefinition", "Field document."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/user-fields/{id}",
    method: "PATCH",
    operationId: "system.updateUserField",
    summary: "Update a user field definition",
    parameters: [PATH_ID],
    requestBody: jsonRequestBody("UpdateUserFieldRequest"),
    responses: {
      "200": jsonResponse("MutationResponseUserField", "Field updated."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/user-fields/{id}",
    method: "DELETE",
    operationId: "system.deleteUserField",
    summary: "Delete a user field definition",
    description: "Code-sourced fields cannot be deleted via the API.",
    parameters: [PATH_ID],
    responses: {
      "200": jsonResponse("MutationResponseUserField", "Field deleted."),
      ...NOT_FOUND_RESPONSE,
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

const adminMetaOps: OperationIR[] = [
  op({
    path: "/api/admin-meta",
    method: "GET",
    operationId: "system.getAdminMeta",
    summary: "Read admin metadata",
    description:
      "Bundles the data the admin shell needs to render: branding, " +
      "collection summaries, sidebar groups, plugin contributions.",
    parameters: [],
    responses: {
      "200": jsonResponse("AdminMeta", "Admin metadata bundle."),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
  op({
    path: "/api/admin-meta/sidebar-groups",
    method: "PATCH",
    operationId: "system.updateAdminSidebarGroups",
    summary: "Update admin sidebar grouping",
    parameters: [],
    requestBody: jsonRequestBody("UpdateAdminSidebarGroupsRequest"),
    responses: {
      "200": jsonResponse(
        "UpdateAdminSidebarGroupsResponse",
        "Sidebar groups updated."
      ),
      ...STANDARD_ERROR_RESPONSES,
    },
  }),
];

export const systemModule = defineModule({
  name: "system",
  tag: {
    name: "System",
    description:
      "Admin-side endpoints: API keys, dashboard widgets, general settings, schema journal, image sizes, user fields, admin metadata.",
  },
  operations: [
    ...apiKeyOps,
    ...dashboardOps,
    ...generalSettingsOps,
    ...schemaJournalOps,
    ...imageSizeOps,
    ...userFieldsOps,
    ...adminMetaOps,
  ],
  schemas: {
    ApiKey,
    CreateApiKeyRequest,
    CreateApiKeyResponse,
    UpdateApiKeyRequest,
    ListApiKeysResponse,
    MutationResponseApiKey,
    RevokeApiKeyResponse,
    DashboardStats,
    DashboardRecentEntries,
    DashboardActivity,
    GeneralSettings,
    UpdateGeneralSettingsRequest,
    UpdateGeneralSettingsResponse,
    SchemaJournalEntry,
    SchemaJournalResponse,
    ImageSize,
    CreateImageSizeRequest,
    UpdateImageSizeRequest,
    ListImageSizesResponse,
    MutationResponseImageSize,
    RegenerationStatusResponse,
    RegenerateBatchRequest,
    UserFieldDefinition,
    ListUserFieldsResponse,
    CreateUserFieldRequest,
    UpdateUserFieldRequest,
    MutationResponseUserField,
    ReorderUserFieldsRequest,
    ReorderUserFieldsResponse,
    AdminMeta,
    UpdateAdminSidebarGroupsRequest,
    UpdateAdminSidebarGroupsResponse,
  },
});
