/**
 * Type-level test: each field-UI export type-checks against a consumer of
 * today's props. Checked by `tsc --noEmit` (check-types). Every import below
 * names the published `@nextlyhq/plugin-sdk/admin` entry, as a plugin does,
 * never the admin. Inside this package TypeScript maps that entry's `dist`
 * declarations back to `src/admin.ts`, the source they are emitted from, so a
 * change to the entry fails here before a build; the render test beside this
 * loads the built entry itself.
 *
 * Plugins, the Form Builder among them, build their field editors from this
 * kit. It is `@experimental` (STABILITY.md), and a shared picker and settings
 * panel are to replace it. Replacing it is not a reason to break it: these
 * parts are to keep working, unchanged, beside their replacements and through
 * at least one release in which they are marked deprecated, so no plugin
 * breaks without notice. This holds them to that from now, before anything
 * that replaces them lands.
 *
 * The consumer's props are FROZEN below as literal copies of the shapes these
 * parts take today, deliberately not imported from the admin or derived from
 * the exported prop types: a consumer derived from the current types changes
 * along with them, and would pass against any break. Every published shape (each
 * component's props, each exported prop and data type, each function, the hook
 * and the constant) is then pinned EXACTLY to its frozen copy, in one table at
 * the end: a prop added, removed, renamed, narrowed or widened, a callback's
 * parameter changed, or a member at any depth that became `any`, `never` or
 * `unknown` each make the two types differ.
 *
 * This stays until the release that removes these parts. Changing a frozen
 * shape to make this pass is changing what plugins are promised: only a
 * deliberate, compatible addition may update it, in the same change.
 */
import { expectTypeOf } from "vitest";

import * as adminEntry from "@nextlyhq/plugin-sdk/admin";
import {
  ConditionRow,
  drawsAnyValidationRule,
  EDITABLE_VALIDATION_RULES,
  FieldDefaultValueInput,
  FieldOptionsEditor,
  FieldTypePicker,
  operatorsForType,
  operatorTakesValue,
  usePluginFieldTypeEntries,
  ValidationNumberField,
  ValidationRulesEditor,
  withOptionIds,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  ConditionOperatorName,
  ConditionRange,
  ConditionRowProps,
  ConditionSource,
  ConditionSourceOption,
  ConditionValue,
  FieldDefaultOption,
  FieldDefaultValueInputProps,
  FieldOption,
  FieldOptionsEditorProps,
  FieldTypePickerProps,
  ValidationNumberFieldProps,
  ValidationRulesEditorProps,
  ValidationRuleValues,
} from "@nextlyhq/plugin-sdk/admin";

// ---------------------------------------------------------------------------
// The field-UI value exports, by name. The render test takes its cases from
// this one list, so the two halves cannot cover different sets; a name dropped
// from the entry fails here as well as at the import above.

export type TodayFieldUiExport =
  | "FieldTypePicker"
  | "FieldDefaultValueInput"
  | "FieldOptionsEditor"
  | "withOptionIds"
  | "usePluginFieldTypeEntries"
  | "ConditionRow"
  | "operatorsForType"
  | "operatorTakesValue"
  | "ValidationNumberField"
  | "ValidationRulesEditor"
  | "drawsAnyValidationRule"
  | "EDITABLE_VALIDATION_RULES";

expectTypeOf<TodayFieldUiExport>().toExtend<keyof typeof adminEntry>();

// ---------------------------------------------------------------------------
// Today's vocabularies, as literal unions.

/** The built-in field types a picker's `types` may name today. */
type TodayFieldType =
  | "text"
  | "textarea"
  | "richText"
  | "email"
  | "password"
  | "code"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "radio"
  | "upload"
  | "relationship"
  | "repeater"
  | "group"
  | "json"
  | "component"
  | "fieldGroup"
  | "chips";

type TodayFieldTypeCategory =
  | "Basic"
  | "Advanced"
  | "Media"
  | "Relational"
  | "Structured";

type TodaySurface = "entries" | "users" | "forms" | "blocks";

type TodayValidationRule =
  | "required"
  | "pattern"
  | "message"
  | "minLength"
  | "maxLength"
  | "min"
  | "max"
  | "minRows"
  | "maxRows";

type TodayOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual"
  | "between"
  | "before"
  | "after"
  | "isTrue"
  | "isNotTrue";

// ---------------------------------------------------------------------------
// Today's data shapes and props, frozen.

interface TodayCatalogEntry<T extends string> {
  type: T;
  label: string;
  category: TodayFieldTypeCategory;
  hint: string;
  icon: string;
}

interface TodayFieldTypePickerProps<T extends string> {
  types?: readonly (T & TodayFieldType)[];
  entries?: readonly TodayCatalogEntry<T>[];
  value: T;
  onChange: (type: T) => void;
  disabled?: boolean;
  columns?: 2 | 3 | 4;
  ariaLabel?: string;
}

interface TodayDefaultOption {
  label: string;
  value: string;
}

interface TodayFieldDefaultValueInputProps {
  fieldType: string;
  options?: readonly TodayDefaultOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

interface TodayFieldOption {
  id: string;
  label: string;
  value: string;
}

interface TodayFieldOptionsEditorProps {
  options: readonly TodayFieldOption[];
  onOptionsChange: (options: TodayFieldOption[]) => void;
  disabled?: boolean;
  allowImport?: boolean;
  idPrefix?: string;
}

interface TodayConditionRange {
  min?: string | number;
  max?: string | number;
}

interface TodayConditionSourceOption {
  value: string;
  label?: string;
}

interface TodayConditionSource {
  name: string;
  label?: string;
  type?: string;
  options?: readonly TodayConditionSourceOption[];
}

interface TodayConditionValue {
  field: string;
  operator: TodayOperator;
  value?: string | number | boolean | TodayConditionRange;
}

interface TodayConditionRowProps {
  condition: TodayConditionValue | undefined;
  sources: readonly TodayConditionSource[];
  readOnly?: boolean;
  operatorsFor?: (sourceType: string | undefined) => TodayOperator[];
  className?: string;
  onChange: (next: TodayConditionValue | undefined) => void;
}

interface TodayValidationNumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  description?: string;
  disabled?: boolean;
  counts?: boolean;
  placeholder?: string;
}

interface TodayValidationRuleValues {
  minLength?: number | undefined;
  maxLength?: number | undefined;
  minRows?: number | undefined;
  maxRows?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  pattern?: string | undefined;
  message?: string | undefined;
}

