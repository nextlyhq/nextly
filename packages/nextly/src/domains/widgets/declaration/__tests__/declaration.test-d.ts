/**
 * One `defineWidget()` types its settings and its data wherever they are read:
 * the exact types each reader is handed, asserted so the checker evaluates them.
 *
 * Equality, not assignability: `toEqualTypeOf<number>()` fails for `any`,
 * `unknown` and `number | undefined` alike, so a reader handed a looser type
 * than the declaration implies is caught, not only one handed a wrong type.
 * That is the property that matters here -- inference that quietly gives up
 * produces `unknown`, which every assignability check would accept.
 *
 * The REFUSALS (a wrong read, a wrong shape for a view, data JSON would
 * change) are in `compile-errors.test.ts`, which names the error each one must
 * produce. Compiled by `pnpm check-types` through `tsconfig.tests.json`.
 */
import { expectTypeOf } from "vitest";

import type { WidgetSizeDeclaration } from "../../grid-size";
import { rangeWindow, type RangeInterval } from "../../query";
import type { WidgetRenderSize, WidgetResultField } from "../../result";
import type { WidgetScope } from "../../resolved-sources";
import type { WidgetFieldChoice, WidgetSourceFieldType } from "../../sources";
import type { CoreView } from "../displays";
import {
  defineWidget,
  type WidgetAccess,
  type WidgetInterval,
  type WidgetAccessGate,
  type WidgetRange,
  type WidgetReadServices,
  type WidgetData,
  type WidgetPreviewCase,
  type WidgetProps,
  type WidgetSettingValues,
} from "../define-widget";
import { option } from "../../../../collections/fields/helpers";
import {
  setting,
  type ChartStyle,
  type DateRange,
  type WidgetFilter,
} from "../setting-builders";
import type { TransportableValue } from "../transportable";

import type { RevenueCard } from "./plugin/admin";
import type { ordersByState, revenue, unpaidCount } from "./plugin/widgets";

// Every builder, field and picker, and each dependent setting, in one widget.
// The data function asserts what it is handed; the declaration below it asserts
// that a component would be handed the same.
const everySetting = defineWidget({
  id: "test/every-setting",
  title: "Every setting",
  description: "Holds one setting of each kind",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  settings: {
    collection: setting.collection({ label: "Collection" }),
    filter: setting.filter({ of: "collection", label: "Filter" }),
    sort: setting.sort({ of: "collection", label: "Sort" }),
    groupBy: setting.groupBy({ of: "collection", label: "Group by" }),
    columns: setting.fields({ of: "collection", label: "Fields" }),
    field: setting.fieldOf({ of: "collection", label: "Field" }),
    range: setting.dateRange({ label: "Date range" }),
    style: setting.select({
      label: "Chart style",
      options: [option("Line", "line"), option("Bars", "bars")],
      defaultValue: "line",
    }),
    mine: setting.checkbox({ label: "Only mine", defaultValue: false }),
    note: setting.text({ label: "Note", defaultValue: "" }),
    body: setting.textarea({ label: "Body", maxLength: 200 }),
    since: setting.date({ label: "Since" }),
    limit: setting.number({ label: "Rows", defaultValue: 3, min: 1 }),
    tone: setting.select({
      label: "Tone",
      options: [option("Calm", "calm"), option("Loud", "loud")],
      defaultValue: "calm",
    }),
  },
  load: async ({ settings }) => {
    // 🔴 In the data function: each setting at its exact type.
    expectTypeOf(settings.collection).toEqualTypeOf<string>();
    expectTypeOf(settings.filter).toEqualTypeOf<WidgetFilter>();
    expectTypeOf(settings.sort).toEqualTypeOf<string>();
    expectTypeOf(settings.groupBy).toEqualTypeOf<string>();
    expectTypeOf(settings.columns).toEqualTypeOf<string[]>();
    expectTypeOf(settings.field).toEqualTypeOf<string>();
    expectTypeOf(settings.range).toEqualTypeOf<DateRange>();
    expectTypeOf(settings.style).toEqualTypeOf<ChartStyle>();
    expectTypeOf(settings.mine).toEqualTypeOf<boolean>();
    expectTypeOf(settings.note).toEqualTypeOf<string>();
    expectTypeOf(settings.body).toEqualTypeOf<string>();
    expectTypeOf(settings.since).toEqualTypeOf<string>();
    expectTypeOf(settings.limit).toEqualTypeOf<number>();
    expectTypeOf(settings.tone).toEqualTypeOf<"calm" | "loud">();
    return { total: settings.limit };
  },
  view: "figure",
});

