/**
 * Components Domain — Public API
 *
 * Services for managing Component (reusable field group) metadata and
 * instance data stored in `comp_{slug}` tables.
 *
 * @module domains/components
 * @since 1.0.0
 */

export { ComponentDataService } from "./services/component-data-service";
export { ComponentMutationService } from "./services/component-mutation-service";
export { ComponentQueryService } from "./services/component-query-service";
export { ComponentRegistryService } from "./services/component-registry-service";
export { ComponentSchemaService } from "./services/component-schema-service";

export type * from "./types";
