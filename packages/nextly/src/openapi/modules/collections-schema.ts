/**
 * Built-in module: `/api/collections/schema/*`.
 *
 * Schema-Builder REST surface for UI-managed collections. Distinct from
 * the dynamic CRUD routes that the generator auto-emits per collection
 * (T13); these endpoints expose the *schema metadata* itself, plus an
 * export route the admin Schema-Builder uses to render a downloadable
 * `defineConfig({ collections: [...] })` snapshot.
 *
 *   GET    /api/collections/schema              list collection schemas
 *   POST   /api/collections/schema              create collection (Schema Builder)
 *   GET    /api/collections/schema/{slug}       read schema
 *   PATCH  /api/collections/schema/{slug}       update schema
 *   DELETE /api/collections/schema/{slug}       delete collection (UI-created only)
 *   GET    /api/collections/schema/{slug}/export   export as code snippet
 *
 * @module nextly/openapi/modules/collections-schema
 */

import { defineModule } from "../generator/define-module";
import type { OperationIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

import {
  NOT_FOUND_RESPONSE,
  STANDARD_ERROR_RESPONSES,
  STANDARD_SECURITY,
} from "./_shared";

const PATH_SLUG = {
  name: "slug",
  in: "path" as const,
  required: true,
  description: "Collection slug (kebab-case).",
  schema: { type: "string" } satisfies OpenAPISchema,
};

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const CollectionSchema: OpenAPISchema = {
  type: "object",
  required: ["slug", "labels", "fields"],
  properties: {
    slug: { type: "string" },
    labels: {
      type: "object",
      required: ["singular", "plural"],
      properties: {
        singular: { type: "string" },
        plural: { type: "string" },
      },
    },
    description: { type: "string" },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    timestamps: { type: "boolean" },
    source: { type: "string", enum: ["code", "ui"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
};

const CreateCollectionSchemaRequest: OpenAPISchema = {
  type: "object",
  required: ["slug", "labels", "fields"],
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    labels: { type: "object", additionalProperties: true },
    description: { type: "string" },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    timestamps: { type: "boolean" },
  },
  additionalProperties: true,
};

const UpdateCollectionSchemaRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    labels: { type: "object", additionalProperties: true },
    description: { type: "string" },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    timestamps: { type: "boolean" },
  },
  additionalProperties: true,
  description: "Partial update. `slug` is immutable.",
};

const ListCollectionSchemasResponse: OpenAPISchema = {
  type: "object",
  required: ["collections"],
  properties: {
    collections: {
      type: "array",
      items: { $ref: "#/components/schemas/CollectionSchema" },
    },
  },
};

const MutationResponseCollectionSchema: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/CollectionSchema" },
  },
};

const DeleteCollectionSchemaResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "slug"],
  properties: {
    message: { type: "string", example: "Collection deleted." },
    slug: { type: "string" },
  },
};

const ExportCollectionSchemaResponse: OpenAPISchema = {
  type: "object",
  required: ["filename", "content"],
  properties: {
    filename: {
      type: "string",
      description:
        "Recommended filename for the download (e.g. `posts.collection.ts`).",
    },
    content: {
      type: "string",
      description:
        "Generated TypeScript snippet — a single `defineCollection({...})` " +
        "call ready to paste into a `defineConfig` entry.",
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listOp: OperationIR = {
  path: "/api/collections/schema",
  method: "GET",
  versions: ["1.0"],
  operationId: "collectionsSchema.list",
  tags: ["Collections Schema"],
  summary: "List collection schemas",
  parameters: [],
  responses: {
    "200": {
      description: "Collection schema list (non-paginated).",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/ListCollectionSchemasResponse",
          },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createOp: OperationIR = {
  path: "/api/collections/schema",
  method: "POST",
  versions: ["1.0"],
  operationId: "collectionsSchema.create",
  tags: ["Collections Schema"],
  summary: "Create a collection (Schema Builder)",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/CreateCollectionSchemaRequest",
        },
      },
    },
  },
  responses: {
    "201": {
      description: "Collection created.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseCollectionSchema",
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
  path: "/api/collections/schema/{slug}",
  method: "GET",
  versions: ["1.0"],
  operationId: "collectionsSchema.findBySlug",
  tags: ["Collections Schema"],
  summary: "Get a collection schema",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Collection schema document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CollectionSchema" },
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
  path: "/api/collections/schema/{slug}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "collectionsSchema.update",
  tags: ["Collections Schema"],
  summary: "Update a collection schema",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/UpdateCollectionSchemaRequest",
        },
      },
    },
  },
  responses: {
    "200": {
      description: "Collection schema updated.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseCollectionSchema",
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
  path: "/api/collections/schema/{slug}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "collectionsSchema.delete",
  tags: ["Collections Schema"],
  summary: "Delete a collection schema",
  description: "Code-sourced collections cannot be deleted via the API.",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Collection deleted.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/DeleteCollectionSchemaResponse",
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

const exportOp: OperationIR = {
  path: "/api/collections/schema/{slug}/export",
  method: "GET",
  versions: ["1.0"],
  operationId: "collectionsSchema.export",
  tags: ["Collections Schema"],
  summary: "Export a collection schema as TypeScript",
  description:
    "Returns a TypeScript snippet ready to paste into the app's " +
    "`defineConfig({ collections })` call — useful for migrating UI-built " +
    "collections back to code-first.",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Snippet bundle.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/ExportCollectionSchemaResponse",
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

export const collectionsSchemaModule = defineModule({
  name: "collections-schema",
  tag: {
    name: "Collections Schema",
    description:
      "Schema-Builder collection metadata: CRUD plus TypeScript snippet export.",
  },
  operations: [listOp, createOp, getOp, updateOp, deleteOp, exportOp],
  schemas: {
    CollectionSchema,
    CreateCollectionSchemaRequest,
    UpdateCollectionSchemaRequest,
    ListCollectionSchemasResponse,
    MutationResponseCollectionSchema,
    DeleteCollectionSchemaResponse,
    ExportCollectionSchemaResponse,
  },
});
