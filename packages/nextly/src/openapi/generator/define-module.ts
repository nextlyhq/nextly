/**
 * Type contract + helper for built-in API module contributors.
 *
 * Each built-in module (auth, users, media, email, …) ships as a
 * `ModuleContributor` value: a small bundle of operations + supporting
 * schemas tagged under a single name. The generator pipeline collects
 * these alongside collection / single / component configs and merges
 * everything into the final OpenAPI document.
 *
 * `defineModule()` is an identity function that exists purely for type
 * inference at module call sites — it lets module files declare their
 * contribution in a single `defineModule({ … })` expression while keeping
 * the `ModuleContributor` shape statically checked.
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

/**
 * Identity helper for declaring built-in modules. Exists for type inference;
 * the runtime returns its argument verbatim.
 */
export function defineModule(m: ModuleContributor): ModuleContributor {
  return m;
}
