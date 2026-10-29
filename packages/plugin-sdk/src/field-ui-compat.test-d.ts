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
 * kit. A shared picker and settings panel are to replace it, and the parts
 * plugins use today must keep working, unchanged, for at least one release
 * after that ships, so no plugin breaks without notice.
 *
 * The consumer's props are FROZEN below as literal copies of the shapes these
 * parts take today, deliberately not imported from the admin or derived from
 * the exported prop types: a consumer derived from the current types changes
 * along with them, and would pass against any break. Each part is then held to
 * two checks, because each catches a break the other cannot:
 * - today's props are still accepted (`toExtend`), which fails on a new
 *   required prop, a prop narrowed, a callback handed something wider than
 *   today's handlers take, or a value a consumer reads that is wider than
 *   today's;
 * - every prop a consumer may pass today is still declared (`keyof`), which
 *   fails on a prop removed or renamed, since a props object with one key too
 *   many is still assignable to the type without it.
 * A part whose props resolved to `any` would pass both, so each is also held
 * to not being `any`.
 *
 * This stays until the release that removes these parts. Changing a frozen
 * shape to make this pass is changing what plugins were promised.
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
// The field-UI value exports, by name. The render test names the same set; a
// name dropped from the entry fails here as well as at the import above.

type TodayFieldUiExport =
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
// The components accept today's props.

/** Two built-in types a surface passes as `types`, the admin's own way. */
type BuiltInPick = "text" | "number";
/** A surface's own types passed as `entries`, the Form Builder's way. */
type OwnPick = "text" | "rating";

type PickerByTypes = Parameters<typeof FieldTypePicker<BuiltInPick>>[0];
type PickerByEntries = Parameters<typeof FieldTypePicker<OwnPick>>[0];
type PickerByAnyString = Parameters<typeof FieldTypePicker<string>>[0];

expectTypeOf<PickerByTypes>().not.toBeAny();
expectTypeOf<
  TodayFieldTypePickerProps<BuiltInPick>
>().toExtend<PickerByTypes>();
expectTypeOf<TodayFieldTypePickerProps<OwnPick>>().toExtend<PickerByEntries>();
expectTypeOf<TodayFieldTypePickerProps<string>>().toExtend<PickerByAnyString>();
expectTypeOf<keyof TodayFieldTypePickerProps<string>>().toExtend<
  keyof PickerByAnyString
>();

type DefaultValueInputProps = Parameters<typeof FieldDefaultValueInput>[0];
expectTypeOf<DefaultValueInputProps>().not.toBeAny();
expectTypeOf<TodayFieldDefaultValueInputProps>().toExtend<DefaultValueInputProps>();
expectTypeOf<keyof TodayFieldDefaultValueInputProps>().toExtend<
  keyof DefaultValueInputProps
>();

type OptionsEditorProps = Parameters<typeof FieldOptionsEditor>[0];
expectTypeOf<OptionsEditorProps>().not.toBeAny();
expectTypeOf<TodayFieldOptionsEditorProps>().toExtend<OptionsEditorProps>();
expectTypeOf<keyof TodayFieldOptionsEditorProps>().toExtend<
  keyof OptionsEditorProps
>();

type RowProps = Parameters<typeof ConditionRow>[0];
expectTypeOf<RowProps>().not.toBeAny();
expectTypeOf<TodayConditionRowProps>().toExtend<RowProps>();
expectTypeOf<keyof TodayConditionRowProps>().toExtend<keyof RowProps>();

type NumberFieldProps = Parameters<typeof ValidationNumberField>[0];
expectTypeOf<NumberFieldProps>().not.toBeAny();
expectTypeOf<TodayValidationNumberFieldProps>().toExtend<NumberFieldProps>();
expectTypeOf<keyof TodayValidationNumberFieldProps>().toExtend<
  keyof NumberFieldProps
>();

