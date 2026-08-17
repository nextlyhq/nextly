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

// Merges plugin-contributed field types for a picker surface into catalog rows
// a FieldTypePicker renders; a surface passes the result alongside its built-in
// entries so plugin types appear in the picker, surface-filtered.
export { usePluginFieldTypeEntries } from "./usePluginFieldTypeEntries";
// Reads the PUBLIC configuration a plugin declared in
// `contributes.admin.clientConfig`, delivered through `/api/admin-meta`. It is
// how a plugin's server-side config reaches its own browser components, which
// nothing else carries it to.
export { usePluginClientConfig } from "./usePluginClientConfig";

// One condition, edited as source / operator / value. The ROW is what surfaces
// share; the container is not — the schema builder shows exactly one and the
// form builder a list with its own enable/action/joiner chrome. Neutral about
// the caller's field model: a surface passes {name,label,type}, not its own
// field objects.
export {
  ConditionRow,
  operatorsForType,
  operatorTakesValue,
} from "./ConditionRow";
export type {
  ConditionOperatorName,
  ConditionRange,
  ConditionRowProps,
  ConditionSource,
  ConditionSourceOption,
  ConditionValue,
} from "./ConditionRow";

// One numeric validation bound: label, control, optional help text. Owns the
// empty-means-unset coercion, the whole/non-negative constraint for bounds that
// count things, and its own id — the three details the surfaces that drew this
// control independently disagreed about.
export { ValidationNumberField } from "./ValidationNumberField";
export type { ValidationNumberFieldProps } from "./ValidationNumberField";
