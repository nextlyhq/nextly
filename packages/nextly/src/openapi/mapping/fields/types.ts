/**
 * FieldMapper interface — the contract every field-type mapper implements.
 *
 * Each mapper takes a `FieldConfig` and a mapping context, and produces two
 * JSON Schemas: one for **request bodies** (input, e.g. POST/PATCH payloads)
 * and one for **response bodies** (output). Most field types produce
 * symmetric input/output, but `password` (writeOnly), `relationship` and
 * `upload` (depth-dependent oneOf), and `richText` (asymmetric Lexical vs
 * HTML+JSON) intentionally differ.
 *
 * Spec: §7 (field-type mapping).
 *
 * @module nextly/openapi/mapping/fields/types
 */

import type { FieldConfig } from "../../../collections/fields/types";
import type { OpenAPIReference, OpenAPISchema } from "../../types";

export interface MappingContext {
  /** Build a `$ref` to a named component schema. */
  schemaRef: (name: string) => OpenAPIReference;
  /**
   * Owning collection / single / component slug — used to name nested
   * schemas (e.g. `PostBlocksItem`) so they don't collide across collections.
   */
  ownerSlug: string;
  /**
   * Dotted field path — included in diagnostic warnings only
   * (`fields[3].blocks[0]`). Never affects the emitted schema.
   */
  fieldPath: string;
}

export interface FieldMapperResult {
  /** Schema used in request bodies (Create, Update). */
  input: OpenAPISchema;
  /** Schema used in response bodies. */
  output: OpenAPISchema;
}

export type FieldMapper<F extends FieldConfig = FieldConfig> = (
  field: F,
  ctx: MappingContext
) => FieldMapperResult;
