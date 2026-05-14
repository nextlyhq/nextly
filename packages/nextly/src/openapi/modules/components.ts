/**
 * Built-in module: `/api/components/*`.
 *
 * Schema-Builder REST surface for reusable components. Mirrors the
 * handlers in `packages/nextly/src/api/components*.ts` and the
 * preview/apply routes wired through
 * `src/route-handler/route-parser.ts`:
 *
 *   GET    /api/components                                  list components
 *   POST   /api/components                                  create component
 *   GET    /api/components/{slug}                           read component
 *   PATCH  /api/components/{slug}                           update component
 *   DELETE /api/components/{slug}                           delete component
 *   POST   /api/components/schema/{slug}/preview            preview diff
 *   POST   /api/components/schema/{slug}/apply              apply diff
 *
 * Preview / apply are the two-step Schema-Builder flow: preview returns
 * the diff + planned migrations; apply runs them after the user confirms.
 *
 * @module nextly/openapi/modules/components
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
  description: "Component slug (kebab-case).",
  schema: { type: "string" } satisfies OpenAPISchema,
};

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const Component: OpenAPISchema = {
  type: "object",
  required: ["slug", "label", "fields"],
  properties: {
    slug: { type: "string", description: "kebab-case identifier." },
    label: {
      type: "object",
      required: ["singular"],
      properties: {
        singular: { type: "string" },
        plural: { type: "string" },
      },
    },
    description: { type: "string" },
    fields: {
      type: "array",
      description:
        "Field definitions (text / select / repeater / etc.). The full " +
        "field-config union is documented inline on each collection schema.",
      items: { type: "object", additionalProperties: true },
    },
    source: {
      type: "string",
      enum: ["code", "ui"],
      description:
        "Where the component was declared. `code` comes from " +
        "`defineConfig({ components })`; `ui` is Schema-Builder-managed.",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: true,
};

const CreateComponentRequest: OpenAPISchema = {
  type: "object",
  required: ["slug", "label", "fields"],
  properties: {
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    label: { type: "object", additionalProperties: true },
    description: { type: "string" },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  additionalProperties: true,
};

const UpdateComponentRequest: OpenAPISchema = {
  type: "object",
  required: [],
  properties: {
    label: { type: "object", additionalProperties: true },
    description: { type: "string" },
    fields: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  additionalProperties: true,
  description:
    "Partial update. `slug` is immutable; pass it via the path parameter.",
};

const SchemaChangePreview: OpenAPISchema = {
  type: "object",
  required: ["diff"],
  properties: {
    diff: {
      type: "object",
      additionalProperties: true,
      description:
        "Structured diff of the proposed change (added/removed/renamed " +
        "fields, type changes). Shape is stable per major; consumers " +
        "should treat unknown keys as additive.",
    },
    migrations: {
      type: "array",
      items: { type: "string" },
      description:
        "SQL / structural migrations that `apply` will run if the user " +
        "confirms. Empty when the change is metadata-only.",
    },
    warnings: { type: "array", items: { type: "string" } },
  },
};

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
    /**
     * The handler accepts the preview token returned by `/preview` to ensure
     * the apply targets the exact diff the user reviewed. Optional in v1 —
     * callers without it run the diff again against the live schema.
     */
    previewToken: { type: "string" },
  },
};

const SchemaApplyResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "applied"],
  properties: {
    message: { type: "string", example: "Schema applied." },
    applied: {
      type: "object",
      additionalProperties: true,
      description: "Summary of executed migrations and final field set.",
    },
  },
};

const ListComponentsResponse: OpenAPISchema = {
  type: "object",
  required: ["components"],
  properties: {
    components: {
      type: "array",
      items: { $ref: "#/components/schemas/Component" },
    },
  },
};

const MutationResponseComponent: OpenAPISchema = {
  type: "object",
  required: ["message", "item"],
  properties: {
    message: { type: "string" },
    item: { $ref: "#/components/schemas/Component" },
  },
};

const DeleteComponentResponse: OpenAPISchema = {
  type: "object",
  required: ["message", "slug"],
  properties: {
    message: { type: "string", example: "Component deleted." },
    slug: { type: "string" },
  },
};

// ────────────────────────────────────────────────────────────────────
// Operations
// ────────────────────────────────────────────────────────────────────

const listOp: OperationIR = {
  path: "/api/components",
  method: "GET",
  versions: ["1.0"],
  operationId: "components.list",
  tags: ["Components"],
  summary: "List components",
  parameters: [],
  responses: {
    "200": {
      description: "Component list (non-paginated).",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ListComponentsResponse" },
        },
      },
    },
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const createOp: OperationIR = {
  path: "/api/components",
  method: "POST",
  versions: ["1.0"],
  operationId: "components.create",
  tags: ["Components"],
  summary: "Create a component",
  parameters: [],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CreateComponentRequest" },
      },
    },
  },
  responses: {
    "201": {
      description: "Component created.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseComponent" },
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
  path: "/api/components/{slug}",
  method: "GET",
  versions: ["1.0"],
  operationId: "components.findBySlug",
  tags: ["Components"],
  summary: "Get a component",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Component document.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Component" },
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
  path: "/api/components/{slug}",
  method: "PATCH",
  versions: ["1.0"],
  operationId: "components.update",
  tags: ["Components"],
  summary: "Update a component",
  parameters: [PATH_SLUG],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/UpdateComponentRequest" },
      },
    },
  },
  responses: {
    "200": {
      description: "Component updated.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/MutationResponseComponent" },
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
  path: "/api/components/{slug}",
  method: "DELETE",
  versions: ["1.0"],
  operationId: "components.delete",
  tags: ["Components"],
  summary: "Delete a component",
  description: "Code-sourced components cannot be deleted via the API.",
  parameters: [PATH_SLUG],
  responses: {
    "200": {
      description: "Component deleted.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DeleteComponentResponse" },
        },
      },
    },
    ...NOT_FOUND_RESPONSE,
    ...STANDARD_ERROR_RESPONSES,
  },
  security: STANDARD_SECURITY,
  extensions: {},
};

const previewOp: OperationIR = {
  path: "/api/components/schema/{slug}/preview",
  method: "POST",
  versions: ["1.0"],
  operationId: "components.previewSchema",
  tags: ["Components"],
  summary: "Preview schema changes",
  description:
    "Returns a structured diff and the migrations that would run. No " +
    "side effects.",
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

const applyOp: OperationIR = {
  path: "/api/components/schema/{slug}/apply",
  method: "POST",
  versions: ["1.0"],
  operationId: "components.applySchema",
  tags: ["Components"],
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

export const componentsModule = defineModule({
  name: "components",
  tag: {
    name: "Components",
    description:
      "Reusable component definitions (Schema-Builder + code-defined) and the preview/apply migration flow.",
  },
  operations: [listOp, createOp, getOp, updateOp, deleteOp, previewOp, applyOp],
  schemas: {
    Component,
    CreateComponentRequest,
    UpdateComponentRequest,
    SchemaPreviewRequest,
    SchemaApplyRequest,
    SchemaChangePreview,
    SchemaApplyResponse,
    ListComponentsResponse,
    MutationResponseComponent,
    DeleteComponentResponse,
  },
});