type RulesEditorProps = Parameters<typeof ValidationRulesEditor>[0];
expectTypeOf<RulesEditorProps>().not.toBeAny();
expectTypeOf<TodayValidationRulesEditorProps>().toExtend<RulesEditorProps>();
expectTypeOf<keyof TodayValidationRulesEditorProps>().toExtend<
  keyof RulesEditorProps
>();

// ---------------------------------------------------------------------------
// The exported prop and data types still describe today's shapes, for a plugin
// that names them (`const props: FieldOptionsEditorProps = …`).

expectTypeOf<TodayFieldTypePickerProps<string>>().toExtend<
  FieldTypePickerProps<string>
>();
expectTypeOf<keyof TodayFieldTypePickerProps<string>>().toExtend<
  keyof FieldTypePickerProps<string>
>();
expectTypeOf<TodayFieldDefaultValueInputProps>().toExtend<FieldDefaultValueInputProps>();
expectTypeOf<keyof TodayFieldDefaultValueInputProps>().toExtend<
  keyof FieldDefaultValueInputProps
>();
expectTypeOf<TodayFieldOptionsEditorProps>().toExtend<FieldOptionsEditorProps>();
expectTypeOf<keyof TodayFieldOptionsEditorProps>().toExtend<
  keyof FieldOptionsEditorProps
>();
expectTypeOf<TodayConditionRowProps>().toExtend<ConditionRowProps>();
expectTypeOf<keyof TodayConditionRowProps>().toExtend<
  keyof ConditionRowProps
>();
expectTypeOf<TodayValidationNumberFieldProps>().toExtend<ValidationNumberFieldProps>();
expectTypeOf<keyof TodayValidationNumberFieldProps>().toExtend<
  keyof ValidationNumberFieldProps
>();
expectTypeOf<TodayValidationRulesEditorProps>().toExtend<ValidationRulesEditorProps>();
expectTypeOf<keyof TodayValidationRulesEditorProps>().toExtend<
  keyof ValidationRulesEditorProps
>();

// The data a consumer builds and the data it is handed back, both ways: what
// a plugin builds must still be accepted, and what it reads must still fit
// the shape it reads it into.
expectTypeOf<TodayDefaultOption>().toExtend<FieldDefaultOption>();
expectTypeOf<FieldOption>().toExtend<TodayFieldOption>();
expectTypeOf<TodayFieldOption>().toExtend<FieldOption>();
expectTypeOf<ConditionValue>().toExtend<TodayConditionValue>();
expectTypeOf<TodayConditionValue>().toExtend<ConditionValue>();
expectTypeOf<TodayConditionRange>().toExtend<ConditionRange>();
expectTypeOf<TodayConditionSource>().toExtend<ConditionSource>();
expectTypeOf<TodayConditionSourceOption>().toExtend<ConditionSourceOption>();
expectTypeOf<ValidationRuleValues>().toExtend<TodayValidationRuleValues>();
expectTypeOf<TodayValidationRuleValues>().toExtend<ValidationRuleValues>();
expectTypeOf<ConditionOperatorName>().toEqualTypeOf<TodayOperator>();

// ---------------------------------------------------------------------------
// The functions, hook and constant keep today's signatures, as a consumer
// calls them: today's arguments accepted, today's results readable.

expectTypeOf(withOptionIds).toExtend<
  (
    options: ReadonlyArray<{ label: string; value: string }>,
    idPrefix?: string
  ) => TodayFieldOption[]
>();
expectTypeOf(usePluginFieldTypeEntries).toExtend<
  (surface: TodaySurface) => TodayCatalogEntry<string>[]
>();
expectTypeOf(operatorsForType).toExtend<
  (sourceType: string | undefined) => TodayOperator[]
>();
expectTypeOf(operatorTakesValue).toExtend<
  (operator: TodayOperator) => boolean
>();
expectTypeOf(drawsAnyValidationRule).toExtend<
  (allowed: readonly TodayValidationRule[]) => boolean
>();
expectTypeOf(EDITABLE_VALIDATION_RULES).toExtend<
  readonly TodayValidationRule[]
>();
expectTypeOf(EDITABLE_VALIDATION_RULES).not.toBeAny();
