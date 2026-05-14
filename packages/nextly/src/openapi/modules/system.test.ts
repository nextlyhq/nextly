import { describe, expect, it } from "vitest";

import { systemModule } from "./system";

describe("systemModule", () => {
  it("is named 'system'", () => {
    expect(systemModule.name).toBe("system");
  });

  it("declares all 26 admin / system operations", () => {
    const summary = systemModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/api-keys/{id}",
      "DELETE /api/image-sizes/{id}",
      "DELETE /api/user-fields/{id}",
      "GET /api/admin-meta",
      "GET /api/api-keys",
      "GET /api/api-keys/{id}",
      "GET /api/dashboard/activity",
      "GET /api/dashboard/recent-entries",
      "GET /api/dashboard/stats",
      "GET /api/general-settings",
      "GET /api/image-sizes",
      "GET /api/image-sizes/regeneration-status",
      "GET /api/image-sizes/{id}",
      "GET /api/schema-journal",
      "GET /api/user-fields",
      "GET /api/user-fields/{id}",
      "PATCH /api/admin-meta/sidebar-groups",
      "PATCH /api/api-keys/{id}",
      "PATCH /api/general-settings",
      "PATCH /api/image-sizes/{id}",
      "PATCH /api/user-fields/reorder",
      "PATCH /api/user-fields/{id}",
      "POST /api/api-keys",
      "POST /api/image-sizes",
      "POST /api/image-sizes/regenerate",
      "POST /api/user-fields",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of systemModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("POST /api/api-keys returns the once-only key alongside the doc", () => {
    const op = systemModule.operations.find(
      o => o.method === "POST" && o.path === "/api/api-keys"
    )!;
    const schema = (
      op.responses["201"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/CreateApiKeyResponse",
    });
  });

  it("PATCH /api/user-fields/reorder uses the bulk-order request", () => {
    const op = systemModule.operations.find(
      o => o.path === "/api/user-fields/reorder"
    )!;
    expect(op.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/ReorderUserFieldsRequest",
    });
  });

  it("image regeneration status + trigger share the same response", () => {
    const status = systemModule.operations.find(
      o => o.path === "/api/image-sizes/regeneration-status"
    )!;
    const trigger = systemModule.operations.find(
      o => o.path === "/api/image-sizes/regenerate"
    )!;
    const statusSchema = (
      status.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    const triggerSchema = (
      trigger.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(statusSchema).toEqual({
      $ref: "#/components/schemas/RegenerationStatusResponse",
    });
    expect(triggerSchema).toEqual({
      $ref: "#/components/schemas/RegenerationStatusResponse",
    });
  });

  it("UserFieldDefinition.type is a closed enum matching the create schema", () => {
    const schema = systemModule.schemas?.UserFieldDefinition as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties?.type?.enum).toEqual([
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ]);
  });

  it("registers the documented schemas", () => {
    const names = Object.keys(systemModule.schemas ?? {}).sort();
    expect(names).toEqual([
      "AdminMeta",
      "ApiKey",
      "CreateApiKeyRequest",
      "CreateApiKeyResponse",
      "CreateImageSizeRequest",
      "CreateUserFieldRequest",
      "DashboardActivity",
      "DashboardRecentEntries",
      "DashboardStats",
      "GeneralSettings",
      "ImageSize",
      "ListApiKeysResponse",
      "ListImageSizesResponse",
      "ListUserFieldsResponse",
      "MutationResponseApiKey",
      "MutationResponseImageSize",
      "MutationResponseUserField",
      "RegenerateBatchRequest",
      "RegenerationStatusResponse",
      "ReorderUserFieldsRequest",
      "ReorderUserFieldsResponse",
      "RevokeApiKeyResponse",
      "SchemaJournalEntry",
      "SchemaJournalResponse",
      "UpdateAdminSidebarGroupsRequest",
      "UpdateAdminSidebarGroupsResponse",
      "UpdateApiKeyRequest",
      "UpdateGeneralSettingsRequest",
      "UpdateGeneralSettingsResponse",
      "UpdateImageSizeRequest",
      "UpdateUserFieldRequest",
      "UserFieldDefinition",
    ]);
  });
});