// The literal range values are the ones a date-range setting offers, and the
// widget's settings object carries every key, none of them optional.
expectTypeOf<DateRange>().toEqualTypeOf<"7d" | "30d" | "90d" | "12m">();
expectTypeOf<WidgetSettingValues<typeof everySetting>>().toEqualTypeOf<{
  readonly collection: string;
  readonly filter: WidgetFilter;
  readonly sort: string;
  readonly groupBy: string;
  readonly columns: string[];
  readonly field: string;
  readonly range: DateRange;
  readonly style: ChartStyle;
  readonly mine: boolean;
  readonly note: string;
  readonly body: string;
  readonly since: string;
  readonly limit: number;
  readonly tone: "calm" | "loud";
}>();

// 🔴 In a component, through `import type` of the declaration: its settings
// and its data, both props typed by the same widget. The component file (`plugin/admin.ts`) compiles against these
// types; asserting them here pins what it was handed.
expectTypeOf<WidgetProps<typeof revenue>["settings"]>().toEqualTypeOf<{
  readonly range: DateRange;
  readonly currency: "usd" | "eur";
  readonly net: boolean;
}>();
expectTypeOf<WidgetData<typeof revenue>>().toEqualTypeOf<{
  currency: "usd" | "eur";
  points: { day: string; total: number }[];
}>();
expectTypeOf<WidgetProps<typeof revenue>["data"]>().toEqualTypeOf<
  WidgetData<typeof revenue>
>();
expectTypeOf<Parameters<typeof RevenueCard>[0]>().toEqualTypeOf<
  WidgetProps<typeof revenue>
>();

// 🔴 Its size in the grid's units and nothing else: columns and rows, and the
// tier the card's drawn width falls in. No named width rides beside them.
expectTypeOf<
  WidgetProps<typeof revenue>["size"]
>().toEqualTypeOf<WidgetRenderSize>();
expectTypeOf<keyof WidgetRenderSize>().toEqualTypeOf<"w" | "h" | "tier">();
expectTypeOf<WidgetRenderSize["w"]>().toEqualTypeOf<number>();
expectTypeOf<WidgetRenderSize["h"]>().toEqualTypeOf<number>();
expectTypeOf<WidgetRenderSize["tier"]>().toEqualTypeOf<
  "small" | "medium" | "large"
>();

// A declaration states its size in the grid's own type, the one the site
// config, a stored placement and the admin read.
expectTypeOf<(typeof revenue)["size"]>().toEqualTypeOf<WidgetSizeDeclaration>();

// The frame's empty test reads the same data the component draws.
expectTypeOf<
  Parameters<NonNullable<(typeof revenue)["isEmpty"]>>[0]
>().toEqualTypeOf<WidgetData<typeof revenue>>();

// The view is kept as written, so the component map can be keyed by its path.
expectTypeOf<(typeof revenue)["view"]>().toEqualTypeOf<{
  readonly component: "@acme/nextly-plugin-shop/admin#RevenueCard";
}>();
expectTypeOf<(typeof ordersByState)["view"]>().toEqualTypeOf<"bars">();
expectTypeOf<CoreView>().toEqualTypeOf<
  "figure" | "list" | "table" | "bars" | "series"
