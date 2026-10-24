/**
 * The settings a widget declares, written so their VALUE types travel.
 *
 * Each builder returns a declaration that carries the type of the value a
 * person can choose, so a widget's settings object is enough for the compiler
 * to know, with no generated file, what its data function, its query and its
 * component will be handed: `settings.items()` is a number wherever it is read,
 * `settings.dateRange()` one of four ranges.
 *
 * The standard builders are the shared set every widget offers alike (title
 * aside, which core gives every widget); the custom ones are for what is
 * particular to one widget. A dependent setting names the setting it depends
 * on, and that name is checked against the widget's own settings when the
 * widget is declared.
 *
 * @module domains/widgets/declaration/setting-builders
 */

import type { RelativeSpan, WidgetQuery } from "../query";
import { MAX_WIDGET_ROWS } from "../query-limits";

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
 * `defaultValue` and `of`, and core's eight setting types (`AnyWidgetSetting`
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
 * Builds one declaration; every builder below is this with its types fixed.
 *
 * Options beyond the default and the dependency (a select's choices, a
 * number's bounds) are kept on the object for startup to validate; only the
 * value type needs to be visible to the compiler.
 */
function declare<Value, Kind extends string, On extends string = never>(
  type: Kind,
  {
    default: defaultValue,
    ...rest
  }: { default?: Value; of?: On; [option: string]: unknown } = {}
): SettingDeclaration<Value, Kind, On> {
  // `default` is what an author writes; `defaultValue` is the definition's own
  // field, so the object needs no translation on its way to registration.
  return defaultValue === undefined
    ? { type, ...rest }
    : { type, defaultValue, ...rest };
}

/**
 * Marks a setting as the card's quick one, or leaves it unmarked.
 *
 * Offered only by builders whose control fits a card's header (a choice or an
 * on/off), and written only when true, so an unmarked setting's declaration is
 * exactly what it was before quick settings existed.
 */
const quickFlag = (quick: boolean | undefined) =>
  quick === true ? { quick: true } : {};

/** A fixed set of values, as a select definition lists its options. */
function choices<Option extends string>(values: readonly Option[]) {
  return values.map(value => ({ label: value, value }));
}

/**
 * The setting builders.
 *
 * `const` type parameters keep a dependency's name, and a select's options, as
 * the literals the author wrote: widened to `string`, neither could be checked.
 */
export const settings = {
  /** Collection: the collection a card reads. */
  collection: () => declare<string, "collection">("collection"),
  /** Filter: the list view's conditions, over the collection it names. */
  filter: <const On extends string>(options: { of: On }) =>
    declare<WidgetFilter, "filter", On>("filter", options),
  /** Sort: a field of the collection it names; newest edit first by default. */
  sort: <const On extends string>(options: { of: On; default?: string }) =>
    declare<string, "sort", On>("sort", options),
  /** Group by: status, or a choice field of the collection it names. */
  groupBy: <const On extends string>(options: { of: On; default?: string }) =>
    declare<string, "groupBy", On>("groupBy", options),
  /**
   * Number of items: a number from 1 to the most rows a card draws (`MAX_WIDGET_ROWS`, 25), 5 by
   * default. Read from that one limit, so the editor never offers rows the card would not draw.
   */
  items: ({ default: start = 5 }: { default?: number } = {}) =>
    declare<number, "number">("number", {
      default: start,
      min: 1,
      max: MAX_WIDGET_ROWS,
    }),
  /** Date range: a select of the four ranges, the last 30 days by default. */
  dateRange: ({
    default: start = "30d",
    quick,
  }: { default?: DateRange; quick?: boolean } = {}) =>
    declare<DateRange, "select">("select", {
      default: start,
      options: choices(DATE_RANGES),
      ...quickFlag(quick),
    }),
  /** Chart style: a select of line or bars, a line by default. */
  chartStyle: ({
    default: start = "line",
    quick,
  }: { default?: ChartStyle; quick?: boolean } = {}) =>
    declare<ChartStyle, "select">("select", {
      default: start,
      options: choices(CHART_STYLES),
      ...quickFlag(quick),
    }),
  /** Only mine: a checkbox, off by default. */
  onlyMine: ({
    default: start = false,
    quick,
  }: { default?: boolean; quick?: boolean } = {}) =>
    declare<boolean, "checkbox">("checkbox", {
      default: start,
      ...quickFlag(quick),
    }),

  /** A setting of the widget's own: a line of text. */
  text: (options: { default: string }) =>
    declare<string, "text">("text", options),
  /** A setting of the widget's own: a number. */
  number: (options: { default: number; min?: number; max?: number }) =>
    declare<number, "number">("number", options),
  /** A setting of the widget's own: on or off, a checkbox. */
  toggle: ({ quick, ...options }: { default: boolean; quick?: boolean }) =>
    declare<boolean, "checkbox">("checkbox", {
      ...options,
      ...quickFlag(quick),
    }),
  /**
   * A setting of the widget's own: one of a fixed set.
   *
   * The value type is the options themselves, so a reader comparing against a
   * value the setting does not offer is told so. `NoInfer` keeps the default
   * from widening the set it must belong to.
   */
  select: <const Option extends string>(options: {
    options: readonly Option[];
    default: NoInfer<Option>;
    quick?: boolean;
  }) =>
    declare<Option, "select">("select", {
      default: options.default,
      options: choices(options.options),
      ...quickFlag(options.quick),
    }),
};
