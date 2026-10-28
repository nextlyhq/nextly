/**
 * What a widget declaration REFUSES to compile, each refusal named.
 *
 * Every case is a small file, compiled by the TypeScript command line as if it
 * sat beside the real declaration modules, in two forms:
 *
 * - the FAULTY form must produce exactly one error, on the line marked
 *   `/*!*\/`, with the error code and the words this test expects;
 * - the CORRECTED form, the same file with only the fault put right, must
 *   compile with none.
 *
 * Why not `@ts-expect-error` in a `.test-d.ts`: the directive is satisfied by
 * ANY error on the next line, so it would stay green after the refusal stopped
 * happening, provided something else on that line broke. Naming the code, the
 * line and the message is what tells the intended refusal from an unrelated
 * one; the corrected twin is what shows the case reaches the mechanism at all,
 * rather than failing for a reason the fix does not touch.
 *
 * The exact types each reader is handed are asserted in `declaration.test-d.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  compile,
  listedFiles,
  tscMajor,
} from "../../../../../../../scripts/tsc-cli.mjs";
import { CORE_VIEWS } from "../displays";

// Paths in `/` form on every platform, because that is how TypeScript names a
// file: it normalises every path it is handed, so a case registered under
// `D:\\...\\case-0-faulty.ts` on Windows would never be found by the name the
// program gives it, and the case would not be compiled at all.
const { dirname, join } = posix;
const here = dirname(fileURLToPath(import.meta.url).replaceAll("\\", "/"));
const packageRoot = join(here, "..", "..", "..", "..", "..");

/** Marks the line a faulty form's one error must be reported on. */
const MARK = "/*!*/";

interface Case {
  name: string;
  /** The faulty form, with `MARK` on the line of the fault. */
  faulty: string;
  /** The same file with only the fault put right. */
  corrected: string;
  code: number;
  /** Words the error's message must contain. */
  message: string;
  /**
   * What TypeScript 7 reports instead, where it differs: it orders a union's
   * members by its own ordering, and names some refusals by another code. The
   * refusal, its line and its cause are the same.
   */
  typeScript7?: Partial<Pick<Case, "code" | "message">>;
}

const imports = `import { defineWidget } from "../define-widget";
import { setting } from "../setting-builders";
`;

/** A widget with every field a case does not care about filled in. */
function widget(fields: string): string {
  return `${imports}
export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 }, min: { w: 6, h: 4 } },
${fields}
});
`;
}

/** A pair whose only difference is one fragment. */
function pair(
  build: (fragment: string) => string,
  faulty: string,
  corrected: string
): Pick<Case, "faulty" | "corrected"> {
  return { faulty: build(faulty), corrected: build(corrected) };
}

/** The display that draws each core view, by name. */
type CoreDisplayName = (typeof CORE_VIEWS)[keyof typeof CORE_VIEWS];

/** Each core view with the display that draws it. */
const VIEWS = Object.entries(CORE_VIEWS) as [string, CoreDisplayName][];

/** The data each core display draws, as a data function would answer it. */
const SHAPES: Record<CoreDisplayName, string> = {
  metric: `{ total: 3 }`,
  list: `{ items: [{ title: "First" }] }`,
  table: `{ items: [{ title: "First" }] }`,
  bars: `{ buckets: [{ value: "paid", count: 3 }] }`,
  timeseries: `{ points: [{ start: "2026-10-01", count: 3 }], interval: "day" }`,
};

/** A shape no display draws in the form its neighbour does. */
const WRONG_SHAPE: Record<CoreDisplayName, string> = {
  metric: SHAPES.bars,
  list: SHAPES.metric,
  table: SHAPES.bars,
  bars: SHAPES.timeseries,
  // Its interval without its points, so exactly one drawn field is missing.
  timeseries: `{ interval: "day" }`,
};

/** The field each display draws from, which a wrong shape lacks. */
const DRAWN_FIELD: Record<CoreDisplayName, string> = {
  metric: "total",
  list: "items",
  table: "items",
  bars: "buckets",
  timeseries: "points",
};

