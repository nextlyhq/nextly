// Re-export barrel matching the sibling data-service one, so callers outside
// the domain reach the schema service through `services/` rather than importing
// across into `domains/`.
export {
  FieldGroupSchemaService,
  type SupportedDialect,
} from "../../domains/field-groups/services/field-group-schema-service";
