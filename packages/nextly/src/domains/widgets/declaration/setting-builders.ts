/**
 * The settings a widget declares, written so their VALUE types travel.
 *
 * Each builder returns a declaration that carries the type of the value a
 * person can choose, so a widget's settings object is enough for the compiler
 * to know, with no generated file, what its data function, its query and its
 * component will be handed: `setting.number({ ... })` is a number wherever it
 * is read, `setting.dateRange({ ... })` one of four ranges.
 *
 * The field builders are the collections' own (text, textarea, number,
 * checkbox, select, date), taking the config a collection field takes less its
 * `name`; the pickers beside them choose something of the site (a collection,
 * a field of it, a date range, a list's filter, sort, grouping and fields).
 * Every setting carries a label. A dependent setting names the setting it
 * depends on, and that name is checked against the widget's own settings when
 * the widget is declared.
 *
 * @module domains/widgets/declaration/setting-builders
 */

import type { RelativeSpan, WidgetQuery } from "../query";
import { LIST_DENSITIES, type ListDensity } from "../query-limits";

/**
 * Carries a setting's value type without a runtime property.
 *
 * Declared, never created: the type exists so `SettingValues` can read it, and
 * no value is ever stored under the key.
 */
declare const settingValue: unique symbol;

/**
 * One setting, as a widget declares it: core's own setting definition
 * (`WidgetSetting` in `../settings.ts`), with its value type carried along.
 *
 * 🔴 The SAME vocabulary as the definitions registration validates: `type`,
 * `defaultValue` and `of`, and core's setting types (`AnyWidgetSetting`
 * in `../settings.ts`), judged by its rules and read by its reader. The record
 * key becomes the definition's `name`. So a declaration is not a second
 * schema to convert and keep in step.
 *
 * - `Value` is the type of what a person can choose, and what readers get.
 * - `Kind` is the definition's `type`, so a dependency can require a sibling
 *   of a kind.
 * - `On` is the sibling this setting depends on, when it depends on one.
 */
export interface SettingDeclaration<
  Value,
  Kind extends string = string,
  On extends string = never,
> {
  readonly type: Kind;
  /** What the settings sheet calls it: a setting is never shown by its key. */
  readonly label: string;
  /** Help text under the control, where the field renderer reads it. */
  readonly admin?: { readonly description?: string };
  /**
   * The starting value, used until a person changes the setting.
   *
   * Absent only where core supplies it when the card is placed: a Collection
   * setting starts as the collection whose group the card was added from.
   */
  readonly defaultValue?: Value;
  /** The setting this one depends on, and is reset with. */
  readonly of?: On;
  /** Whether it sits on the card's header (at most one per widget). */
  readonly quick?: boolean;
  readonly [settingValue]?: Value;
}

/** Anything a widget may hold under `settings`. */
export type WidgetSettings = Readonly<
  Record<string, SettingDeclaration<unknown, string, string>>
>;

/**
 * The values a widget's settings hand to every reader.
 *
 * Each value is the setting's own type, never `| undefined`: a reader is handed
 * the person's value where it is usable and the starting value everywhere else,
 * a setting hidden by its dependency included, so there is always one.
 */
export type SettingValues<S> = {
  // `string` for the dependency, not the default `never`: a dependent setting
  // names its sibling, and matching only declarations that name none would
  // hand every Filter, Sort and Group by to its readers as `never`.
  readonly [K in keyof S]: S[K] extends SettingDeclaration<
    infer V,
    string,
    string
  >
    ? V
    : never;
};

/**
 * The names of a widget's Collection settings.
 *
 * What a dependent setting may name: a filter, a sort or a grouping only means
 * something over a known collection.
 */
type CollectionSettingNames<S> = Extract<
  {
    [K in keyof S]: S[K] extends SettingDeclaration<unknown, "collection">
      ? K
      : never;
  }[keyof S],
  string
>;