/** A site whose one typed plugin contributes the example widgets. */
const SITE = `import { defineConfig } from "../../../../collections/config/define-config";
import type { DeclaredComponentMap, WidgetsOf } from "../../../../plugins/declared-widgets";
import { definePlugin, type PluginDefinition } from "../../../../plugins/plugin-context";
import type { AnyWidget } from "../define-widget";
import { RevenueCard, UnpaidCard } from "./plugin/admin";
import { widgets } from "./plugin/widgets";

const shop = definePlugin({
  name: "shop",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard: { widgets } },
});
`;

const CASES: Case[] = [
  // ---- A setting read as the wrong type, in each of the three places.
  {
    name: "a data function reads a setting as the wrong type",
    ...pair(
      t =>
        widget(`  settings: { items: setting.number({ label: "Items", defaultValue: 5 }) },
  load: async ({ settings }) => {
    const items: ${t} = settings.items; ${MARK}
    return { total: Number(items) };
  },
  view: "figure",`),
      "string",
      "number"
    ),
    code: 2322,
    message: "Type 'number' is not assignable to type 'string'",
  },
  // ---- A widget's data comes from a function: the `{ query }` form is gone.
  {
    name: "a widget's load is a function, not a query for core to run",
    ...pair(
      load =>
        widget(`  settings: { collection: setting.collection({ label: "Collection" }) },
  load: ${load}, ${MARK}
  view: "figure",`),
      // No parameter: one the form no longer types would add an implicit-any error of its own.
      `{ query: () => ({ collection: "orders", op: "count" }) }`,
      `async ({ services, settings }) => ({ total: await services.count(settings.collection) })`
    ),
    code: 2353,
    message: "'query' does not exist in type",
  },
  {
    name: "the package root no longer publishes the query a widget handed core",
    ...pair(
      name => `import type { ${name} } from "../../../../index"; ${MARK}

export type Published = ${name};
`,
      "ContentQuery",
      "WidgetAccess"
    ),
    code: 2305,
    message: "has no exported member 'ContentQuery'",
  },
  {
    name: "a component reads a setting as the wrong type, through import type",
    ...pair(
      t => `import type { WidgetProps } from "../define-widget";
import type { revenue } from "./plugin/widgets";

export function Card({ settings }: WidgetProps<typeof revenue>) {
  const net: ${t} = settings.net; ${MARK}
  return net;
}
`,
      "string",
      "boolean"
    ),
    code: 2322,
    message: "Type 'boolean' is not assignable to type 'string'",
  },
  {
    name: "a component compares a select setting with a value it does not offer",
    ...pair(
      option => `import type { WidgetProps } from "../define-widget";
import type { revenue } from "./plugin/widgets";

export function Card({ settings }: WidgetProps<typeof revenue>) {
  return settings.currency === "${option}"; ${MARK}
}
`,
      "gbp",
      "eur"
    ),
    code: 2367,
    message: "have no overlap",
  },
  {
    name: "a component reads its data as the wrong type",
    ...pair(
      t => `import type { WidgetProps } from "../define-widget";
import type { revenue } from "./plugin/widgets";

export function Card({ data }: WidgetProps<typeof revenue>) {
  const total: ${t} = data.points[0].total; ${MARK}
  return total;
}
`,
      "string",
      "number"
    ),
    code: 2322,
    message: "Type 'number' is not assignable to type 'string'",
  },

  // ---- Each core view refuses data of a shape it does not draw.
  ...VIEWS.map(
    ([view, display]): Case => ({
      name: `the ${view} view refuses a data function's answer of another shape`,
      ...pair(
        shape =>
          widget(`  load: async () => (${shape}), ${MARK}
  view: "${view}",`),
        WRONG_SHAPE[display],
        SHAPES[display]
      ),
      code: 2322,
      message: `Property '${DRAWN_FIELD[display]}' is missing`,
    })
  ),

  // ---- A data function's answer holds only what JSON carries unchanged.
  ...[
    { kind: "a function", value: `() => "today"` },
    { kind: "a date object", value: `new Date("2026-10-01")` },
    { kind: "a map", value: `new Map([["paid", 3]])` },
    { kind: "a set", value: `new Set(["paid"])` },
    { kind: "a bigint", value: `BigInt(3)` },
    { kind: "a symbol", value: `Symbol("paid")` },
  ].map(
    ({ kind, value }): Case => ({
      name: `a data function's answer may not hold ${kind}`,
      ...pair(
        held =>
          widget(`  load: async () => ({ held: ${held} }), ${MARK}
  view: { component: "@test/w/admin#Card" },
  isEmpty: () => false,`),
        value,
        `"today"`
      ),
      code: 2322,
      message: "is not assignable to type 'never'",
    })
  ),

  {
    name: "a core display's data function may not answer a bigint beside its shape",
    ...pair(
      extra =>
        widget(`  load: async () => ({ total: 3, extra: ${extra} }), ${MARK}
  view: "figure",`),
      "BigInt(1)",
      `"one"`
    ),
    code: 2322,
    message: "is not assignable to type 'never'",
  },
  {
    name: "a core display's rows may not hold a date object",
    ...pair(
      at =>
        widget(`  load: async () => ({ items: [{ title: "First", at: ${at} }] }), ${MARK}
  view: "list",`),
      `new Date("2026-10-01")`,
      `"2026-10-01"`
    ),
    code: 2322,
    message: "is not assignable to type 'never'",
  },

  // ---- A preview case is of the widget's own data and settings types.
  {
    name: "a core view refuses a preview case of another shape, at the case",
    ...pair(
      count =>
        widget(`  load: async () => ({ total: 3 }),
  view: "figure",
  preview: [{ name: "Three", data: { total: ${count} } }], ${MARK}`),
      `"three"`,
      "3"
    ),
    code: 2322,
    message: "Type 'string' is not assignable to type 'number'",
  },
  {
    name: "a core view refuses a preview case drawn with a setting value the widget does not offer",
    ...pair(
      range =>
        widget(`  settings: { range: setting.dateRange({ label: "Date range" }) },
  load: async () => ({ total: 3 }),
  view: "figure",
  preview: [{ name: "Year", data: { total: 3 }, settings: { range: "${range}" } }], ${MARK}`),
      "1y",
      "12m"
    ),
    code: 2322,
    message: `Type '"1y"' is not assignable to type`,
  },
  {
    name: "a component widget with a mismatched preview case cannot be used",
    ...pair(
      range => `${imports}import type { AnyWidget } from "../define-widget";

const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  settings: { range: setting.dateRange({ label: "Date range" }) },
  load: async ({ settings }) => ({ range: settings.range }),
  view: { component: "@test/w/admin#Card" },
  isEmpty: () => false,
  preview: [{ name: "Week", data: { range: "${range}" } }],
});

export const contributed: AnyWidget = w; ${MARK}
`,
      "1y",
      "7d"
    ),
    code: 2739,
    message:
      "This widget's preview cases are not of the type its data and settings have",
  },

  {
    name: "a component cannot be typed for a widget with a mismatched preview case",
    ...pair(
      range => `${imports}import type { WidgetProps } from "../define-widget";

const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  settings: { range: setting.dateRange({ label: "Date range" }) },
  load: async ({ settings }) => ({ range: settings.range }),
  view: { component: "@test/w/admin#Card" },
  isEmpty: () => false,
  preview: [{ name: "Week", data: { range: "${range}" } }],
});

export function Card(props: WidgetProps<typeof w>) { ${MARK}
  return props.widgetId;
}
`,
      "1y",
      "7d"
    ),
    code: 2344,
    message: "does not satisfy the constraint 'AnyWidget'",
    typeScript7: {
      code: 2739,
      message:
        "This widget's preview cases are not of the type its data and settings have",
    },
  },

  {
    name: "a widget's empty test reads its data as the wrong type",
    ...pair(
      t =>
        widget(`  settings: { range: setting.dateRange({ label: "Date range" }) },
  load: async ({ settings }) => ({ days: [settings.range] }),
  view: { component: "@test/w/admin#Card" },
  isEmpty: data => { const days: ${t} = data.days; return days.length === 0; }, ${MARK}`),
      "string",
      "readonly string[]"
    ),
    code: 2322,
    message: `Type '("7d" | "30d" | "90d" | "12m")[]' is not assignable to type 'string'`,
    typeScript7: {
      message: `Type '("12m" | "30d" | "7d" | "90d")[]' is not assignable to type 'string'`,
    },
  },

  {
    name: "an admin entry registers a component written for another widget",
    ...pair(
      card => `import type { WidgetComponentMap } from "../define-widget";
import { RevenueCard, UnpaidCard } from "./plugin/admin";
import type { widgets } from "./plugin/widgets";

export const components = {
  "@acme/nextly-plugin-shop/admin#RevenueCard": ${card}, ${MARK}
  "@acme/nextly-plugin-shop/admin#UnpaidCard": UnpaidCard,
} satisfies WidgetComponentMap<(typeof widgets)[number]>;
`,
      "UnpaidCard",
      "RevenueCard"
    ),
    code: 2322,
    message: "is not assignable to type '(props: WidgetProps<",
  },
  {
    name: "an admin entry leaves a declared component path without a component",
    ...pair(
      entry => `import type { WidgetComponentMap } from "../define-widget";
import { RevenueCard, UnpaidCard } from "./plugin/admin";
import type { widgets } from "./plugin/widgets";

export const components = {
  "@acme/nextly-plugin-shop/admin#RevenueCard": RevenueCard,${entry}
} satisfies WidgetComponentMap<(typeof widgets)[number]>; ${MARK}
`,
      "",
      `
  "@acme/nextly-plugin-shop/admin#UnpaidCard": UnpaidCard,`
    ),
    code: 1360,
    message: "@acme/nextly-plugin-shop/admin#UnpaidCard",
    typeScript7: { code: 2741 },
  },

  {
    // Reported at the declaration itself, which lacks the field, since there
    // is no line of the test to report it on.
    name: "a component view leaves out the isEmpty test it must give",
    ...pair(
      test => `${imports}
export const w = defineWidget({ ${MARK}
  id: "test/w",
  title: "W",
  description: "A widget under test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ days: ["7d"] }),
  view: { component: "@test/w/admin#Card" },${test}
  empty: { message: "Nothing in this range" },
});
`,
      "",
      `
  isEmpty: data => data.days.length === 0,`
    ),
    code: 2345,
    message: "Property 'isEmpty' is missing",
  },

  {
    name: "a widget's view is one view, not a choice of several",
    ...pair(
      type => `${imports}import type { CoreView } from "../displays";

declare const chosen: ${type};

export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ total: 3 }),
  view: chosen, ${MARK}
});
`,
      "CoreView",
      `"figure"`
    ),
    code: 2322,
    message: "view must be exactly one view, not a choice of several",
  },
  {
    name: "a component view's path is a literal, not read from a string",
    ...pair(
      display => `${imports}import type { ComponentDisplay } from "../displays";

const card: ComponentDisplay = { component: "@test/w/admin#Card" };

export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ total: 3 }),
  view: ${display}, ${MARK}
  isEmpty: () => false,
});
`,
      "card",
      `{ component: "@test/w/admin#Card" }`
    ),
    code: 2322,
    message: "a component view's path must be written as a literal string",
  },
  {
    // Narrower than `string`, but still a pattern: a map keyed by it is an
    // index signature that an empty map satisfies, as one keyed by `string`.
    name: "a component view's path is a literal, not a template pattern",
    ...pair(
      display => `${imports}declare const pattern: \`@test/\${string}/admin#Card\`;

export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ total: 3 }),
  view: ${display}, ${MARK}
  isEmpty: () => false,
});
`,
      "{ component: pattern }",
      `{ component: "@test/w/admin#Card" }`
    ),
    code: 2322,
    message: "a component view's path must be written as a literal string",
  },
  {
    name: "a data function's answer may not hold a symbol-keyed property",
    ...pair(
      property => `${imports}
const tag = Symbol("tag");

export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ ${property} }), ${MARK}
  view: { component: "@test/w/admin#Card" },
  isEmpty: () => false,
});
`,
      `[tag]: "paid"`,
      `paid: tag.description ?? ""`
    ),
    code: 2322,
    message: "is not assignable to type 'never'",
  },
  {
    name: "a hand-written object is not a widget a plugin can contribute",
    ...pair(
      entry => `import type { DashboardContribution } from "../dashboard";
import { recentOrders } from "./plugin/widgets";

const fake = { id: "acme/fake", view: "figure" } as const;

export const dashboard: DashboardContribution = {
  widgets: [${entry}], ${MARK}
};
`,
      "fake",
      "recentOrders"
    ),
    code: 2741,
    message: "but required in type 'AnyWidget'",
  },
  {
    name: "a component at a path two widgets share must take both widgets' props",
    ...pair(
      props => `${imports}import type { WidgetComponentMap, WidgetProps } from "../define-widget";

const one = defineWidget({
  id: "test/one",
  title: "One",
  description: "The first widget at the shared path",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ one: 1 }),
  view: { component: "@test/w/admin#Shared" },
  isEmpty: () => false,
});

const two = defineWidget({
  id: "test/two",
  title: "Two",
  description: "The second widget at the shared path",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  load: async () => ({ two: "2" }),
  view: { component: "@test/w/admin#Shared" },
  isEmpty: () => false,
});

declare function Shared(props: ${props}): string;

export const components = {
  "@test/w/admin#Shared": Shared, ${MARK}
} satisfies WidgetComponentMap<typeof one | typeof two>;
`,
      "WidgetProps<typeof one>",
      "WidgetProps<typeof one> | WidgetProps<typeof two>"
    ),
    code: 2322,
    message: "is not assignable to type '(props:",
  },

  // ---- What else the declaration checks where it is written.
  {
    name: "a setting is declared without a label",
    ...pair(
      config =>
        widget(`  settings: { items: setting.number(${config}) }, ${MARK}
  load: async () => ({ total: 3 }),
  view: "figure",`),
      `{ defaultValue: 5 }`,
      `{ label: "Items", defaultValue: 5 }`
    ),
    code: 2345,
    message: "Property 'label' is missing",
  },
  {
    name: "a dependent setting names no Collection setting of the widget's",
    ...pair(
      on =>
        widget(`  settings: {
    collection: setting.collection({ label: "Collection" }),
    sort: setting.sort({ of: "${on}", label: "Sort" }), ${MARK}
  },
  load: async () => ({ total: 3 }),
  view: "figure",`),
      "colection",
      "collection"
    ),
    code: 2322,
    message: `'"colection"' is not assignable to type '"collection"'`,
  },
  {
    name: "a size written as a named width",
    ...pair(
      size => `${imports}
export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: ${size}, ${MARK}
  load: async () => ({ total: 3 }),
  view: "figure",
});
`,
      `"half"`,
      `{ default: { w: 6, h: 4 } }`
    ),
    code: 2322,
    message: `is not assignable to type 'WidgetSizeDeclaration'`,
  },
  {
    name: "a size missing one of its directions",
    ...pair(
      start => `${imports}
export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: ${start} }, ${MARK}
  load: async () => ({ total: 3 }),
  view: "figure",
});
`,
      `{ w: 6 }`,
      `{ w: 6, h: 4 }`
    ),
    code: 2741,
    message: `Property 'h' is missing in type '{ w: number; }' but required in type 'GridSize'`,
  },
  {
    name: "the named width a declaration once stated beside its size",
    ...pair(
      line => `${imports}
export const w = defineWidget({
  id: "test/w",
  title: "W",
  description: "A widget under test",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
${line}
  load: async () => ({ total: 3 }),
  view: "figure",
});
`,
      `  width: "full", ${MARK}`,
      `  several: true,`
    ),
    code: 2353,
    message: `'width' does not exist in type`,
  },
  {
    name: "a plugin offers an alternative to a built-in widget that does not exist",
    ...pair(
      core => `import type { DashboardContribution } from "../dashboard";
import { recentOrders } from "./plugin/widgets";

export const dashboard: DashboardContribution = {
  widgets: [recentOrders],
  alternatives: { "acme/recent-orders": "${core}" }, ${MARK}
};
`,
      "core/recently-edit",
      "core/recently-edited"
    ),
    // 2820 is 2322 with a suggestion: the compiler names the id it meant.
    code: 2820,
    message: `Did you mean '"core/recently-edited"'?`,
  },
  {
    name: "where a plugin's widgets are known, it may suggest only its own",
    ...pair(
      id => `import type { DashboardContribution } from "../dashboard";
import { ordersByState, recentOrders } from "./plugin/widgets";

export const dashboard: DashboardContribution<
  typeof ordersByState | typeof recentOrders
> = {
  widgets: [ordersByState, recentOrders],
  suggest: ["${id}"], ${MARK}
};
`,
      "acme/revenue",
      "acme/orders-by-state"
    ),
    code: 2322,
    message: `Type '"acme/revenue"' is not assignable to type`,
  },
  {
    name: "where a plugin's widgets are known, it may offer only its own as an alternative",
    ...pair(
      id => `import type { DashboardContribution } from "../dashboard";
import { ordersByState, recentOrders } from "./plugin/widgets";

export const dashboard: DashboardContribution<
  typeof ordersByState | typeof recentOrders
> = {
  widgets: [ordersByState, recentOrders],
  alternatives: { "${id}": "core/recently-edited" }, ${MARK}
};
`,
      "acme/revenue",
      "acme/recent-orders"
    ),
    code: 2353,
    message: "'\"acme/revenue\"' does not exist in type",
  },

  // A site's generated admin component map, checked against the widgets its config declares,
  // kept from `definePlugin` through `defineConfig`. No plugin or site annotates anything here.
  {
    name: "a site's generated map registers a plugin's component under another widget's path",
    ...pair(
      card => `${SITE}
const config = defineConfig({ plugins: [shop] });

export const registered = {
  "@acme/nextly-plugin-shop/admin#RevenueCard": ${card}, ${MARK}
  "@acme/nextly-plugin-shop/admin#UnpaidCard": UnpaidCard,
  "@nextlyhq/plugin-page-builder/admin#BlocksField": (): null => null,
} satisfies DeclaredComponentMap<typeof config>;
`,
      "UnpaidCard",
      "RevenueCard"
    ),
    code: 2322,
    message: "is not assignable to type '(props: WidgetProps<",
  },
  {
    // 🔴 A widget whose component path is a plain string turns a map over every widget into an
    // index signature, which absorbs the typed paths and takes any component. Its plugin first,
    // in case inference would let it stand for the plugins after it.
    name: "an untyped plugin beside a typed one does not switch the map's check off",
    ...pair(
      card => `${SITE}
// A widget whose component path the compiler cannot know: declared from a string variable.
declare const someWidgets: readonly (AnyWidget & {
  readonly view: { component: string };
})[];
const legacy = definePlugin({
  name: "legacy",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard: { widgets: someWidgets } },
});
const config = defineConfig({ plugins: [legacy, shop] });

export const registered = {
  "legacy/admin#Card": (): null => null,
  "@acme/nextly-plugin-shop/admin#RevenueCard": ${card}, ${MARK}
  "@acme/nextly-plugin-shop/admin#UnpaidCard": UnpaidCard,
} satisfies DeclaredComponentMap<typeof config>;
`,
      "UnpaidCard",
      "RevenueCard"
    ),
    code: 2322,
    message: "is not assignable to type '(props: WidgetProps<",
  },
  {
    // A plugin typed `any` (a JavaScript plugin with no declarations) must not collapse the list's
    // element type to `any`, which would erase the typed plugins beside it.
    name: "a plugin typed any beside a typed one does not switch the map's check off",
    ...pair(
      card => `${SITE}
declare const fromJavaScript: any;
const config = defineConfig({ plugins: [fromJavaScript, shop] });

export const registered = {
  "@acme/nextly-plugin-shop/admin#RevenueCard": ${card}, ${MARK}
  "@acme/nextly-plugin-shop/admin#UnpaidCard": UnpaidCard,
} satisfies DeclaredComponentMap<typeof config>;
`,
      "UnpaidCard",
      "RevenueCard"
    ),
    code: 2322,
    message: "is not assignable to type '(props: WidgetProps<",
  },
  {
    name: "a site's config keeps a plugin's widget, and its props, through definePlugin and defineConfig",
    ...pair(
      kept => `${SITE}
const config = defineConfig({ plugins: [shop] });
type Revenue = Extract<WidgetsOf<typeof config>, { readonly id: "acme/revenue" }>;
type Kept = [Revenue] extends [never] ? "lost" : "kept";

export const revenueKept: Kept = ${kept}; ${MARK}
`,
      `"lost"`,
      `"kept"`
    ),
    code: 2322,
    message: `Type '"lost"' is not assignable to type '"kept"'`,
  },
  {
    name: "a plugin suggests a widget id it does not declare",
    ...pair(
      id => `import { definePlugin } from "../../../../plugins/plugin-context";
import { widgets } from "./plugin/widgets";

export const shop = definePlugin({
  name: "shop",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    dashboard: {
      widgets,
      suggest: ["${id}"], ${MARK}
    },
  },
});
`,
      "acme/orders-by-stat",
      "acme/orders-by-state"
    ),
    // 2820: the "did you mean" form, since the misspelt id is one letter from a declared one.
    code: 2820,
    message: `Type '"acme/orders-by-stat"' is not assignable to type`,
  },
];

