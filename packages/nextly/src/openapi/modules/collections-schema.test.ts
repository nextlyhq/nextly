import { describe, expect, it } from "vitest";

import { collectionsSchemaModule } from "./collections-schema";

describe("collectionsSchemaModule", () => {
  it("is named 'collections-schema'", () => {
    expect(collectionsSchemaModule.name).toBe("collections-schema");
  });

  it("declares all 6 schema-builder collection operations", () => {
    const summary = collectionsSchemaModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/collections/schema/{slug}",
      "GET /api/collections/schema",
      "GET /api/collections/schema/{slug}",
      "GET /api/collections/schema/{slug}/export",
      "PATCH /api/collections/schema/{slug}",
      "POST /api/collections/schema",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of collectionsSchemaModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("export returns ExportCollectionSchemaResponse with filename + content", () => {
    const op = collectionsSchemaModule.operations.find(
      o => o.path === "/api/collections/schema/{slug}/export"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/ExportCollectionSchemaResponse",
    });
  });

  it("registers the documented schemas", () => {
    const names = Object.keys(collectionsSchemaModule.schemas ?? {}).sort();
    expect(names).toEqual([
      "CollectionSchema",
      "CreateCollectionSchemaRequest",
      "DeleteCollectionSchemaResponse",
      "ExportCollectionSchemaResponse",
      "ListCollectionSchemasResponse",
      "MutationResponseCollectionSchema",
      "UpdateCollectionSchemaRequest",
    ]);
  });
});
