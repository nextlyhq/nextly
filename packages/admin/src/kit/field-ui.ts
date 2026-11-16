/**
 * `@nextlyhq/admin/kit/field-ui`: the field-UI kit.
 *
 * The field picker, the field settings panel and its editors (options,
 * validation, conditions), and the rich-text loaders, with the drag-and-drop
 * and form code they bring.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/field-ui
 */
/**
 * The rich-text editor's nodes and theme, for a surface that must edit this
 * site's rich text with the SAME node registry the field editor uses.
 *
 * A loader rather than the classes themselves: they carry Lexical and PrismJS,
 * which belong behind a dynamic import — see the module for the measurement.
 */
export {
  loadRichTextEditorKit,
  type RichTextEditorKit,
} from "../lib/rich-text/load-editor-kit";

/**
 * ONE rich-text editor, moved between the elements an author edits in place.
 *
 * A loader for the same reason the kit is one, and a controller rather than the
 * editor itself: a consumer handed Lexical would have to import it to use it,
 * and a second declarer of Lexical is what the bundling here exists to prevent.
 */
export {
  loadInlineRichTextEditor,
  type InlineRichTextEditor,
  type InlineRichTextSession,
  type InlineRichTextAttachment,
  type InlineRichTextRefusal,
} from "../lib/rich-text/inline-editor";

// Field-UI kit — controlled, form-library-agnostic field-building components
// (type picker, options editor, default-value input, condition row) rendered
// from the shared `nextly/field-catalog`. Author surface re-exported by
// `@nextlyhq/plugin-sdk/admin`, same as the DataTable above.
export {
  FieldTypePicker,
  FieldDefaultValueInput,
  FieldOptionsEditor,
  withOptionIds,
  usePluginFieldTypeEntries,
  // Reads a plugin's own PUBLIC config from admin metadata; see
  // `usePluginClientConfig`.
  usePluginClientConfig,
} from "../components/field-ui";

// The shared settings panel that adds and edits a field, configured per
// surface. Re-exported by `@nextlyhq/plugin-sdk/admin` as experimental.
export { FieldSettingsPanel } from "../components/field-ui";

export type {
  FieldSettingsControlProps,
  FieldSettingsField,
  FieldSettingsPanelProps,
  FieldSettingsSurface,
  FieldSettingsConditionsProps,
  FieldSettingsSurfaceControlProps,
  FieldSettingsTab,
  FieldTypeSettings,
  FixedFieldSetting,
} from "../components/field-ui";

export {
  FieldPicker,
  describeFieldTypes,
  ConditionRow,
  operatorsForType,
  operatorTakesValue,
  ValidationNumberField,
  ValidationRulesEditor,
  drawsAnyValidationRule,
  EDITABLE_VALIDATION_RULES,
} from "../components/field-ui";

export type {
  FieldPickerProps,
  FieldPickerConfig,
  FieldPickerChoice,
  FieldGroupOption,
  FieldTypeDescription,
  FieldTypePickerProps,
  FieldDefaultValueInputProps,
  FieldDefaultOption,
  FieldOption,
  FieldOptionsEditorProps,
  ConditionOperatorName,
  ConditionRange,
  ConditionRowProps,
  ConditionSource,
  ConditionSourceOption,
  ConditionValue,
  ValidationNumberFieldProps,
  ValidationRulesEditorProps,
  ValidationRuleValues,
} from "../components/field-ui";

export { FormLabelWithTooltip } from "../components/ui/form-label-with-tooltip";

export type { FormLabelWithTooltipProps } from "../components/ui/form-label-with-tooltip";
