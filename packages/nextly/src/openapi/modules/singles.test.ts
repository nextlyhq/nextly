import { describe, expect, it } from "vitest";

import { singlesModule } from "./singles";

describe("singlesModule", () => {
  it("is named 'singles'", () => {
    expect(singlesModule.name).toBe("singles");
  });

  it("declares all 9 single-CRUD + schema operations", () => {
    const summary = singlesModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/singles/{slug}",
      "GET /api/singles",
      "GET /api/singles/{slug}",
      "GET /api/singles/{slug}/schema",
      "PATCH /api/singles/{slug}",
      "PATCH /api/singles/{slug}/schema",
      "POST /api/singles",
      "POST /api/singles/schema/{slug}/apply",
      "POST /api/singles/schema/{slug}/preview",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of singlesModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  it("PATCH /api/singles/{slug}/schema is the direct-write path", () => {
    const op = singlesModule.operations.find(
      o => o.method === "PATCH" && o.path === "/api/singles/{slug}/schema"
    )!;
    expect(op.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/UpdateSingleSchemaRequest",
    });
  });

  it("preview returns SchemaChangePreview (shared with components)", () => {
    const op = singlesModule.operations.find(
      o => o.path === "/api/singles/schema/{slug}/preview"
    )!;
    const schema = (
      op.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/SchemaChangePreview",
    });
  });

  it("registers the documented schemas", () => {
    const names = Object.keys(singlesModule.schemas ?? {}).sort();
    expect(names).toEqual([
      "CreateSingleRequest",
      "DeleteSingleResponse",
      "ListSinglesResponse",
      "MutationResponseSingleDocument",
      "MutationResponseSingleSummary",
      "SchemaApplyRequest",
      "SchemaPreviewRequest",
      "SingleDocument",
      "SingleSchema",
      "SingleSummary",
      "UpdateSingleDocumentRequest",
      "UpdateSingleSchemaRequest",
    ]);
  });
});
