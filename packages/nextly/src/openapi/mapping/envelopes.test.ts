import { describe, expect, it } from "vitest";

import { buildCollectionEnvelopes, buildEnvelopeComponents } from "./envelopes";

describe("buildEnvelopeComponents", () => {
  const { schemas } = buildEnvelopeComponents();

  it("emits PaginationMeta with the six required fields", () => {
    expect(schemas.PaginationMeta).toMatchObject({
      type: "object",
      required: ["total", "page", "limit", "totalPages", "hasNext", "hasPrev"],
    });
  });

  it("PaginationMeta caps limit at 50000 (mirrors the runtime contract)", () => {
    const limit = (
      schemas.PaginationMeta as {
        properties?: { limit?: { maximum?: number } };
      }
    ).properties?.limit;
    expect(limit?.maximum).toBe(50000);
  });

  it("emits CountResponse with a non-negative integer total", () => {
    expect(schemas.CountResponse).toMatchObject({
      type: "object",
      required: ["total"],
      properties: { total: { type: "integer", minimum: 0 } },
    });
  });

  it("emits DeleteResponse with item.id only (not the full doc)", () => {
    expect(schemas.DeleteResponse).toMatchObject({
      type: "object",
      required: ["message", "item"],
      properties: {
        message: { type: "string" },
        item: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    });
  });

  it("emits BulkItemError with id/code/message", () => {
    expect(schemas.BulkItemError).toMatchObject({
      type: "object",
      required: ["id", "code", "message"],
    });
  });

  it("emits BulkUploadItemError with index+filename (NOT id)", () => {
    expect(schemas.BulkUploadItemError).toMatchObject({
      type: "object",
      required: ["index", "filename", "code", "message"],
    });
    const props = (
      schemas.BulkUploadItemError as { properties?: Record<string, unknown> }
    ).properties;
    expect(props).not.toHaveProperty("id");
  });
});

describe("buildCollectionEnvelopes", () => {
  it("emits ListResponse<Name> referencing PaginationMeta and the named schema", () => {
    const { schemas } = buildCollectionEnvelopes(["Post"]);
    expect(schemas.ListResponsePost).toBeDefined();
    expect(schemas.ListResponsePost).toMatchObject({
      type: "object",
      required: ["items", "meta"],
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/Post" },
        },
        meta: { $ref: "#/components/schemas/PaginationMeta" },
      },
    });
  });

  it("emits MutationResponse<Name> with message + item", () => {
    const { schemas } = buildCollectionEnvelopes(["User"]);
    expect(schemas.MutationResponseUser).toMatchObject({
      type: "object",
      required: ["message", "item"],
      properties: {
        message: { type: "string" },
        item: { $ref: "#/components/schemas/User" },
      },
    });
  });

  it("emits BulkResponse<Name> with errors as BulkItemError[]", () => {
    const { schemas } = buildCollectionEnvelopes(["Post"]);
    expect(schemas.BulkResponsePost).toMatchObject({
      type: "object",
      required: ["message", "items", "errors"],
      properties: {
        errors: {
          type: "array",
          items: { $ref: "#/components/schemas/BulkItemError" },
        },
      },
    });
  });

  it("emits envelopes for every name passed in", () => {
    const { schemas } = buildCollectionEnvelopes(["Post", "User", "Category"]);
    const keys = Object.keys(schemas).sort();
    expect(keys).toEqual([
      "BulkResponseCategory",
      "BulkResponsePost",
      "BulkResponseUser",
      "ListResponseCategory",
      "ListResponsePost",
      "ListResponseUser",
      "MutationResponseCategory",
      "MutationResponsePost",
      "MutationResponseUser",
    ]);
  });

  it("emits nothing when given an empty array", () => {
    const { schemas } = buildCollectionEnvelopes([]);
    expect(Object.keys(schemas)).toEqual([]);
  });
});
