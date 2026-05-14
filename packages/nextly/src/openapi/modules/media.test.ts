import { describe, expect, it } from "vitest";

import { mediaModule } from "./media";

describe("mediaModule", () => {
  it("is named 'media'", () => {
    expect(mediaModule.name).toBe("media");
  });

  it("emits a Media tag", () => {
    expect(mediaModule.tag?.name).toBe("Media");
    expect(mediaModule.tag?.description).toMatch(/upload|media/i);
  });

  it("declares all documented /api/media/*, /api/media-bulk, /api/media-folders/*, /api/uploads/*, and /api/storage-upload-url endpoints", () => {
    const summary = mediaModule.operations
      .map(o => `${o.method} ${o.path}`)
      .sort();
    expect(summary).toEqual([
      "DELETE /api/media-bulk",
      "DELETE /api/media-folders/{id}",
      "DELETE /api/media/{id}",
      "DELETE /api/uploads/{slug}/{id}",
      "GET /api/media",
      "GET /api/media-folders",
      "GET /api/media-folders/root/contents",
      "GET /api/media-folders/{id}",
      "GET /api/media-folders/{id}/contents",
      "GET /api/media/{id}",
      "GET /api/uploads/{slug}",
      "GET /api/uploads/{slug}/{id}",
      "PATCH /api/media-folders/{id}",
      "PATCH /api/media/{id}",
      "PATCH /api/media/{id}/move",
      "POST /api/media",
      "POST /api/media-bulk",
      "POST /api/media-folders",
      "POST /api/storage-upload-url",
      "POST /api/uploads/{slug}",
    ]);
  });

  it("every operation requires authentication", () => {
    for (const op of mediaModule.operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });

  describe("POST /api/media (upload)", () => {
    const op = mediaModule.operations.find(
      o => o.method === "POST" && o.path === "/api/media"
    )!;

    it("uses multipart/form-data with a binary file field", () => {
      const mt = op.requestBody?.content?.["multipart/form-data"];
      expect(mt).toBeDefined();
      const schema = mt?.schema as {
        type?: string;
        required?: string[];
        properties?: Record<string, { type?: string; format?: string }>;
      };
      expect(schema.type).toBe("object");
      expect(schema.required).toEqual(["file", "uploadedBy"]);
      expect(schema.properties?.file?.type).toBe("string");
      expect(schema.properties?.file?.format).toBe("binary");
    });

    it("201 returns MutationResponseMedia", () => {
      const schema = (
        op.responses["201"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/MutationResponseMedia",
      });
    });

    it("does NOT declare an application/json request body — uploads are multipart only", () => {
      expect(op.requestBody?.content?.["application/json"]).toBeUndefined();
    });
  });

  describe("POST /api/uploads/{slug} (per-collection upload)", () => {
    const op = mediaModule.operations.find(
      o => o.method === "POST" && o.path === "/api/uploads/{slug}"
    )!;

    it("requires the slug path parameter", () => {
      const slug = op.parameters.find(p => p.name === "slug");
      expect(slug?.in).toBe("path");
      expect(slug?.required).toBe(true);
    });

    it("uses multipart/form-data with file + optional _payload", () => {
      const schema = op.requestBody?.content?.["multipart/form-data"]
        ?.schema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toEqual(["file"]);
      expect(schema.properties?._payload).toBeDefined();
    });

    it("413 references the PayloadTooLarge response component", () => {
      expect(op.responses["413"]).toEqual({
        $ref: "#/components/responses/PayloadTooLarge",
      });
    });
  });

  describe("POST /api/media-bulk (bulk upload)", () => {
    const op = mediaModule.operations.find(
      o => o.method === "POST" && o.path === "/api/media-bulk"
    )!;

    it("requires a BulkUploadRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/BulkUploadMediaRequest",
      });
    });

    it("200 returns BulkUploadMediaResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/BulkUploadMediaResponse",
      });
    });
  });

  describe("DELETE /api/media-bulk (bulk delete)", () => {
    const op = mediaModule.operations.find(
      o => o.method === "DELETE" && o.path === "/api/media-bulk"
    )!;

    it("requires a BulkDeleteMediaRequest body", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/BulkDeleteMediaRequest",
      });
    });

    it("200 returns BulkDeleteMediaResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/BulkDeleteMediaResponse",
      });
    });
  });

  describe("POST /api/storage-upload-url", () => {
    const op = mediaModule.operations.find(
      o => o.path === "/api/storage-upload-url"
    )!;

    it("requires ClientUploadUrlRequest", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ClientUploadUrlRequest",
      });
    });

    it("200 returns ClientUploadUrlResponse", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ClientUploadUrlResponse",
      });
    });
  });

  describe("GET /api/media (list)", () => {
    const op = mediaModule.operations.find(
      o => o.method === "GET" && o.path === "/api/media"
    )!;

    it("exposes the documented filter / pagination query params", () => {
      const names = op.parameters.map(p => p.name).sort();
      expect(names).toEqual([
        "folderId",
        "limit",
        "page",
        "search",
        "sortBy",
        "sortOrder",
        "type",
      ]);
    });

    it("200 references ListResponseMedia", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/ListResponseMedia",
      });
    });
  });

  describe("GET /api/media/{id}", () => {
    const op = mediaModule.operations.find(
      o => o.method === "GET" && o.path === "/api/media/{id}"
    )!;

    it("returns a bare Media doc on 200", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({ $ref: "#/components/schemas/Media" });
    });

    it("declares a 404", () => {
      expect(op.responses["404"]).toEqual({
        $ref: "#/components/responses/NotFound",
      });
    });
  });

  describe("PATCH /api/media/{id}/move", () => {
    const op = mediaModule.operations.find(
      o => o.path === "/api/media/{id}/move"
    )!;

    it("body is MoveMediaRequest", () => {
      const schema = op.requestBody?.content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/MoveMediaRequest",
      });
    });

    it("200 returns MoveMediaResponse with id + folderId echo", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/MoveMediaResponse",
      });
    });
  });

  describe("GET /api/media-folders/{id}/contents", () => {
    const op = mediaModule.operations.find(
      o => o.path === "/api/media-folders/{id}/contents"
    )!;

    it("200 returns FolderContents", () => {
      const schema = (
        op.responses["200"] as {
          content?: { "application/json"?: { schema?: unknown } };
        }
      ).content?.["application/json"]?.schema;
      expect(schema).toEqual({
        $ref: "#/components/schemas/FolderContents",
      });
    });
  });

  describe("GET /api/media-folders/root/contents (no path params)", () => {
    const op = mediaModule.operations.find(
      o => o.path === "/api/media-folders/root/contents"
    )!;

    it("declares no path parameters", () => {
      const pathParams = op.parameters.filter(p => p.in === "path");
      expect(pathParams).toHaveLength(0);
    });
  });

  describe("registered schemas", () => {
    const schemas = mediaModule.schemas ?? {};

    it("registers every schema referenced by the operations", () => {
      const names = Object.keys(schemas).sort();
      expect(names).toEqual([
        "BulkDeleteMediaRequest",
        "BulkDeleteMediaResponse",
        "BulkUploadMediaRequest",
        "BulkUploadMediaResponse",
        "ClientUploadUrlRequest",
        "ClientUploadUrlResponse",
        "CreateFolderRequest",
        "FolderContents",
        "ListMediaFoldersResponse",
        "ListResponseMedia",
        "ListResponseUploadResult",
        "Media",
        "MediaFolder",
        "MoveMediaRequest",
        "MoveMediaResponse",
        "MutationResponseMedia",
        "MutationResponseMediaFolder",
        "MutationResponseUploadResult",
        "UpdateFolderRequest",
        "UpdateMediaRequest",
        "UploadDeletedResponse",
        "UploadResult",
      ]);
    });

    it("Media schema requires id + filename + mimeType + url + size + uploadedAt", () => {
      const schema = schemas.Media as {
        required?: string[];
        properties?: Record<string, { format?: string }>;
      };
      expect(schema.required).toEqual([
        "id",
        "filename",
        "mimeType",
        "size",
        "url",
        "uploadedAt",
      ]);
      expect(schema.properties?.uploadedAt?.format).toBe("date-time");
      expect(schema.properties?.updatedAt?.format).toBe("date-time");
    });

    it("MediaFolder requires id + name + createdBy + timestamps", () => {
      const schema = schemas.MediaFolder as { required?: string[] };
      expect(schema.required).toEqual([
        "id",
        "name",
        "createdBy",
        "createdAt",
        "updatedAt",
      ]);
    });

    it("FolderContents echoes the service shape (folder + subfolders + files + breadcrumbs)", () => {
      const schema = schemas.FolderContents as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const propNames = Object.keys(schema.properties ?? {}).sort();
      expect(propNames).toEqual([
        "breadcrumbs",
        "files",
        "folder",
        "subfolders",
      ]);
    });

    it("ClientUploadUrlRequest requires filename + mimeType + collection", () => {
      const schema = schemas.ClientUploadUrlRequest as { required?: string[] };
      expect(schema.required).toEqual(["filename", "mimeType", "collection"]);
    });

    it("ClientUploadUrlResponse carries uploadUrl + path + method + expiresAt", () => {
      const schema = schemas.ClientUploadUrlResponse as {
        required?: string[];
        properties?: Record<string, { enum?: string[]; format?: string }>;
      };
      expect(schema.required).toEqual([
        "uploadUrl",
        "path",
        "method",
        "expiresAt",
      ]);
      expect(schema.properties?.method?.enum).toEqual(["PUT", "POST"]);
      expect(schema.properties?.expiresAt?.format).toBe("date-time");
    });

    it("BulkUploadMediaRequest carries a files array of base64-encoded entries", () => {
      const schema = schemas.BulkUploadMediaRequest as {
        required?: string[];
        properties?: {
          files?: {
            type?: string;
            items?: { required?: string[] };
          };
        };
      };
      expect(schema.required).toEqual(["files"]);
      expect(schema.properties?.files?.type).toBe("array");
      expect(schema.properties?.files?.items?.required).toEqual([
        "file",
        "filename",
        "mimeType",
        "size",
      ]);
    });

    it("BulkUploadMediaResponse uses the shared BulkUploadItemError envelope", () => {
      const schema = schemas.BulkUploadMediaResponse as {
        properties?: {
          errors?: { items?: { $ref?: string } };
        };
      };
      expect(schema.properties?.errors?.items).toEqual({
        $ref: "#/components/schemas/BulkUploadItemError",
      });
    });

    it("BulkDeleteMediaResponse uses the shared BulkItemError envelope", () => {
      const schema = schemas.BulkDeleteMediaResponse as {
        properties?: {
          errors?: { items?: { $ref?: string } };
        };
      };
      expect(schema.properties?.errors?.items).toEqual({
        $ref: "#/components/schemas/BulkItemError",
      });
    });
  });
});
