// Re-export barrel for the domain service. The parameter types keep component
// wording: they describe the stored `component` field type and its `comp_`
// tables, which are data contracts rather than internal naming.
export {
  FieldGroupDataService,
  type SaveComponentDataParams,
  type DeleteComponentDataParams,
  type PopulateComponentDataParams,
  type PopulateComponentDataManyParams,
} from "../../domains/field-groups/services/field-group-data-service";
