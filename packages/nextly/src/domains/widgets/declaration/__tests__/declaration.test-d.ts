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
import type { WidgetRenderSize, WidgetResultField } from "../../result";
import type { WidgetScope } from "../../resolved-sources";
import type { CoreView, QueryAnswer } from "../displays";
import {
  defineWidget,
  type WidgetAccess,
  type WidgetReadServices,
  type WidgetData,
  type WidgetPreviewCase,
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
  size: { default: { w: 12, h: 4 } },
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
  load: async ({ settings }) => {
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
  size: { default: { w: 12, h: 4 } },
  settings: {
    collection: settings.collection(),
    items: settings.items(),
    range: settings.dateRange(),
  },
  load: {
    query: ({ settings }) => {
      expectTypeOf(settings.collection).toEqualTypeOf<string>();
      expectTypeOf(settings.items).toEqualTypeOf<number>();
      expectTypeOf(settings.range).toEqualTypeOf<DateRange>();
      return { collection: settings.collection, op: "count" };
    },
  },
  view: "figure",
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

// Who may be offered it: a permission today, and the two forms typed for the
// release that judges them (startup refuses them until then).
expectTypeOf<(typeof ordersByState)["access"]>().toEqualTypeOf<
  WidgetAccess | undefined
>();

// A component over a query core runs is handed that query's answer, the wire
// shape for its op.
expectTypeOf<WidgetData<typeof unpaidCount>>().toEqualTypeOf<
  QueryAnswer<"count">
>();

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
// the only options are the ones a read carries. Pinned exactly, so an option added to either is
// a decision made here, not an accident.
expectTypeOf<
  keyof NonNullable<Parameters<WidgetReadServices["count"]>[1]>
>().toEqualTypeOf<"where" | "signal">();
expectTypeOf<
  keyof NonNullable<Parameters<WidgetReadServices["find"]>[1]>
>().toEqualTypeOf<"where" | "sort" | "limit" | "select" | "signal">();