/**
 * What must keep compiling as it did before the widgets' types were kept: plugins and configs
 * written without them. Each is a whole file that must compile with no error at all.
 */
const COMPILES: ReadonlyArray<{ name: string; source: string }> = [
  {
    name: "a plugin with no dashboard is today's PluginDefinition, and its config's map checks nothing",
    source: `import { defineConfig } from "../../../../collections/config/define-config";
import type { DeclaredComponentMap } from "../../../../plugins/declared-widgets";
import { definePlugin, type PluginDefinition } from "../../../../plugins/plugin-context";

const plain = definePlugin({ name: "plain", version: "1.0.0", nextly: "*" });
export const asBefore: PluginDefinition = plain;
const config = defineConfig({ plugins: [plain] });
export const registered = {
  "plain/admin#Page": (): null => null,
} satisfies DeclaredComponentMap<typeof config>;
`,
  },
  {
    name: "a typed plugin still goes where a PluginDefinition does",
    source: `import { definePlugin, type PluginDefinition } from "../../../../plugins/plugin-context";
import { widgets } from "./plugin/widgets";

const shop = definePlugin({ name: "shop", version: "1.0.0", nextly: "*", contributes: { dashboard: { widgets } } });
export const annotated: PluginDefinition = shop;
export const list: PluginDefinition[] = [shop, definePlugin({ name: "plain", version: "1.0.0", nextly: "*" })];
`,
  },
  {
    name: "a renamed plugin keeps its widgets' types",
    source: `import { definePlugin, type PluginDefinition } from "../../../../plugins/plugin-context";
import { widgets } from "./plugin/widgets";

const renamed = definePlugin({
  name: "shop",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard: { widgets } },
}).rename?.({ orders: "shop-orders" });
type Ids = NonNullable<typeof renamed> extends PluginDefinition<infer W> ? W["id"] : never;
type Kept = string extends Ids ? "lost" : "kept";
export const kept: Kept = "kept";
`,
  },
  {
    name: "a plugin written as a plain object, and a pre-typed config, compile as before",
    source: `import { defineConfig, type NextlyConfig } from "../../../../collections/config/define-config";
import type { DeclaredComponentMap } from "../../../../plugins/declared-widgets";

export const fromObject = defineConfig({ plugins: [{ name: "object", version: "1.0.0", nextly: "*" }] });
declare const written: NextlyConfig;
const fromVariable = defineConfig(written);
export const registered = {
  "any/admin#Card": (): null => null,
} satisfies DeclaredComponentMap<typeof fromVariable>;
`,
  },
  {
    // 🔴 The config's type includes every branch, so a plugin added only when a setting is on is
    // declared there, while the map generated without that setting has no component for it.
    // Requiring one refused the site's own build; the admin's check at run time is what refuses
    // a missing component, when the plugin is actually on.
    name: "a plugin the config adds only when a setting is on needs no component in the map",
    source: `import { defineConfig } from "../../../../collections/config/define-config";
import type { DeclaredComponentMap } from "../../../../plugins/declared-widgets";
import { definePlugin } from "../../../../plugins/plugin-context";
import { widgets } from "./plugin/widgets";

declare const turnedOn: boolean;
const shop = definePlugin({
  name: "shop",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard: { widgets } },
});
const config = defineConfig({ plugins: [...(turnedOn ? [shop] : [])] });
export const registered = {
  "@nextlyhq/plugin-page-builder/admin#BlocksField": (): null => null,
} satisfies DeclaredComponentMap<typeof config>;
`,
  },
  {
    name: "a JavaScript config, typed any, leaves the map unchecked rather than failing",
    source: `import type { DeclaredComponentMap } from "../../../../plugins/declared-widgets";

export const registered = {
  "any/admin#Card": (): null => null,
} satisfies DeclaredComponentMap<any>;
`,
  },
  {
    name: "a plugin with untyped widgets keeps today's string ids for suggest",
    source: `import { definePlugin } from "../../../../plugins/plugin-context";
import type { AnyWidget } from "../define-widget";

declare const someWidgets: readonly AnyWidget[];
declare const ids: string[];
export const legacy = definePlugin({
  name: "legacy",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard: { widgets: someWidgets, suggest: ids } },
});
`,
  },
];

