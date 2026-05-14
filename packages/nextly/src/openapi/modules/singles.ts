/**
 * Built-in module: `/api/singles/*`.
 *
 * Schema-Builder REST surface for UI-managed singles. Distinct from the
 * code-defined singles emitted by `inferFromSingles` — those are
 * declared via `defineConfig({ singles })` and live in the generator's
 * collection-driven envelope, while these endpoints expose the
 * Schema-Builder CRUD + preview/apply migration flow.
 *
 *   GET    /api/singles                                  list singles
 *   POST   /api/singles                                  create single
 *   GET    /api/singles/{slug}                           read document
 *   PATCH  /api/singles/{slug}                           update document
 *   DELETE /api/singles/{slug}                           delete single
 *   GET    /api/singles/{slug}/schema                    read schema
 *   PATCH  /api/singles/{slug}/schema                    update schema
 *   POST   /api/singles/schema/{slug}/preview            preview diff
 *   POST   /api/singles/schema/{slug}/apply              apply diff
 *
 * @module nextly/openapi/modules/singles
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
  description: "Single slug (kebab-case).",
  schema: { type: "string" } satisfies OpenAPISchema,
};

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const SingleSummary: OpenAPISchema = {
  type: "object",
  required: ["slug", "label"],
  properties: {
    slug: { type: "string" },
    label: { type: "object", additionalProperties: true },
    source: { type: "string", enum: ["code", "ui"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
};

const SingleDocument: OpenAPISchema = {
  type: "object",
  additionalProperties: true,
  description:
    "Field values for the single. Shape varies per-slug; consumers " +
    "fetch the schema via `/api/singles/{slug}/schema` to map keys to " +
    "field configs.",
};

const SingleSchema: OpenAPISchema = {
  type: "object",
  required: ["slug", "fields"],
  properties: {
    slug: { type: "string" },
    label: { type: "object", additionalProperties: true },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  additionalProperties: true,
};

const CreateSingleRequest: OpenAPISchema = {
  type: "object",
  required: ["slug", "label", "fields"],
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    label: { type: "object", additionalProperties: true },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  additionalProperties: true,
};

const UpdateSingleDocumentRequest: OpenAPISchema = {
  type: "object",
  additionalProperties: true,
  description: "Partial field-values patch keyed by field name.",
};

const UpdateSingleSchemaRequest: OpenAPISchema = {
  type: "object",
  required: ["fields"],
  properties: {
    label: { type: "object", additionalProperties: true },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
};

const ListSinglesResponse: OpenAPISchema = {
  type: "object",
  required: ["singles"],
  properties: {
    singles: {
      type: "array",
      items: { $ref: "#/components/schemas/SingleSummary" },
    },
  },
};

const MutationResponseSingleSummary: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/SingleSummary" },
  },
};

const MutationResponseSingleDocument: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/SingleDocument" },
  },
};

const DeleteSingleResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "slug"],
  properties: {
    message: { type: "string", example: "Single deleted." },
    slug: { type: "string" },
  },
};

// Reuse the same Schema-Builder preview/apply envelopes the components
// module exposes; both modules `$ref` the same shape under
// `components.schemas.SchemaChangePreview` so generated docs share one
// canonical diff bundle.
const SchemaPreviewRequest: OpenAPISchema = {
  type: "object",
  required: ["fields"],
  properties: {
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
};

const SchemaApplyRequest: OpenAPISchema = {
  type: "object",
  required: ["fields"],
  properties: {
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    previewToken: { type: "string" },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listOp: OperationIR = {
  path: "/api/singles",
  method: "GET",
  versions: ["1.0"],
  operationId: "singles.list",
  tags: ["Singles"],
  summary: "List singles",
  parameters: [],
  responses: {
    "200": {
      description: "Single summaries (non-paginated).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListSinglesResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createOp: OperationIR = {
  path: "/api/singles",
  method: "POST",
  versions: ["1.0"],
  operationId: "singles.create",
  tags: ["Singles"],
  summary: "Create a single",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateSingleRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Single created.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseSingleSummary",
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

const getDocOp: OperationIR = {
  path: "/api/singles/{slug}",
  method: "GET",
  versions: ["1.0"],
  operationId: "singles.findDocBySlug",
  tags: ["Singles"],
  summary: "Get a single document",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Single document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SingleDocument" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateDocOp: OperationIR = {
  path: "/api/singles/{slug}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "singles.updateDoc",
  tags: ["Singles"],
  summary: "Update a single document",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateSingleDocumentRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Single updated.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/MutationResponseSingleDocument",
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
  path: "/api/singles/{slug}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "singles.delete",
  tags: ["Singles"],
  summary: "Delete a single",
  description: "Code-sourced singles cannot be deleted via the API.",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Single deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DeleteSingleResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const getSchemaOp: OperationIR = {
  path: "/api/singles/{slug}/schema",
  method: "GET",
  versions: ["1.0"],
  operationId: "singles.findSchemaBySlug",
  tags: ["Singles"],
  summary: "Get a single's schema",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Schema document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SingleSchema" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const updateSchemaOp: OperationIR = {
  path: "/api/singles/{slug}/schema",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "singles.updateSchema",
  tags: ["Singles"],
  summary: "Update a single's schema",
  description:
    "Direct write to the schema; bypasses the preview/apply flow. Use " +
    "`/api/singles/schema/{slug}/preview` first when running additive or " +
    "destructive field changes against existing data.",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateSingleSchemaRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Schema updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SingleSchema" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const previewSchemaOp: OperationIR = {
  path: "/api/singles/schema/{slug}/preview",
  method: "POST",
  versions: ["1.0"],
  operationId: "singles.previewSchema",
  tags: ["Singles"],
  summary: "Preview schema changes",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SchemaPreviewRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Diff bundle.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SchemaChangePreview" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const applySchemaOp: OperationIR = {
  path: "/api/singles/schema/{slug}/apply",
  method: "POST",
  versions: ["1.0"],
  operationId: "singles.applySchema",
  tags: ["Singles"],
  summary: "Apply confirmed schema changes",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SchemaApplyRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Schema applied.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SchemaApplyResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

export const singlesModule = defineModule({
  name: "singles",
  tag: {
    name: "Singles",
    description:
      "UI-managed singles: document CRUD plus schema editing with preview/apply migrations.",
  },
  operations: [
    listOp,
    createOp,
    getDocOp,
    updateDocOp,
    deleteOp,
    getSchemaOp,
    updateSchemaOp,
    previewSchemaOp,
    applySchemaOp,
  ],
  schemas: {
    SingleSummary,
    SingleDocument,
    SingleSchema,
    CreateSingleRequest,
    UpdateSingleDocumentRequest,
    UpdateSingleSchemaRequest,
    SchemaPreviewRequest,
    SchemaApplyRequest,
    ListSinglesResponse,
    MutationResponseSingleSummary,
    MutationResponseSingleDocument,
    DeleteSingleResponse,
  },
});
