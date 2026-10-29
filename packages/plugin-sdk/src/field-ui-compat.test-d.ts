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
 * and the constant) is then held, in one table at the end, to three checks,
 * because each catches a break the others cannot:
 * - today's values are still accepted where a consumer passes them, and what is
 *   handed back still fits where it reads them, which fails on a new required
 *   prop, a prop narrowed, a callback handed something wider than today's
 *   handlers take, or a result wider than today's;
 * - every member a consumer sets or reads today is still declared (`keyof`),
 *   which fails on one removed or renamed, since an object with one key too
 *   many is still assignable to the type without it;
 * - the shape is not `any`, which would pass both.
 *
 * This stays until the release that removes these parts. Changing a frozen
 * shape to make this pass is changing what plugins are promised.
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
// Every published shape, held to today's in one table.
//
// Each shape gets the same checks, so none can be held to fewer than the rest:
// a list written shape by shape is how a data type came to have no `keyof`
// check and a function no `any` check. Each verdict is `true` or says what
// broke, and the table's expected value is derived from its own keys, so a
// shape added to it is checked by construction.

/**
 * Why a type would check nothing, or `false`. `any` passes every assignability
 * check one way and `never` the other, and `keyof never` holds every key, so a
 * shape, an item of a list or a member typed as either would pass the checks
 * below while a consumer could no longer use it.
 */
type Degenerate<T> = 0 extends 1 & T
  ? "resolved to any"
  : [T] extends [never]
    ? "resolved to never"
    : false;

/** A list's item, so a list is held to what each item carries. */
type Item<T> = T extends readonly (infer Element)[] ? Element : T;

/**
 * Each member today's consumer uses that resolved to `any` or `never`, named,
 * or `never` when there is none.
 */
type DegenerateMembers<Now, Today> = Extract<
  {
    [Key in keyof Item<Today> & keyof Item<Now>]: Degenerate<
      Item<Now>[Key]
    > extends string
      ? `${Key & string} ${Degenerate<Item<Now>[Key]>}`
      : false;
  }[keyof Item<Today> & keyof Item<Now>],
  string
>;

/** The degenerate-type verdict for a shape, its items and its members. */
type Usable<Now, Today> =
  Degenerate<Now> extends string
    ? Degenerate<Now>
    : Degenerate<Item<Now>> extends string
      ? `its items ${Degenerate<Item<Now>>}`
      : [DegenerateMembers<Now, Today>] extends [never]
        ? true
        : DegenerateMembers<Now, Today>;

/**
 * A shape a consumer of today's PASSES values into: usable, today's values
 * still accepted, and every member today's consumer may set still declared.
 */
type Accepts<Today, Now> =
  Usable<Now, Today> extends true
    ? [Today] extends [Now]
      ? [keyof Item<Today>] extends [keyof Item<Now>]
        ? true
        : "drops or renames a member today's consumer sets"
      : "refuses a value today's consumer passes"
    : Usable<Now, Today>;

/**
 * A shape a consumer of today's READS: usable, what it hands back still fits
 * where today's consumer reads it, and every member that consumer reads still
 * there.
 */
type ReadsAs<Now, Today> =
  Usable<Now, Today> extends true
    ? [Now] extends [Today]
      ? [keyof Item<Today>] extends [keyof Item<Now>]
        ? true
        : "drops or renames a member today's consumer reads"
      : "hands back a value today's consumer cannot read"
    : Usable<Now, Today>;

/**
 * A function as today's consumer calls it: today's arguments still accepted,
 * and its result held as a shape that consumer reads. Checked through the
 * result rather than the function type, because a function declared to
 * return `never` is assignable to any signature with the same parameters.
 */
type Calls<Now, TodayArgs extends readonly unknown[], TodayResult> =
  Degenerate<Now> extends string
    ? Degenerate<Now>
    : Now extends (...args: infer Args) => infer Result
      ? [TodayArgs] extends [Args]
        ? ReadsAs<Result, TodayResult> extends true
          ? true
          : `its result ${ReadsAs<Result, TodayResult> & string}`
        : "refuses arguments today's consumer passes"
      : "is no longer callable";

/** Two built-in types a surface passes as `types`, the admin's own way. */
type BuiltInPick = "text" | "number";
/** A surface's own types passed as `entries`, the Form Builder's way. */
type OwnPick = "text" | "rating";

/** What each component is rendered with: its own first parameter. */
type PropsOf<Component extends (props: never) => unknown> =
  Parameters<Component>[0];

