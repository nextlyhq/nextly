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

// The options editor lives with the schema builder (its richest consumer)
// and is surfaced here under the kit's naming: controlled options list with
// drag reorder, auto-generated values, CSV/JSON import, and whole-batch
// duplicate reporting.
export { SelectOptionsEditor as FieldOptionsEditor } from "../features/schema-builder/SelectOptionsEditor";
export type {
  SelectOption as FieldOption,
  SelectOptionsEditorProps as FieldOptionsEditorProps,
} from "../features/schema-builder/types";