/** Where each case's two forms are compiled, as if they sat in this folder. */
function casePath(index: number, form: "faulty" | "corrected"): string {
  return join(here, `case-${index}-${form}.ts`);
}

/** Where each file that must compile cleanly is compiled. */
function compilesPath(index: number): string {
  return join(here, `compiles-${index}.ts`);
}

/** One diagnostic, as a reader of a failure would want it. */
interface CaseDiagnostic {
  line: number | undefined;
  code: number;
  message: string;
}

/** The diagnostics of every case file, compiled together in one program. */
let diagnosticsByFile: Map<string, readonly CaseDiagnostic[]>;

beforeAll(() => {
  const virtual = new Map<string, string>();
  CASES.forEach((c, index) => {
    virtual.set(casePath(index, "faulty"), c.faulty);
    virtual.set(casePath(index, "corrected"), c.corrected);
  });
  COMPILES.forEach((c, index) => {
    virtual.set(compilesPath(index), c.source);
  });

  // The cases are written to a directory of their own, laid out like this
  // package's `src`, and `rootDirs` merges the two: a case's relative imports
  // reach the real modules as they would from this folder. It sits in the
  // package's `.turbo`, which git and every scan of the tree ignore, so no
  // other suite sees a case come and go; and `rootDir` widens to the package,
  // which holds both. The package's own config is extended, so a case
  // compiles exactly as a file in this folder would under `check-types`.
  const parent = join(packageRoot, ".turbo");
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, "widget-cases-")).replaceAll(
    "\\",
    "/"
  );
  const mirror = (path: string) =>
    join(scratch, posix.relative(packageRoot, path));
  try {
    for (const [path, text] of virtual) {
      mkdirSync(dirname(mirror(path)), { recursive: true });
      writeFileSync(mirror(path), text, { flag: "wx" });
    }
    const config = join(scratch, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(packageRoot, "tsconfig.json"),
        compilerOptions: {
          rootDir: packageRoot,
          rootDirs: [join(scratch, "src"), join(packageRoot, "src")],
        },
        files: [...virtual.keys()].map(mirror),
        include: [],
      }),
      { flag: "wx" }
    );

    // Every case is in the program, or its silence would be a skipped case.
    const listed = new Set(listedFiles(config));
    for (const path of virtual.keys()) {
      if (!listed.has(mirror(path))) throw new Error(`Not compiled: ${path}`);
    }

    const diagnostics = compile(["-p", config], scratch);
    // tsc names a file relative to where it runs, or in full outside it.
    const fromScratch = (file: string) =>
      /^([A-Za-z]:)?\//.test(file) ? file : join(scratch, file);
    diagnosticsByFile = new Map(
      [...virtual.keys()].map(path => [
        path,
        diagnostics
          .filter(d => d.file && fromScratch(d.file) === mirror(path))
          .map(d => ({
            line: d.line,
            code: Number(d.code.slice(2)),
            message: d.message,
          })),
      ])
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);

describe("a widget declaration refuses to compile", () => {
  it("compiles every case, so none is skipped for want of a file", () => {
    expect(diagnosticsByFile.size).toBe(CASES.length * 2 + COMPILES.length);
  });

  CASES.forEach((c, index) => {
    describe(c.name, () => {
      it("fails once, on the marked line, for the named reason", () => {
        const markedLine =
          c.faulty.split("\n").findIndex(line => line.includes(MARK)) + 1;
        expect(markedLine).toBeGreaterThan(0);

        const found = diagnosticsByFile.get(casePath(index, "faulty")) ?? [];
        const expected = tscMajor() >= 7 ? { ...c, ...c.typeScript7 } : c;
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({
          line: markedLine,
          code: expected.code,
        });
        expect(found[0]?.message).toContain(expected.message);
      });

      it("compiles once the fault is put right", () => {
        const found = diagnosticsByFile.get(casePath(index, "corrected")) ?? [];
        expect(found).toEqual([]);
      });
    });
  });
});

describe("plugins and configs written without their widgets' types compile as before", () => {
  COMPILES.forEach((c, index) => {
    it(c.name, () => {
      const found = diagnosticsByFile.get(compilesPath(index)) ?? [];
      expect(found).toEqual([]);
    });
  });
});
