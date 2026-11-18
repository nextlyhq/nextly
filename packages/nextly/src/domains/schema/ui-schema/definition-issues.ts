/**
 * The issue codes the Schema Builder's definitions are refused with, each mapped by the CLI to a
 * code of its own. Kept in a module of their own, with nothing imported, so the CLI's error
 * registry and a dry run's report read them without loading the definition's readers.
 *
 * @module domains/schema/ui-schema/definition-issues
 */

/** A relationship whose target neither the configuration nor the definition declares. */
export const RELATION_TARGET_MISSING_ISSUE =
  "NEXTLY_SCHEMA_RELATION_TARGET_MISSING";

/**
 * A Builder entity the newest snapshot records and neither the configuration nor the definition
 * declares now (`assertBuilderDefinitionsKept`).
 */
export const BUILDER_DEFINITION_MISSING_ISSUE =
  "NEXTLY_SCHEMA_BUILDER_DEFINITION_MISSING";
