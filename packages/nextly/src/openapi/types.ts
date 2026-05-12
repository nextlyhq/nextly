/**
 * Curated OpenAPI 3.1 type re-exports.
 *
 * Only the surface needed by generator phases and (future) user-facing
 * override slots — NOT the entire OAS 3.1 type universe. Keeps the public
 * type surface small and stable; internal IR types stay in `./ir/types`.
 *
 * Phase 1: used internally only. Phase 2 (Task 24) re-exports a subset
 * from the public `nextly/openapi` entry for `defineOpenApi`,
 * `contribute()`, and `transform()` consumers.
 *
 * @module nextly/openapi/types
 */

import type { OpenAPIV3_1 } from "openapi-types";

export type OpenAPIDocument = OpenAPIV3_1.Document;
export type OpenAPISchema = OpenAPIV3_1.SchemaObject;
export type OpenAPIOperation = OpenAPIV3_1.OperationObject;
export type OpenAPIParameter = OpenAPIV3_1.ParameterObject;
export type OpenAPIResponse = OpenAPIV3_1.ResponseObject;
export type OpenAPIRequestBody = OpenAPIV3_1.RequestBodyObject;
export type OpenAPISecurityScheme = OpenAPIV3_1.SecuritySchemeObject;
export type OpenAPITag = OpenAPIV3_1.TagObject;
export type OpenAPIServer = OpenAPIV3_1.ServerObject;
export type OpenAPIReference = OpenAPIV3_1.ReferenceObject;
