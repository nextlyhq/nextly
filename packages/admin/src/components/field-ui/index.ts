/**
 * The shared field-UI kit: the controlled, form-library-agnostic components
 * every field-building surface composes — the admin's own builders and, via
 * `@nextlyhq/plugin-sdk/admin`, plugins. Each surface injects its allowed
 * type subset and owns its storage; these components own how a field type is
 * picked and configured.
 */

export { FieldTypePicker } from "./FieldTypePicker";
export type { FieldTypePickerProps } from "./FieldTypePicker";

export { FieldDefaultValueInput } from "./FieldDefaultValueInput";
export type {
  FieldDefaultOption,
  FieldDefaultValueInputProps,
} from "./FieldDefaultValueInput";

// Controlled options list with drag reorder, auto-generated values, CSV/JSON
// import, and whole-batch duplicate reporting. Owns only the option list; a
// surface layers its own field-admin knobs (multi-select, clearable, ...)
// around it. `withOptionIds` seeds drag ids onto plain {label,value} data.
export { FieldOptionsEditor, withOptionIds } from "./FieldOptionsEditor";
export type {
  FieldOption,
  FieldOptionsEditorProps,
} from "./FieldOptionsEditor";
