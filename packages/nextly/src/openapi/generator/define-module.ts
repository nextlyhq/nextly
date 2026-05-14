/**
 * Type contract for built-in API module contributors.
 *
 * Each built-in module (auth, users, media, email, …) ships as a
 * `ModuleContributor` value: a small bundle of operations + supporting
 * schemas tagged under a single name. The generator pipeline collects
 * these alongside collection / single / component configs and merges
 * everything into the final OpenAPI document.
 *
 * T17 adds the `defineModule()` identity helper used by individual module
 * files. T12 only needs the type; modules themselves land in T17–T22.
 *
 * @module nextly/openapi/generator/define-module
 */

import type { OperationIR, TagIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

export interface ModuleContributor {
  /** Stable identifier — used for diagnostics and dedupe. */
  name: string;
  /** Optional tag definition (description, externalDocs). */
  tag?: TagIR;
  /** Operations the module contributes. */
  operations: readonly OperationIR[];
  /** Supporting `components/schemas` entries. */
  schemas?: Readonly<Record<string, OpenAPISchema>>;
}