>();

// A core view's preview cases are of that view's data, with the widget's own
// settings beside them.
expectTypeOf<
  NonNullable<(typeof ordersByState)["preview"]>[number]
>().toEqualTypeOf<
  WidgetPreviewCase<
    WidgetData<typeof ordersByState>,
    WidgetSettingValues<typeof ordersByState>
  >
>();

// Who may be offered it: a permission, the collections it reads, or a
// function of the person, each judged per card before its data function runs.
expectTypeOf<(typeof ordersByState)["access"]>().toEqualTypeOf<
  WidgetAccess | undefined
>();

// A component is handed exactly what its widget's data function answers.
expectTypeOf<WidgetData<typeof unpaidCount>>().toEqualTypeOf<{
  total: number;
}>();

// A widget drawn by a core view has that view's data, whatever its own
// function's literal answer was.
// `field` describes the grouped field (its label and value labels) when the source declares it;
// `atLeast` says the bucket counts are floors, from a source that grouped under a work bound,
// and a bucket's own `atLeast` says that one bucket's count is. `asOf` is the
// instant the answer was computed at, for a source whose buckets depend on it.
expectTypeOf<WidgetData<typeof ordersByState>>().toEqualTypeOf<{
  buckets: { value: string | null; count: number; atLeast?: boolean }[];
  truncated?: boolean;
  asOf?: string;
  field?: WidgetResultField;
  atLeast?: boolean;
}>();

// A list's rows may be any object type, an interface included: the wire type's
// `Record<string, unknown>` rows would refuse an interface, which has no index
// signature, though every value in it travels. The answer still has to be
// transportable (compile-errors.test.ts).
interface OrderRow {
  title: string;
  total: number;
}
declare const rows: OrderRow[];
defineWidget({
  id: "test/interface-rows",
  title: "Orders",
  description: "Rows typed by an interface",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ items: rows }),
  view: "list",
});

// A data function is handed the batch's scope, as core's own sources are, so two cards needing
// one scan can share it.
defineWidget({
  id: "test/shares-a-scan",
  title: "Orders",
  description: "A data function reading the batch's scope",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async ({ scope }) => {
    expectTypeOf(scope).toEqualTypeOf<WidgetScope>();
    return { total: await scope.getOrCompute("orders", async () => 3) };
  },
  view: "figure",
});

// A data function's reads take no person, user or access option: who reads is bound by core, so
// the only options are the ones a read carries. Pinned exactly, so an option added to any of them
// is a decision made here, not an accident.
expectTypeOf<
  keyof NonNullable<Parameters<WidgetReadServices["count"]>[1]>
>().toEqualTypeOf<"where" | "status" | "window" | "signal">();
expectTypeOf<
  keyof NonNullable<Parameters<WidgetReadServices["find"]>[1]>
>().toEqualTypeOf<
  "where" | "sort" | "limit" | "select" | "status" | "total" | "signal"
>();
// A count's window: a range a series is drawn over, the date it places entries by, and the
// window as long before it; and a list's total, asked for only as `true`.
expectTypeOf<
  NonNullable<Parameters<WidgetReadServices["count"]>[1]>["window"]
>().toEqualTypeOf<
  { range: WidgetRange; dateField?: string; previous?: true } | undefined
>();
expectTypeOf<
  NonNullable<Parameters<WidgetReadServices["find"]>[1]>["total"]
>().toEqualTypeOf<true | undefined>();

// The status a read may name, on every read: the published entries, or all of them.
expectTypeOf<
  NonNullable<Parameters<WidgetReadServices["count"]>[1]>["status"]
>().toEqualTypeOf<"published" | "all" | undefined>();
expectTypeOf<
  keyof NonNullable<Parameters<WidgetReadServices["groupBy"]>[1]>
