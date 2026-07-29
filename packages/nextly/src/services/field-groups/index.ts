// Entry point for the field group services. Callers outside the domain import
// from here so the domain layout stays free to move behind it.
export { FieldGroupRegistryService } from "./field-group-registry-service";
export type {
  ComponentReference,
  UpdateComponentOptions,
  CodeFirstComponentConfig,
  SyncComponentResult,
  ListComponentsOptions,
  ListComponentsResult,
  EnrichedComponentSchema,
  EnrichedFieldConfig,
} from "./field-group-registry-service";

export { FieldGroupSchemaService } from "./field-group-schema-service";
export type { SupportedDialect as ComponentSupportedDialect } from "./field-group-schema-service";

export { FieldGroupDataService } from "./field-group-data-service";
export type {
  SaveComponentDataParams,
  DeleteComponentDataParams,
  PopulateComponentDataParams,
  PopulateComponentDataManyParams,
} from "./field-group-data-service";
