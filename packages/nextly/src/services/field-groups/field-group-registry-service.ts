// Re-export barrel for the domain service. The exported type names keep
// component wording because they describe the stored `component` field type and
// its references, which are data contracts rather than internal naming.
export {
  FieldGroupRegistryService,
  type ComponentReference,
  type UpdateComponentOptions,
  type CodeFirstComponentConfig,
  type SyncComponentResult,
  type ListComponentsOptions,
  type ListComponentsResult,
  type EnrichedComponentSchema,
  type EnrichedFieldConfig,
} from "../../domains/field-groups/services/field-group-registry-service";