>().toEqualTypeOf<"field" | "where" | "status" | "limit" | "signal">();
expectTypeOf<
  keyof Parameters<WidgetReadServices["timeseries"]>[1]
>().toEqualTypeOf<"range" | "dateField" | "where" | "status" | "signal">();

// What a grouping and a series read answer: the shapes the `bars` and `series` views draw, the
// series with the interval its points were counted in.
expectTypeOf<
  Awaited<ReturnType<WidgetReadServices["groupBy"]>>
>().toEqualTypeOf<{
  buckets: readonly { value: string | null; count: number }[];
  truncated?: boolean;
  atLeast?: boolean;
}>();
// What a list read answers: its rows as JSON carries them, and, asked for, how many it matched.
expectTypeOf<Awaited<ReturnType<WidgetReadServices["find"]>>>().toEqualTypeOf<{
  items: { readonly [field: string]: TransportableValue }[];
  total?: number;
  atLeast?: boolean;
}>();
// What `describe` answers: the collection's title field, its status, and each field a reader
// may read, labelled.
expectTypeOf<
  Awaited<ReturnType<WidgetReadServices["describe"]>>
>().toEqualTypeOf<
  | {
      title?: string;
      status: boolean;
      fields: readonly {
        name: string;
        label: string;
        type: WidgetSourceFieldType;
        choices?: readonly WidgetFieldChoice[];
        groupable?: false;
        presentable?: false;
      }[];
    }
  | undefined
>();
expectTypeOf<Parameters<WidgetReadServices["describe"]>>().toEqualTypeOf<
  [collection: string]
>();
expectTypeOf<
  Awaited<ReturnType<WidgetReadServices["timeseries"]>>
>().toEqualTypeOf<{
  points: readonly { start: string; count: number }[];
  interval: WidgetInterval;
}>();
// The interval is one a range is drawn in, as the range's own window says, and a range is one a
// Date range setting offers.
expectTypeOf<WidgetInterval>().toEqualTypeOf<RangeInterval>();
expectTypeOf<WidgetInterval>().toEqualTypeOf<"day" | "week" | "month">();
expectTypeOf<
  ReturnType<typeof rangeWindow>["interval"]
>().toEqualTypeOf<WidgetInterval>();
expectTypeOf<WidgetRange>().toEqualTypeOf<DateRange>();

// Each answer is data its view draws as it comes: a function may answer it unchanged.
defineWidget({
  id: "test/grouped-read",
  title: "Orders by state",
  description: "Answers a grouping read as it comes",
  category: "Test",
  size: { default: { w: 6, h: 4 } },
  load: async ({ services }) => services.groupBy("orders"),
  view: "bars",
});
defineWidget({
  id: "test/series-read",
  title: "Orders over time",
  description: "Answers a series read as it comes",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  settings: { range: setting.dateRange({ label: "Date range" }) },
  load: async ({ services, settings }) =>
    services.timeseries("orders", { range: settings.range, status: "all" }),
  view: "series",
});

// The permission gate `access` takes: one permission, any of several, or all of several, each
// entry one permission or any of several. A list on its own is none of them.
expectTypeOf<WidgetAccessGate>().toEqualTypeOf<
  | string
  | { anyOf: readonly string[] }
  | { allOf: readonly (string | { anyOf: readonly string[] })[] }
>();
expectTypeOf<{ anyOf: ["read-orders"] }>().toExtend<WidgetAccess>();
expectTypeOf<{
  allOf: ["read-orders", { anyOf: ["update-orders", "create-orders"] }];
}>().toExtend<WidgetAccess>();
expectTypeOf<{ collections: ["orders"] }>().toExtend<WidgetAccess>();
expectTypeOf<readonly ["read-orders"]>().not.toExtend<WidgetAccess>();
// A predicate may answer anything, a promise included: only `true` admits.
expectTypeOf<
  (input: { user: unknown }) => Promise<boolean>
>().toExtend<WidgetAccess>();