type FieldUiVerdicts = {
  // The components, by the props they are rendered with.
  "FieldTypePicker, by types": Accepts<
    TodayFieldTypePickerProps<BuiltInPick>,
    PropsOf<typeof FieldTypePicker<BuiltInPick>>
  >;
  "FieldTypePicker, by entries": Accepts<
    TodayFieldTypePickerProps<OwnPick>,
    PropsOf<typeof FieldTypePicker<OwnPick>>
  >;
  "FieldTypePicker, by any type": Accepts<
    TodayFieldTypePickerProps<string>,
    PropsOf<typeof FieldTypePicker<string>>
  >;
  FieldDefaultValueInput: Accepts<
    TodayFieldDefaultValueInputProps,
    PropsOf<typeof FieldDefaultValueInput>
  >;
  FieldOptionsEditor: Accepts<
    TodayFieldOptionsEditorProps,
    PropsOf<typeof FieldOptionsEditor>
  >;
  ConditionRow: Accepts<TodayConditionRowProps, PropsOf<typeof ConditionRow>>;
  ValidationNumberField: Accepts<
    TodayValidationNumberFieldProps,
    PropsOf<typeof ValidationNumberField>
  >;
  ValidationRulesEditor: Accepts<
    TodayValidationRulesEditorProps,
    PropsOf<typeof ValidationRulesEditor>
  >;

  // The exported prop types, for a plugin that names them
  // (`const props: FieldOptionsEditorProps = …`).
  FieldTypePickerProps: Accepts<
    TodayFieldTypePickerProps<string>,
    FieldTypePickerProps<string>
  >;
  FieldDefaultValueInputProps: Accepts<
    TodayFieldDefaultValueInputProps,
    FieldDefaultValueInputProps
  >;
  FieldOptionsEditorProps: Accepts<
    TodayFieldOptionsEditorProps,
    FieldOptionsEditorProps
  >;
  ConditionRowProps: Accepts<TodayConditionRowProps, ConditionRowProps>;
  ValidationNumberFieldProps: Accepts<
    TodayValidationNumberFieldProps,
    ValidationNumberFieldProps
  >;
  ValidationRulesEditorProps: Accepts<
    TodayValidationRulesEditorProps,
    ValidationRulesEditorProps
  >;

  // The data a consumer builds and passes in.
  FieldDefaultOption: Accepts<TodayDefaultOption, FieldDefaultOption>;
  FieldOption: Accepts<TodayFieldOption, FieldOption>;
  ConditionRange: Accepts<TodayConditionRange, ConditionRange>;
  ConditionSource: Accepts<TodayConditionSource, ConditionSource>;
  ConditionSourceOption: Accepts<
    TodayConditionSourceOption,
    ConditionSourceOption
  >;
  ConditionValue: Accepts<TodayConditionValue, ConditionValue>;
  ValidationRuleValues: Accepts<
    TodayValidationRuleValues,
    ValidationRuleValues
  >;

  // The data a consumer is handed back: through `onOptionsChange`, a
  // condition's `onChange` (a range inside its value) and the rules'
  // `onChange`.
  "FieldOption, read back": ReadsAs<FieldOption, TodayFieldOption>;
  "ConditionValue, read back": ReadsAs<ConditionValue, TodayConditionValue>;
  "ConditionRange, read back": ReadsAs<ConditionRange, TodayConditionRange>;
  "ValidationRuleValues, read back": ReadsAs<
    ValidationRuleValues,
    TodayValidationRuleValues
  >;

  // The functions, hook and constant, as a consumer calls them: today's
  // arguments accepted, today's results readable.
  withOptionIds: Calls<
    typeof withOptionIds,
    [
      options: ReadonlyArray<{ label: string; value: string }>,
      idPrefix?: string,
    ],
    TodayFieldOption[]
  >;
  usePluginFieldTypeEntries: Calls<
    typeof usePluginFieldTypeEntries,
    [surface: TodaySurface],
    TodayCatalogEntry<string>[]
  >;
  operatorsForType: Calls<
    typeof operatorsForType,
    [sourceType: string | undefined],
    TodayOperator[]
  >;
  operatorTakesValue: Calls<
    typeof operatorTakesValue,
    [operator: TodayOperator],
    boolean
  >;
  drawsAnyValidationRule: Calls<
    typeof drawsAnyValidationRule,
    [allowed: readonly TodayValidationRule[]],
    boolean
  >;
  EDITABLE_VALIDATION_RULES: ReadsAs<
    typeof EDITABLE_VALIDATION_RULES,
    readonly TodayValidationRule[]
  >;
};

/**
 * Only the shapes that broke, each with what broke. Checked first and on its
 * own because its diagnostic names them: the whole table's elides most of its
 * entries ("... 24 more ...") and so cannot say which shape failed.
 */
type BrokenShapes = {
  [Shape in keyof FieldUiVerdicts as FieldUiVerdicts[Shape] extends true
    ? never
    : Shape]: FieldUiVerdicts[Shape];
};
expectTypeOf<BrokenShapes>().toEqualTypeOf<{}>();

// The whole table as well, which a verdict that resolved to `never` (dropped
// by the projection above) cannot pass.
expectTypeOf<FieldUiVerdicts>().toEqualTypeOf<{
  [Shape in keyof FieldUiVerdicts]: true;
}>();

// The operator names are both passed in and handed back, so they are pinned
// exactly: one added breaks a consumer's exhaustive handling of today's set,
// one removed refuses a condition it builds. `toEqualTypeOf` also refuses
// `any`.
expectTypeOf<ConditionOperatorName>().toEqualTypeOf<TodayOperator>();