/**
 * The bound a widget's settings must satisfy: every dependency names one of
 * its own Collection settings.
 *
 * 🔴 Used as an F-bound on the settings type (`S extends DependentSettings<S>`).
 * A dependency naming no Collection setting -- a typo, or a setting of another
 * kind -- fails the bound, and the compiler reports it at the `of` that is
 * wrong, naming the settings it could have been.
 */
export type DependentSettings<S> = {
  readonly [K in keyof S]: SettingDeclaration<
    unknown,
    string,
    CollectionSettingNames<S>
  >;
};

/**
 * The date ranges a card can show: each a span a query reaches back by, so a
 * card's range becomes its query's `since` through the one vocabulary the
 * server resolves. A range outside that vocabulary fails to compile here.
 *
 * Each is whole UTC days or months, the current one included: "Last 30 days"
 * is the thirty UTC days ending today, so for a reader east of UTC the range
 * starts during their morning, as a daily chart's bars do.
 */
export const DATE_RANGES = [
  "7d",
  "30d",
  "90d",
  "12m",
] as const satisfies readonly RelativeSpan[];
export type DateRange = (typeof DATE_RANGES)[number];

/** How a count over time is drawn. */
export const CHART_STYLES = ["line", "bars"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];

/** A filter, in the form a widget query takes one. */
export type WidgetFilter = NonNullable<WidgetQuery["where"]>;

/**
 * What the reader is shown for each density. A record over every density, so one added to
 * `LIST_DENSITIES` cannot reach a settings sheet unnamed.
 */
const DENSITY_LABELS: Readonly<Record<ListDensity, string>> = {
  default: "Default",
  compact: "Compact",
};

/**
 * A list card's Density options, one for every density, each named for the reader: what each of
 * core's own list cards offers, so they cannot differ.
 */
export const DENSITY_OPTIONS: readonly { label: string; value: ListDensity }[] =
  LIST_DENSITIES.map(value => ({ label: DENSITY_LABELS[value], value }));

/**
 * What a reader is shown for each date range: the words the card's header and
 * its settings use, so every widget offering a range names them alike.
 */
const DATE_RANGE_LABELS: Readonly<Record<DateRange, string>> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
};

/** The date ranges as a select's options, each named for the reader. */
export const DATE_RANGE_OPTIONS: readonly {
  label: string;
  value: DateRange;
}[] = DATE_RANGES.map(value => ({ label: DATE_RANGE_LABELS[value], value }));

/**
 * What a field builder takes: the keys of the collection field's config a
 * setting reads (`Extra`), with `label` required and the starting value a
 * plain value. A setting's config IS its collection builder's config less
 * `name`, which the setting's key gives: only the keys a setting reads are
 * offered, so an author never writes one that silently does nothing on a card.
 *
 * 🔴 Declared STRUCTURALLY rather than picked from `TextFieldConfig` and its
 * siblings, for the reason `WidgetSetting` is (`../settings.ts`): the admin's
 * type check reaches this module through core's widgets, and the field types
 * pull `collections/fields/types/base` behind them, whose imports do not
 * resolve there. `__tests__/setting-builders.compat.test-d.ts` holds each
 * config to the collection field's own, key by key, where they do.
 */
type SettingConfig<
  Extra,
  Value,
  StartRequired extends boolean = false,
> = Extra &
  PickerConfig &
  (StartRequired extends true
    ? { defaultValue: Value }
    : { defaultValue?: Value });

/**
 * What every setting takes, a dashboard picker included: the label and help
 * text a collection field takes.
 */
type PickerConfig = {
  /** What the settings sheet calls it: a setting is never shown by its key. */
  label: string;
  /** Help text under the control, where the field renderer reads it. */
  admin?: { description?: string };
};

/** The quick flag a choice or an on/off may carry: drawn on the card's header. */
type Quick = {
  /** Whether it sits on the card's header. At most one per widget. */
  quick?: boolean;
};

