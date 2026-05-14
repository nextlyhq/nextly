/**
 * Built-in module: media + uploads + folders + presigned URLs.
 *
 * Mirrors the real handlers in `packages/nextly/src/api/`:
 *
 *   GET    /api/media                                      — media.ts:GET
 *   POST   /api/media                                      — media.ts:POST  (multipart)
 *   GET    /api/media/{id}                                 — media.ts:getMediaById
 *   PATCH  /api/media/{id}                                 — media.ts:updateMedia
 *   DELETE /api/media/{id}                                 — media.ts:deleteMedia
 *   PATCH  /api/media/{id}/move                            — media.ts:moveMediaToFolder
 *   POST   /api/media-bulk                                 — media-bulk.ts:POST
 *   DELETE /api/media-bulk                                 — media-bulk.ts:DELETE
 *   GET    /api/media-folders                              — media-folders.ts:GET
 *   POST   /api/media-folders                              — media-folders.ts:POST
 *   GET    /api/media-folders/{id}                         — media-folders.ts:getFolderById
 *   PATCH  /api/media-folders/{id}                         — media-folders.ts:updateFolder
 *   DELETE /api/media-folders/{id}                         — media-folders.ts:deleteFolder
 *   GET    /api/media-folders/{id}/contents                — media-folders.ts:getFolderContents
 *   GET    /api/media-folders/root/contents                — media-folders.ts:getRootFolderContents
 *   POST   /api/uploads/{slug}                             — uploads.ts:POST  (multipart, per-collection)
 *   GET    /api/uploads/{slug}                             — uploads.ts:GET  (list, empty for now)
 *   GET    /api/uploads/{slug}/{id}                        — uploads.ts:GET  (metadata)
 *   DELETE /api/uploads/{slug}/{id}                        — uploads.ts:DELETE
 *   POST   /api/storage-upload-url                         — storage-upload-url.ts:POST
 *
 * All endpoints require authentication (bearer / cookie / apiKey). Multipart
 * uploads use `multipart/form-data` with a single `file` binary field plus
 * required `uploadedBy` (for /api/media) or optional `_payload` (for
 * /api/uploads/{slug}). The bulk-upload variant accepts JSON with
 * base64-encoded `file` strings — same wire shape the real handler parses.
 *
 * Per-collection upload endpoints (`/api/uploads/{slug}`) are mounted under
 * `/admin/api/collections/{slug}/uploads` in production; documenting them
 * at the top-level `/api/uploads/{slug}` keeps the OpenAPI path tidy while
 * still letting consumers see the slug substitution.
 *
 * The bulk envelopes (`BulkItemError`, `BulkUploadItemError`,
 * `PaginationMeta`) come from the shared envelope components — this module
 * `$ref`s them rather than redefining them.
 *
 * Spec: §8.1 (module inventory), §11.6 (media module).
 *
 * @module nextly/openapi/modules/media
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
  description: "Resource identifier.",
  schema: { type: "string" } satisfies OpenAPISchema,
};

const PATH_SLUG = {
  name: "slug",
  in: "path" as const,
  required: true,
  description: "Collection slug.",
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

const ImageSizeVariant: OpenAPISchema = {
  type: "object",
  required: [
    "url",
    "path",
    "width",
    "height",
    "filesize",
    "mimeType",
    "filename",
  ],
  properties: {
    url: { type: "string", format: "uri" },
    path: { type: "string" },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    filesize: { type: "integer", minimum: 1 },
    mimeType: { type: "string" },
    filename: { type: "string" },
  },
};

const Media: OpenAPISchema = {
  type: "object",
  required: ["id", "filename", "mimeType", "size", "url", "uploadedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    filename: { type: "string" },
    originalFilename: { type: "string" },
    mimeType: { type: "string" },
    size: { type: "integer", minimum: 1 },
    width: { type: ["integer", "null"], minimum: 1 },
    height: { type: ["integer", "null"], minimum: 1 },
    duration: {
      type: ["integer", "null"],
      minimum: 1,
      description: "Duration in seconds for audio/video assets.",
    },
    url: { type: "string", format: "uri" },
    thumbnailUrl: { type: ["string", "null"], format: "uri" },
    focalX: {
      type: ["integer", "null"],
      minimum: 0,
      maximum: 100,
      description: "Horizontal focal point, 0-100 percent.",
    },
    focalY: {
      type: ["integer", "null"],
      minimum: 0,
      maximum: 100,
    },
    sizes: {
      type: ["object", "null"],
      additionalProperties: ImageSizeVariant,
      description:
        "Map keyed by image-size name (e.g. `thumb`, `card`) to the " +
        "generated variant metadata.",
    },
    altText: { type: ["string", "null"] },
    caption: { type: ["string", "null"] },
    tags: { type: ["array", "null"], items: { type: "string" } },
    folderId: { type: ["string", "null"] },
    uploadedBy: { type: ["string", "null"] },
    uploadedAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const MediaFolder: OpenAPISchema = {
  type: "object",
  required: ["id", "name", "createdBy", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    color: { type: ["string", "null"] },
    icon: { type: ["string", "null"] },
    parentId: { type: ["string", "null"] },
    createdBy: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const FolderContents: OpenAPISchema = {
  type: "object",
  required: ["folder", "subfolders", "files", "breadcrumbs"],
  properties: {
    folder: { $ref: "#/components/schemas/MediaFolder" },
    subfolders: {
      type: "array",
      items: { $ref: "#/components/schemas/MediaFolder" },
    },
    files: {
      type: "array",
      items: { $ref: "#/components/schemas/Media" },
    },
    breadcrumbs: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
    },
  },
};

const CreateFolderRequest: OpenAPISchema = {
  type: "object",
  required: ["name", "createdBy"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    color: { type: "string" },
    icon: { type: "string" },
    parentId: { type: ["string", "null"] },
    createdBy: { type: "string" },
  },
};

const UpdateFolderRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    color: { type: "string" },
    icon: { type: "string" },
    parentId: { type: ["string", "null"] },
  },
};

const UpdateMediaRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    altText: { type: "string" },
    caption: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    focalX: { type: "integer", minimum: 0, maximum: 100 },
    focalY: { type: "integer", minimum: 0, maximum: 100 },
  },
};

const MoveMediaRequest: OpenAPISchema = {
  type: "object",
  required: ["folderId"],
  properties: {
    folderId: {
      type: ["string", "null"],
      description: "Target folder id, or null to move to root.",
    },
  },
};

const MoveMediaResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "id", "folderId"],
  properties: {
    message: { type: "string", example: "Media moved." },
    id: { type: "string" },
    folderId: { type: ["string", "null"] },
  },
};

const ListResponseMedia: OpenAPISchema = {
  type: "object",
  required: ["items", "meta"],
  properties: {
    items: { type: "array", items: { $ref: "#/components/schemas/Media" } },
    meta: { $ref: "#/components/schemas/PaginationMeta" },
  },
};

const ListMediaFoldersResponse: OpenAPISchema = {
  type: "object",
  required: ["folders"],
  properties: {
    folders: {
      type: "array",
      items: { $ref: "#/components/schemas/MediaFolder" },
    },
  },
};

const MutationResponseMedia: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/Media" },
  },
};

const MutationResponseMediaFolder: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/MediaFolder" },
  },
};

const BulkUploadMediaRequest: OpenAPISchema = {
  type: "object",
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["file", "filename", "mimeType", "size"],
        properties: {
          file: {
            type: "string",
            description: "Base64-encoded file contents (RFC 4648).",
          },
          filename: { type: "string" },
          mimeType: { type: "string" },
          size: { type: "integer", minimum: 1 },
          uploadedBy: { type: "string", format: "uuid" },
        },
      },
    },
    uploadedBy: {
      type: "string",
      format: "uuid",
      description:
        "Default uploader applied when an entry omits its own `uploadedBy`.",
    },
  },
};

const BulkUploadMediaResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "items", "errors"],
  properties: {
    message: { type: "string" },
    items: { type: "array", items: { $ref: "#/components/schemas/Media" } },
    errors: {
      type: "array",
      items: { $ref: "#/components/schemas/BulkUploadItemError" },
    },
  },
};

const BulkDeleteMediaRequest: OpenAPISchema = {
  type: "object",
  required: ["mediaIds"],
  properties: {
    mediaIds: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
    },
  },
};

const BulkDeleteMediaResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "items", "errors"],
  properties: {
    message: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    errors: {
      type: "array",
      items: { $ref: "#/components/schemas/BulkItemError" },
    },
  },
};

const ClientUploadUrlRequest: OpenAPISchema = {
  type: "object",
  required: ["filename", "mimeType", "collection"],
  properties: {
    filename: { type: "string", minLength: 1 },
    mimeType: { type: "string", minLength: 1 },
    collection: {
      type: "string",
      minLength: 1,
      description:
        "Target collection slug. Must have `clientUploads: true` and a " +
        "storage plugin that supports pre-signed URLs.",
    },
    expiresIn: {
      type: "integer",
      minimum: 1,
      description: "Override URL expiry, in seconds.",
    },
  },
};

const ClientUploadUrlResponse: OpenAPISchema = {
  type: "object",
  required: ["uploadUrl", "path", "method", "expiresAt"],
  properties: {
    uploadUrl: { type: "string", format: "uri" },
    path: {
      type: "string",
      description: "Storage path/key that the upload will land under.",
    },
    method: {
      type: "string",
      enum: ["PUT", "POST"],
      description: "HTTP method the client should use against `uploadUrl`.",
    },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Headers the client must echo back on the upload request.",
    },
    fields: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Form fields some services require for multipart pre-signed uploads.",
    },
    expiresAt: { type: "string", format: "date-time" },
  },
};

const UploadResult: OpenAPISchema = {
  type: "object",
  required: ["id", "filename", "mimeType", "filesize", "url"],
  properties: {
    id: { type: "string" },
    filename: { type: "string" },
    mimeType: { type: "string" },
    filesize: { type: "integer", minimum: 1 },
    url: { type: "string", format: "uri" },
    thumbnailUrl: { type: ["string", "null"], format: "uri" },
    width: { type: ["integer", "null"], minimum: 1 },
    height: { type: ["integer", "null"], minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
  description:
    "Wire shape of an upload record. Extra properties surface user-supplied " +
    "`_payload` data merged into the response.",
};

const UploadDeletedResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "id"],
  properties: {
    message: { type: "string", example: "Upload deleted." },
    id: { type: "string" },
  },
};

const MutationResponseUploadResult: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/UploadResult" },
  },
};

const ListResponseUploadResult: OpenAPISchema = {
  type: "object",
  required: ["items", "meta"],
  properties: {
    items: {
      type: "array",
      items: { $ref: "#/components/schemas/UploadResult" },
    },
    meta: { $ref: "#/components/schemas/PaginationMeta" },
  },
};

// ────────────────────────────────────────────────────────────────────
// Multipart bodies
// ────────────────────────────────────────────────────────────────────

const MEDIA_UPLOAD_MULTIPART: OpenAPISchema = {
  type: "object",
  required: ["file", "uploadedBy"],
  properties: {
    file: {
      type: "string",
      format: "binary",
      description: "Media file binary.",
    },
    uploadedBy: {
      type: "string",
      format: "uuid",
      description: "User id to attribute the upload to.",
    },
    folderId: {
      type: "string",
      description: "Target folder id; omit to upload to the root.",
    },
  },
};

const COLLECTION_UPLOAD_MULTIPART: OpenAPISchema = {
  type: "object",
  required: ["file"],
  properties: {
    file: { type: "string", format: "binary" },
    _payload: {
      type: "string",
      description:
        "Optional JSON-encoded metadata merged into the response body. " +
        "Invalid JSON is silently ignored.",
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listMediaOp: OperationIR = {
  path: "/api/media",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.list",
  tags: ["Media"],
  summary: "List media",
  parameters: [
    {
      name: "page",
      in: "query",
      required: false,
      description: "1-based page number. Defaults to 1.",
      schema: { type: "integer", minimum: 1 },
    },
    {
      name: "limit",
      in: "query",
      required: false,
      description: "Items per page. Defaults to 24.",
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
    {
      name: "search",
      in: "query",
      required: false,
      description: "Substring match against filename / altText.",
      schema: { type: "string" },
    },
    {
      name: "type",
      in: "query",
      required: false,
      description: "Filter by media type.",
      schema: {
        type: "string",
        enum: ["image", "video", "audio", "document", "other"],
      },
    },
    {
      name: "folderId",
      in: "query",
      required: false,
      description: "Filter by folder. Use `root` to list root-level media.",
      schema: { type: "string" },
    },
    {
      name: "sortBy",
      in: "query",
      required: false,
      schema: {
        type: "string",
        enum: ["uploadedAt", "filename", "size"],
      },
    },
    {
      name: "sortOrder",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["asc", "desc"] },
    },
  ],
  responses: {
    "200": {
      description: "Paginated media page.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListResponseMedia" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const uploadMediaOp: OperationIR = {
  path: "/api/media",
  method: "POST",
  versions: ["1.0"],
  operationId: "media.upload",
  tags: ["Media"],
  summary: "Upload a media file",
  description:
    "Multipart upload. Auto-processes images (dimensions + variants per " +
    "configured image sizes). Returns the created `Media` record.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": { schema: MEDIA_UPLOAD_MULTIPART },
    },
  },
  responses: {
    "201": {
      description: "Media uploaded.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseMedia" },
        },
      },
    },
    "413": { $ref: "#/components/responses/PayloadTooLarge" },
    "415": { $ref: "#/components/responses/UnsupportedMediaType" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getMediaByIdOp: OperationIR = {
  path: "/api/media/{id}",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.findById",
  tags: ["Media"],
  summary: "Get a media item",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Media document.",
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/Media" } },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateMediaOp: OperationIR = {
  path: "/api/media/{id}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "media.update",
  tags: ["Media"],
  summary: "Update media metadata",
  parameters: [PATH_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateMediaRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Media updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseMedia" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const deleteMediaOp: OperationIR = {
  path: "/api/media/{id}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "media.delete",
  tags: ["Media"],
  summary: "Delete a media item",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Media deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UploadDeletedResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const moveMediaOp: OperationIR = {
  path: "/api/media/{id}/move",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "media.move",
  tags: ["Media"],
  summary: "Move media to a folder",
  parameters: [PATH_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/MoveMediaRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Media moved.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MoveMediaResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const bulkUploadOp: OperationIR = {
  path: "/api/media-bulk",
  method: "POST",
  versions: ["1.0"],
  operationId: "media.bulkUpload",
  tags: ["Media"],
  summary: "Bulk upload media",
  description:
    "Uploads multiple files in one request. Returns the standard " +
    "`{ message, items, errors }` envelope; per-item failures are first-" +
    "class data, not 4xx. The request is 4xx only when every entry " +
    "failed input validation before reaching the service.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/BulkUploadMediaRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Bulk upload result (partial success allowed).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/BulkUploadMediaResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const bulkDeleteOp: OperationIR = {
  path: "/api/media-bulk",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "media.bulkDelete",
  tags: ["Media"],
  summary: "Bulk delete media",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/BulkDeleteMediaRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Bulk delete result (partial success allowed).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/BulkDeleteMediaResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const listFoldersOp: OperationIR = {
  path: "/api/media-folders",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.listFolders",
  tags: ["Media"],
  summary: "List folders",
  parameters: [
    {
      name: "root",
      in: "query",
      required: false,
      description: "When `true`, returns only root-level folders.",
      schema: { type: "boolean" },
    },
    {
      name: "parentId",
      in: "query",
      required: false,
      description: "List subfolders of the given parent folder.",
      schema: { type: "string" },
    },
  ],
  responses: {
    "200": {
      description: "Folder list (non-paginated).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListMediaFoldersResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createFolderOp: OperationIR = {
  path: "/api/media-folders",
  method: "POST",
  versions: ["1.0"],
  operationId: "media.createFolder",
  tags: ["Media"],
  summary: "Create a folder",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateFolderRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Folder created.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseMediaFolder" },
        },
      },
    },
    "409": { $ref: "#/components/responses/Conflict" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getFolderByIdOp: OperationIR = {
  path: "/api/media-folders/{id}",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.findFolderById",
  tags: ["Media"],
  summary: "Get a folder",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Folder document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MediaFolder" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateFolderOp: OperationIR = {
  path: "/api/media-folders/{id}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "media.updateFolder",
  tags: ["Media"],
  summary: "Update folder metadata",
  parameters: [PATH_ID],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateFolderRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Folder updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseMediaFolder" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const deleteFolderOp: OperationIR = {
  path: "/api/media-folders/{id}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "media.deleteFolder",
  tags: ["Media"],
  summary: "Delete a folder",
  parameters: [
    PATH_ID,
    {
      name: "deleteContents",
      in: "query",
      required: false,
      description:
        "When `true`, also delete every media file and subfolder beneath " +
        "the folder. Defaults to `false` (non-empty folders cannot be " +
        "deleted otherwise).",
      schema: { type: "boolean" },
    },
  ],
  responses: {
    "200": {
      description: "Folder deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UploadDeletedResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const folderContentsOp: OperationIR = {
  path: "/api/media-folders/{id}/contents",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.folderContents",
  tags: ["Media"],
  summary: "List a folder's contents",
  description:
    "Returns the folder, its direct subfolders, the media files it " +
    "contains, and a breadcrumb trail back to the root.",
  parameters: [PATH_ID],
  responses: {
    "200": {
      description: "Folder contents bundle.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/FolderContents" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const rootFolderContentsOp: OperationIR = {
  path: "/api/media-folders/root/contents",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.rootFolderContents",
  tags: ["Media"],
  summary: "List the root folder's contents",
  parameters: [],
  responses: {
    "200": {
      description: "Root contents bundle.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/FolderContents" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const collectionUploadOp: OperationIR = {
  path: "/api/uploads/{slug}",
  method: "POST",
  versions: ["1.0"],
  operationId: "media.collectionUpload",
  tags: ["Media"],
  summary: "Upload a file into a collection",
  description:
    "Per-collection upload endpoint mounted at " +
    "`/admin/api/collections/{slug}/uploads`. Multipart-only, with an " +
    "optional `_payload` JSON metadata field merged into the response.",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": { schema: COLLECTION_UPLOAD_MULTIPART },
    },
  },
  responses: {
    "201": {
      description: "Upload created.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseUploadResult",
          },
        },
      },
    },
    "413": { $ref: "#/components/responses/PayloadTooLarge" },
    "415": { $ref: "#/components/responses/UnsupportedMediaType" },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const collectionUploadListOp: OperationIR = {
  path: "/api/uploads/{slug}",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.collectionUploadList",
  tags: ["Media"],
  summary: "List collection uploads",
  description:
    "Paginated list of uploads for a collection. The current production " +
    "implementation returns an empty page; the envelope is stable for " +
    "consumers regardless.",
  parameters: [
    PATH_SLUG,
    {
      name: "page",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1 },
    },
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
  ],
  responses: {
    "200": {
      description: "Paginated upload page.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListResponseUploadResult" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const collectionUploadGetOp: OperationIR = {
  path: "/api/uploads/{slug}/{id}",
  method: "GET",
  versions: ["1.0"],
  operationId: "media.collectionUploadGet",
  tags: ["Media"],
  summary: "Get collection upload metadata",
  parameters: [PATH_SLUG, PATH_ID],
  responses: {
    "200": {
      description: "Upload metadata.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UploadResult" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const collectionUploadDeleteOp: OperationIR = {
  path: "/api/uploads/{slug}/{id}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "media.collectionUploadDelete",
  tags: ["Media"],
  summary: "Delete a collection upload",
  parameters: [PATH_SLUG, PATH_ID],
  responses: {
    "200": {
      description: "Upload deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UploadDeletedResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const storageUploadUrlOp: OperationIR = {
  path: "/api/storage-upload-url",
  method: "POST",
  versions: ["1.0"],
  operationId: "media.clientUploadUrl",
  tags: ["Media"],
  summary: "Generate a pre-signed client upload URL",
  description:
    "Returns a pre-signed URL the client can PUT/POST directly to the " +
    "storage backend, bypassing the serverless request-body limit. " +
    "Requires the target collection to have `clientUploads: true` and a " +
    "storage adapter that supports pre-signed URLs.",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ClientUploadUrlRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Pre-signed upload URL bundle.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ClientUploadUrlResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const mediaModule = defineModule({
  name: "media",
  tag: {
    name: "Media",
    description:
      "Media library: uploads, downloads, folders, bulk operations, and pre-signed URLs.",
  },
  operations: [
    listMediaOp,
    uploadMediaOp,
    getMediaByIdOp,
    updateMediaOp,
    deleteMediaOp,
    moveMediaOp,
    bulkUploadOp,
    bulkDeleteOp,
    listFoldersOp,
    createFolderOp,
    getFolderByIdOp,
    updateFolderOp,
    deleteFolderOp,
    folderContentsOp,
    rootFolderContentsOp,
    collectionUploadOp,
    collectionUploadListOp,
    collectionUploadGetOp,
    collectionUploadDeleteOp,
    storageUploadUrlOp,
  ],
  schemas: {
    Media,
    MediaFolder,
    FolderContents,
    CreateFolderRequest,
    UpdateFolderRequest,
    UpdateMediaRequest,
    MoveMediaRequest,
    MoveMediaResponse,
    ListResponseMedia,
    ListMediaFoldersResponse,
    MutationResponseMedia,
    MutationResponseMediaFolder,
    MutationResponseUploadResult,
    ListResponseUploadResult,
    BulkUploadMediaRequest,
    BulkUploadMediaResponse,
    BulkDeleteMediaRequest,
    BulkDeleteMediaResponse,
    ClientUploadUrlRequest,
    ClientUploadUrlResponse,
    UploadResult,
    UploadDeletedResponse,
  },
});
