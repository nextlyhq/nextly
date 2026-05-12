/**
 * Internal Intermediate Representation for the OpenAPI generator.
 *
 * Decoupled from OAS serialization so each generator phase (collect, infer,
 * merge, transform) operates on a stable internal model. Only `serialize.ts`
 * knows about OAS dialect specifics; everything upstream uses this IR.
 *
 * Spec: §5.1 (module layout), §10.2 (`versions` field reserved for future
 * path-versioning), §11.6 (etag fingerprint inputs).
 *
 * @module nextly/openapi/ir
 */

import type { OpenAPIV3_1 } from "openapi-types";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

/** A reusable schema (inline object or `$ref` to a registered component). */
export type SchemaIR = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;

/** A single HTTP operation. */
export interface OperationIR {
  /** Path template, e.g. `/api/posts/{id}`. */
  path: string;
  method: HttpMethod;
  /**
   * Versions this operation is part of. Dormant in Phase 1: defaults to
   * `["1.0"]` for every operation. Reserved for future path-based versioning
   * (see spec §10.3).
   */
  versions: readonly string[];
  /** Unique within the document; used by Scalar for deep-link anchors. */
  operationId: string;
  tags: readonly string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters: readonly ParameterIR[];
  requestBody?: RequestBodyIR;
  responses: ResponseMapIR;
  /** Any-of: each entry is a separate "auth option" for this operation. */
  security: readonly SecurityRequirementIR[];
  /**
   * Free-form OAS extensions, e.g. `{ "x-nextly-since": "0.5.0" }`. Generator
   * phases append to this; serialization spreads it into the operation body.
   */
  extensions: Readonly<Record<`x-${string}`, unknown>>;
}

/** Operation parameter (path, query, header, cookie). */
export interface ParameterIR {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description?: string;
  schema: SchemaIR;
  deprecated?: boolean;
}

/** Request body. */
export interface RequestBodyIR {
  description?: string;
  required: boolean;
  content: Readonly<Record<string, MediaTypeIR>>;
}

/** Media type entry inside a request or response body. */
export interface MediaTypeIR {
  schema: SchemaIR;
  examples?: Readonly<Record<string, { value: unknown; summary?: string }>>;
}

/** Response body for a single status code. */
export interface ResponseIR {
  description: string;
  content?: Readonly<Record<string, MediaTypeIR>>;
  headers?: Readonly<
    Record<string, { schema: SchemaIR; description?: string }>
  >;
}

/** Map of status code -> response (or `$ref` to a registered response). */
export type ResponseMapIR = Readonly<
  Record<string, ResponseIR | OpenAPIV3_1.ReferenceObject>
>;

/**
 * Security requirement: a single entry is one set of schemes that all must
 * be satisfied; an array of entries means any-of. Mirrors OAS exactly.
 */
export type SecurityRequirementIR = Readonly<Record<string, readonly string[]>>;

/** Tag with description and optional external docs link. */
export interface TagIR {
  name: string;
  description?: string;
  externalDocs?: { url: string; description?: string };
}

/** Top-level IR document — what the pipeline produces, fed to `serialize`. */
export interface DocumentIR {
  openapi: "3.1.0" | "3.0.3";
  info: OpenAPIV3_1.InfoObject;
  servers: readonly OpenAPIV3_1.ServerObject[];
  tags: readonly TagIR[];
  operations: readonly OperationIR[];
  components: {
    schemas: Readonly<Record<string, SchemaIR>>;
    responses: Readonly<Record<string, ResponseIR>>;
    parameters: Readonly<Record<string, ParameterIR>>;
    requestBodies: Readonly<Record<string, RequestBodyIR>>;
    securitySchemes: Readonly<Record<string, OpenAPIV3_1.SecuritySchemeObject>>;
  };
  /** Document-level OAS extensions, e.g. `{ "x-nextly-build-sha": "..." }`. */
  extensions: Readonly<Record<`x-${string}`, unknown>>;
}