/**
 * One declaration, in the definitions' own vocabulary, so the object needs no
 * translation on its way to registration. The quick flag is written only when
 * true, so an unmarked setting's declaration has no `quick` key at all.
 */
function declare<Value, Kind extends string, On extends string = never>(
  type: Kind,
  { quick, ...config }: Record<string, unknown> & { quick?: boolean }
): SettingDeclaration<Value, Kind, On> {
  return {
    type,
    ...config,
    ...(quick === true ? { quick: true } : {}),
  } as SettingDeclaration<Value, Kind, On>;
}

/**
 * The setting builders: the collections' field builders, as a card's settings
 * take them, and the dashboard's pickers beside them.
 *
 * Each field builder's config is the collection builder's config without
 * `name`, the setting's key, and with `label` required. `const` type
 * parameters keep a select's options and a dependency's name as the literals
 * the author wrote, so a reader comparing against a value the setting does
 * not offer, or naming a setting the widget does not have, fails to compile.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export const setting = {
  /** A line of text. */
  text: (config: SettingConfig<object, string, true>) =>
    declare<string, "text">("text", config),
  /**
   * Text over several lines, at most `maxLength` characters when given,
   * counted in code points.
   */
  textarea: (config: SettingConfig<{ maxLength?: number }, string>) =>
    declare<string, "textarea">("textarea", config),
  /** A number, within `min` and `max` when given. */
  number: (
    config: SettingConfig<{ min?: number; max?: number }, number, true>
  ) => declare<number, "number">("number", config),
  /** On or off. */
  checkbox: (config: SettingConfig<object, boolean, true> & Quick) =>
    declare<boolean, "checkbox">("checkbox", config),
  /**
   * One of a fixed set, each with a label and a value. The value type is the
   * options' values, and `NoInfer` keeps the default from widening the set it
   * must belong to.
   */
  select: <const Value extends string>(
    config: PickerConfig & {
      options: readonly { label: string; value: Value }[];
      defaultValue: NoInfer<Value>;
    } & Quick
  ) =>
    declare<Value, "select">("select", {
      ...config,
      options: config.options.map(({ label, value }) => ({ label, value })),
    }),
  /** A date, as an ISO 8601 date string. */
  date: (config: SettingConfig<object, string>) =>
    declare<string, "date">("date", config),

  /**
   * Collection: the collection a card reads. It has no default: a card starts
   * on the collection whose group it was added from.
   */
  collection: (config: PickerConfig) =>
    declare<string, "collection">("collection", config),
  /**
   * A field of the collection the setting named by `of` chooses: one of the
   * fields that collection offers this reader, for a card's own `load` to read.
   */
  fieldOf: <const On extends string>(
    config: PickerConfig & { of: On; defaultValue?: string }
  ) => declare<string, "field", On>("field", config),
  /** Date range: one of four spans, the last 30 days by default. */
  dateRange: (config: PickerConfig & { defaultValue?: DateRange } & Quick) =>
    declare<DateRange, "select">("select", {
      ...config,
      defaultValue: config.defaultValue ?? "30d",
      options: DATE_RANGE_OPTIONS.map(option => ({ ...option })),
    }),
  /** Filter: the list view's conditions, over the collection `of` names. */
  filter: <const On extends string>(config: PickerConfig & { of: On }) =>
    declare<WidgetFilter, "filter", On>("filter", config),
  /** Sort: a field of the collection `of` names, with a direction. */
  sort: <const On extends string>(
    config: PickerConfig & { of: On; defaultValue?: string }
  ) => declare<string, "sort", On>("sort", config),
  /**
   * Fields: the fields each row of a list shows after its title, in order.
   *
   * @experimental
   */
  fields: <const On extends string>(config: PickerConfig & { of: On }) =>
    declare<string[], "fields", On>("fields", config),
  /** Group by: status, or a choice field of the collection `of` names. */
  groupBy: <const On extends string>(
    config: PickerConfig & { of: On; defaultValue?: string }
  ) => declare<string, "groupBy", On>("groupBy", config),
};
