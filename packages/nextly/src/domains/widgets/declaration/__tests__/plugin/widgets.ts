/**
 * A plugin's widgets, written as an author would write them: the server half.
 *
 * One widget of each kind -- a data function behind a core display, a query
 * behind a core display, and a data function and a query each behind a
 * component of the plugin's own -- plus the plugin's dashboard contribution.
 * `admin.ts` beside it is the browser half, and reaches these only through
 * `import type`.
 *
 * Type tests read these declarations; nothing runs them.
 */

import type { DashboardContribution } from "../../dashboard";
import { defineAttentionItem } from "../../dashboard";
import { defineWidget } from "../../define-widget";
import { settings } from "../../setting-builders";

/** A data function behind core's `bars` display. */
export const ordersByState = defineWidget({
  id: "acme/orders-by-state",
  title: "Orders by state",
  description: "How many orders sit in each state",
  category: "Shop",
  widths: ["1/3", "1/2", "2/3"],
  width: "1/2",
  permission: "read-orders",
  sketch: "bars",
  settings: {
    range: settings.dateRange({ default: "30d" }),
    top: settings.items({ default: 5 }),
  },
  data: async ({ settings, services, signal }) => {
    const paid = await services.count("orders", {
      where: { state: { equals: "paid" }, placedWithin: settings.range },
      signal,
    });
    return { buckets: [{ value: "paid", count: paid }].slice(0, settings.top) };
  },
  display: "bars",
  example: { buckets: [{ value: "paid", count: 12 }] },
});

/** A query core runs, behind core's `list` display, written from settings. */
export const recentOrders = defineWidget({
  id: "acme/recent-orders",
  title: "Recent orders",
  description: "The newest orders",
  category: "Shop",
  widths: ["1/2", "full"],
  width: "full",
  several: true,
  settings: {
    collection: settings.collection(),
    sort: settings.sort({ of: "collection", default: "-createdAt" }),
    items: settings.items({ default: 5 }),
  },
  data: {
    query: ({ settings }) => ({
      collection: settings.collection,
      op: "list",
      sort: settings.sort,
      limit: settings.items,
    }),
  },
  display: "list",
});

/** A data function behind a component of the plugin's own. */
export const revenue = defineWidget({
  id: "acme/revenue",
  title: "Revenue",
  description: "Takings per day over the chosen range",
  category: "Shop",
  widths: ["1/2", "2/3", "full"],
  width: "2/3",
  settings: {
    range: settings.dateRange({ default: "30d" }),
    currency: settings.select({ options: ["usd", "eur"], default: "usd" }),
    net: settings.toggle({ default: false }),
  },
  data: async ({ settings }) => ({
    currency: settings.currency,
    points: [{ day: "2026-10-01", total: settings.net ? 90 : 100 }],
  }),
  display: { component: "@acme/nextly-plugin-shop/admin#RevenueCard" },
  empty: {
    when: data => data.points.length === 0,
    message: "No takings in this range",
    action: {
      label: "Add a product",
      link: "collections/products/create",
      permission: "create-products",
    },
  },
  example: { currency: "eur", points: [{ day: "2026-10-01", total: 12 }] },
});

/** A query core runs, behind a component of the plugin's own. */
export const unpaidCount = defineWidget({
  id: "acme/unpaid-count",
  title: "Unpaid",
  description: "Orders waiting for payment",
  category: "Shop",
  widths: ["1/4", "1/3"],
  width: "1/4",
  settings: { collection: settings.collection() },
  data: {
    query: ({ settings }) => ({ collection: settings.collection, op: "count" }),
  },
  display: { component: "@acme/nextly-plugin-shop/admin#UnpaidCard" },
});

/**
 * Every widget the plugin declares, as a tuple so each keeps its own type: the
 * admin half checks its component map against these.
 */
export const widgets = [
  ordersByState,
  recentOrders,
  revenue,
  unpaidCount,
] as const;

/**
 * The plugin's `contributes.dashboard`: its widgets, the one it suggests for
 * the default dashboard, the one it offers in place of a built-in card, and a
 * line for the Needs attention card.
 */
export const dashboard: DashboardContribution = {
  widgets,
  suggest: ["acme/orders-by-state"],
  alternatives: { "acme/recent-orders": "core/recently-edited" },
  attention: [
    defineAttentionItem({
      id: "acme/unpaid",
      label: "Unpaid orders",
      collections: ["orders"],
      count: ({ services, signal }) =>
        services.count("orders", {
          where: { paid: { equals: false } },
          signal,
        }),
      link: "collections/orders?paid=false",
    }),
  ],
};
