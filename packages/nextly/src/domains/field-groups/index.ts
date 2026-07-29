/**
 * Components Domain — Public API
 *
 * Services for managing Component (reusable field group) metadata and
 * instance data stored in `comp_{slug}` tables.
 *
 * @module domains/components
 * @since 1.0.0
 */

export { FieldGroupDataService } from "./services/field-group-data-service";
export { FieldGroupMutationService } from "./services/field-group-mutation-service";
export { FieldGroupQueryService } from "./services/field-group-query-service";
export { FieldGroupRegistryService } from "./services/field-group-registry-service";
export { FieldGroupSchemaService } from "./services/field-group-schema-service";

export type * from "./types";
