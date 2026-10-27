/**
 * A plugin's widgets, written as an author would write them: the server half.
 *
 * One widget of each kind -- a data function behind a core view, a query
 * behind a core view, and a data function and a query each behind a
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

/** A data function behind core's `bars` view. */
export const ordersByState = defineWidget({
  id: "acme/orders-by-state",
  title: "Orders by state",
  description: "How many orders sit in each state",
  category: "Shop",
  size: { default: { w: 6, h: 4 }, min: { w: 4, h: 3 }, max: { w: 8, h: 6 } },
  access: "read-orders",
  settings: {
    range: settings.dateRange({ default: "30d" }),
    top: settings.items({ default: 5 }),
  },
  load: async ({ settings, services, signal }) => {
    const paid = await services.count("orders", {
      where: { state: { equals: "paid" }, placedWithin: settings.range },
      signal,
    });
    return { buckets: [{ value: "paid", count: paid }].slice(0, settings.top) };
  },
  view: "bars",
  preview: [
    { name: "Some paid", data: { buckets: [{ value: "paid", count: 12 }] } },
  ],
});

/** A query core runs, behind core's `list` view, written from settings. */
export const recentOrders = defineWidget({
  id: "acme/recent-orders",
  title: "Recent orders",
  description: "The newest orders",
  category: "Shop",
  size: { default: { w: 12, h: 5 }, min: { w: 6, h: 4 }, max: { w: 12, h: 8 } },
  several: true,
  settings: {
    collection: settings.collection(),
    sort: settings.sort({ of: "collection", default: "-createdAt" }),
    items: settings.items({ default: 5 }),
  },
  load: {
    query: ({ settings }) => ({
      collection: settings.collection,
      op: "list",
      select: ["title"],
      sort: settings.sort,
      limit: settings.items,
    }),
  },
  view: "list",
});

/** A data function behind a component of the plugin's own. */
export const revenue = defineWidget({
  id: "acme/revenue",
  title: "Revenue",
  description: "Takings per day over the chosen range",
  category: "Shop",
  size: { default: { w: 8, h: 4 }, min: { w: 6, h: 4 } },
  settings: {
    range: settings.dateRange({ default: "30d" }),
    currency: settings.select({ options: ["usd", "eur"], default: "usd" }),
    net: settings.toggle({ default: false }),
  },
  load: async ({ settings }) => ({
    currency: settings.currency,
    points: [{ day: "2026-10-01", total: settings.net ? 90 : 100 }],
  }),
  view: { component: "@acme/nextly-plugin-shop/admin#RevenueCard" },
  isEmpty: data => data.points.length === 0,
  empty: {
    message: "No takings in this range",
    action: {
      label: "Add a product",
      link: "collections/products/create",
      permission: "create-products",
    },
  },
  preview: [
    {
      name: "One day",
      data: { currency: "eur", points: [{ day: "2026-10-01", total: 12 }] },
      settings: { currency: "eur" },
    },
  ],
});

/** A query core runs, behind a component of the plugin's own. */
export const unpaidCount = defineWidget({
  id: "acme/unpaid-count",
  title: "Unpaid",
  description: "Orders waiting for payment",
  category: "Shop",
  size: { default: { w: 3, h: 2 }, max: { w: 4, h: 2 } },
  settings: { collection: settings.collection() },
  load: {
    query: ({ settings }) => ({ collection: settings.collection, op: "count" }),
  },
  view: { component: "@acme/nextly-plugin-shop/admin#UnpaidCard" },
  isEmpty: data => data.total === 0,
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