interface TodayValidationRulesEditorProps {
  allowed: readonly TodayValidationRule[];
  messageDescribes?: "pattern" | "validation";
  value: TodayValidationRuleValues;
  onChange: (next: Partial<TodayValidationRuleValues>) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Every published shape, pinned exactly to today's in one table.
//
// Exactly, not merely "still accepts today's values": a check of
// assignability passes a member that degraded to `any`, `never` or `unknown`,
// a callback whose parameter widened, or a list whose items lost their type,
// at any depth, because each stays assignable one way or the other. Equality
// has no such gap, at any depth, so no case of it has to be thought of one by
// one. The price is that a compatible addition fails here too; that is
// deliberate for parts being replaced, which should not change at all, and a
// deliberate addition updates the frozen copy above in the same change.
//
// Each verdict is `true` or "differs from today's", the table's expected value
// is derived from its own keys, and a failure names the shapes that changed.

/**
 * `true` when the two types are the same type, compared as the checker
 * compares them rather than by assignability: `any`, `unknown` and `never`
 * equal only themselves, and so does every member, at every depth.
 */
type Exactly<Today, Now> =
  (<Probe>() => Probe extends Today ? 1 : 2) extends <
    Probe,
  >() => Probe extends Now ? 1 : 2
    ? true
    : "differs from today's";

/** Two built-in types a surface passes as `types`, the admin's own way. */
type BuiltInPick = "text" | "number";
/** A surface's own types passed as `entries`, the Form Builder's way. */
type OwnPick = "text" | "rating";

/** What each component is rendered with: its own first parameter. */
type PropsOf<Component extends (props: never) => unknown> =
  Parameters<Component>[0];

type FieldUiVerdicts = {
  // The components, by the props they are rendered with.
  "FieldTypePicker, by types": Exactly<
    TodayFieldTypePickerProps<BuiltInPick>,
    PropsOf<typeof FieldTypePicker<BuiltInPick>>
  >;
  "FieldTypePicker, by entries": Exactly<
    TodayFieldTypePickerProps<OwnPick>,
    PropsOf<typeof FieldTypePicker<OwnPick>>
  >;
  FieldDefaultValueInput: Exactly<
    TodayFieldDefaultValueInputProps,
    PropsOf<typeof FieldDefaultValueInput>
  >;
  FieldOptionsEditor: Exactly<
    TodayFieldOptionsEditorProps,
    PropsOf<typeof FieldOptionsEditor>
  >;
  ConditionRow: Exactly<TodayConditionRowProps, PropsOf<typeof ConditionRow>>;
  ValidationNumberField: Exactly<
    TodayValidationNumberFieldProps,
    PropsOf<typeof ValidationNumberField>
  >;
  ValidationRulesEditor: Exactly<
    TodayValidationRulesEditorProps,
    PropsOf<typeof ValidationRulesEditor>
  >;

  // The exported prop types, for a plugin that names them
  // (`const props: FieldOptionsEditorProps = …`).
  FieldTypePickerProps: Exactly<
    TodayFieldTypePickerProps<OwnPick>,
    FieldTypePickerProps<OwnPick>
  >;
  FieldDefaultValueInputProps: Exactly<
    TodayFieldDefaultValueInputProps,
    FieldDefaultValueInputProps
  >;
  FieldOptionsEditorProps: Exactly<
    TodayFieldOptionsEditorProps,
    FieldOptionsEditorProps
  >;
  ConditionRowProps: Exactly<TodayConditionRowProps, ConditionRowProps>;
  ValidationNumberFieldProps: Exactly<
    TodayValidationNumberFieldProps,
    ValidationNumberFieldProps
  >;
  ValidationRulesEditorProps: Exactly<
    TodayValidationRulesEditorProps,
    ValidationRulesEditorProps
  >;

  // The exported data types.
  FieldDefaultOption: Exactly<TodayDefaultOption, FieldDefaultOption>;
  FieldOption: Exactly<TodayFieldOption, FieldOption>;
  ConditionOperatorName: Exactly<TodayOperator, ConditionOperatorName>;
  ConditionRange: Exactly<TodayConditionRange, ConditionRange>;
  ConditionSource: Exactly<TodayConditionSource, ConditionSource>;
  ConditionSourceOption: Exactly<
    TodayConditionSourceOption,
    ConditionSourceOption
  >;
  ConditionValue: Exactly<TodayConditionValue, ConditionValue>;
  ValidationRuleValues: Exactly<
    TodayValidationRuleValues,
    ValidationRuleValues
  >;

  // The functions, hook and constant.
  withOptionIds: Exactly<
    (
      options: ReadonlyArray<{ label: string; value: string }>,
      idPrefix?: string
    ) => TodayFieldOption[],
    typeof withOptionIds
  >;
  usePluginFieldTypeEntries: Exactly<
    (surface: TodaySurface) => TodayCatalogEntry<string>[],
    typeof usePluginFieldTypeEntries
  >;
  operatorsForType: Exactly<
    (sourceType: string | undefined) => TodayOperator[],
    typeof operatorsForType
  >;
  operatorTakesValue: Exactly<
    (operator: TodayOperator) => boolean,
    typeof operatorTakesValue
  >;
  drawsAnyValidationRule: Exactly<
    (allowed: readonly TodayValidationRule[]) => boolean,
    typeof drawsAnyValidationRule
  >;
  EDITABLE_VALIDATION_RULES: Exactly<
    readonly TodayValidationRule[],
    typeof EDITABLE_VALIDATION_RULES
  >;
};

/**
 * Only the shapes that changed. Checked first and on its own because its
 * diagnostic names them: the whole table's elides most of its entries
 * ("... 24 more ...") and so cannot say which shape failed.
 */
type ChangedShapes = {
  [Shape in keyof FieldUiVerdicts as FieldUiVerdicts[Shape] extends true
    ? never
    : Shape]: FieldUiVerdicts[Shape];
};
expectTypeOf<ChangedShapes>().toEqualTypeOf<{}>();

// The whole table as well, which a verdict that resolved to `never` (dropped
// by the projection above) cannot pass.
expectTypeOf<FieldUiVerdicts>().toEqualTypeOf<{
  [Shape in keyof FieldUiVerdicts]: true;
}>();
