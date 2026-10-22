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
 * The REFUSALS (a wrong read, a wrong shape for a display, data JSON would
 * change) are in `compile-errors.test.ts`, which names the error each one must
 * produce. Compiled by `pnpm check-types` through `tsconfig.tests.json`.
 */
import { expectTypeOf } from "vitest";

import type { WidgetResultField } from "../../result";
import type { QueryAnswer } from "../displays";
import {
  defineWidget,
  type WidgetData,
  type WidgetProps,
  type WidgetSettingValues,
} from "../define-widget";
import {
  settings,
  type ChartStyle,
  type DateRange,
  type WidgetFilter,
} from "../setting-builders";

import type { RevenueCard } from "./plugin/admin";
import type { ordersByState, revenue, unpaidCount } from "./plugin/widgets";

// Every builder, standard and custom, and a dependent setting, in one widget.
// The data function asserts what it is handed; the declaration below it asserts
// that a component would be handed the same.
const everySetting = defineWidget({
  id: "test/every-setting",
  title: "Every setting",
  description: "Holds one setting of each kind",
  category: "Test",
  widths: ["full"],
  width: "full",
  settings: {
    collection: settings.collection(),
    filter: settings.filter({ of: "collection" }),
    sort: settings.sort({ of: "collection" }),
    groupBy: settings.groupBy({ of: "collection" }),
    items: settings.items({ default: 5 }),
    range: settings.dateRange(),
    style: settings.chartStyle(),
    mine: settings.onlyMine(),
    note: settings.text({ default: "" }),
    limit: settings.number({ default: 3, min: 1 }),
    compact: settings.toggle({ default: false }),
    tone: settings.select({ options: ["calm", "loud"], default: "calm" }),
  },
  data: async ({ settings }) => {
    // 🔴 In the data function: each setting at its exact type.
    expectTypeOf(settings.collection).toEqualTypeOf<string>();
    expectTypeOf(settings.filter).toEqualTypeOf<WidgetFilter>();
    expectTypeOf(settings.sort).toEqualTypeOf<string>();
    expectTypeOf(settings.groupBy).toEqualTypeOf<string>();
    expectTypeOf(settings.items).toEqualTypeOf<number>();
    expectTypeOf(settings.range).toEqualTypeOf<DateRange>();
    expectTypeOf(settings.style).toEqualTypeOf<ChartStyle>();
    expectTypeOf(settings.mine).toEqualTypeOf<boolean>();
    expectTypeOf(settings.note).toEqualTypeOf<string>();
    expectTypeOf(settings.limit).toEqualTypeOf<number>();
    expectTypeOf(settings.compact).toEqualTypeOf<boolean>();
    expectTypeOf(settings.tone).toEqualTypeOf<"calm" | "loud">();
    return { total: settings.items };
  },
  display: "metric",
});

// The literal range values are the ones a date-range setting offers, and the
// widget's settings object carries every key, none of them optional.
expectTypeOf<DateRange>().toEqualTypeOf<"7d" | "30d" | "90d" | "12m">();
expectTypeOf<WidgetSettingValues<typeof everySetting>>().toEqualTypeOf<{
  readonly collection: string;
  readonly filter: WidgetFilter;
  readonly sort: string;
  readonly groupBy: string;
  readonly items: number;
  readonly range: DateRange;
  readonly style: ChartStyle;
  readonly mine: boolean;
  readonly note: string;
  readonly limit: number;
  readonly compact: boolean;
  readonly tone: "calm" | "loud";
}>();

// 🔴 In a query core runs: the builder reads the same settings, typed.
defineWidget({
  id: "test/query-reads-settings",
  title: "Query",
  description: "A query written from its settings",
  category: "Test",
  widths: ["full"],
  width: "full",
  settings: {
    collection: settings.collection(),
    items: settings.items(),
    range: settings.dateRange(),
  },
  data: {
    query: ({ settings }) => {
      expectTypeOf(settings.collection).toEqualTypeOf<string>();
      expectTypeOf(settings.items).toEqualTypeOf<number>();
      expectTypeOf(settings.range).toEqualTypeOf<DateRange>();
      return { collection: settings.collection, op: "count" };
    },
  },
  display: "metric",
});

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

// The frame's empty test reads the same data the component draws.
expectTypeOf<
  Parameters<NonNullable<NonNullable<(typeof revenue)["empty"]>["when"]>>[0]
>().toEqualTypeOf<WidgetData<typeof revenue>>();

// A component over a query core runs is handed that query's answer, the wire
// shape for its op.
expectTypeOf<WidgetData<typeof unpaidCount>>().toEqualTypeOf<
  QueryAnswer<"count">
>();

// A widget drawn by a core display has that display's data, whatever its own
// function's literal answer was.
// `field` describes the grouped field (its label and value labels) when the source declares it;
// `atLeast` says the bucket counts are floors, from a source that grouped under a work bound,
// and a bucket's own `atLeast` says that one bucket's count is.
expectTypeOf<WidgetData<typeof ordersByState>>().toEqualTypeOf<{
  buckets: { value: string | null; count: number; atLeast?: boolean }[];
  truncated?: boolean;
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
  widths: ["full"],
  width: "full",
  data: async () => ({ items: rows }),
  display: "list",
});
