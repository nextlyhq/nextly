/**
 * A fixture plugin for the e2e suite: two widgets declared with `defineWidget`
 * and drawn by their own components, so e2e/tests/plugin-widget-kit.spec.ts can
 * prove a plugin card built only from `@nextlyhq/plugin-sdk/admin`'s widget kit
 * draws beside core's in light and dark, and that a component throwing while it
 * draws is that card's error alone. Beside them, widgets drawn by core displays:
 * one whose data function throws, one its `shows` leaves out, and the layout
 * cases the other dashboard specs need.
 *
 * Always registered, unlike the gated fixtures: a widget drawn by its own
 * component must be in the committed component map, which is generated with
 * the gated fixtures off. Neither card is placed on a dashboard by default (a
 * declared widget never is); a contributor meets them only in the add panel,
 * named as test fixtures.
 */
// Through the plugin SDK, as a plugin imports them, so this fixture proves
// the SDK's own exports.
import { definePlugin, defineWidget } from "@nextlyhq/plugin-sdk";
// The setting builders are not re-exported by the SDK yet, so the one widget with a setting takes
// them from core, as an app may.
import { widgetSettings } from "nextly";

/** The two components, as the generated component map imports them. */
const KIT_CARD_COMPONENT = "@/plugins/widget-kit-fixture/admin#KitCard";
const THROWING_CARD_COMPONENT =
  "@/plugins/widget-kit-fixture/admin#ThrowingCard";

/** A card built only from the widget kit: a figure and a chart of groups. */
export const kitCardWidget = defineWidget({
  id: "widget-kit-fixture/kit",
  title: "Test fixture: widget kit",
  description:
    "Exists for the e2e suite: a card built only from the plugin widget kit.",
  category: "Fixtures",
  size: { default: { w: 6, h: 4 }, min: { w: 6, h: 4 } },
  load: async () => ({
    total: 1234,
    groups: [
      { key: "open", label: "Open", count: 3, value: "open" },
      { key: "paid", label: "Paid", count: 5, value: "paid" },
    ],
  }),
  view: { component: KIT_CARD_COMPONENT },
  isEmpty: data => data.groups.length === 0,
});

/** A card whose component throws while it draws. */
const throwingCardWidget = defineWidget({
  id: "widget-kit-fixture/throws",
  title: "Test fixture: throwing card",
  description:
    "Exists for the e2e suite: its component throws; the error stays in its own card.",
  category: "Fixtures",
  size: { default: { w: 6, h: 4 }, min: { w: 6, h: 4 } },
  load: async () => ({ total: 0 }),
  view: { component: THROWING_CARD_COMPONENT },
  // Never empty, so the card always reaches the component that throws.
  isEmpty: () => false,
});

/**
 * A card whose answer is always empty and whose widget hides when empty: off the dashboard at
 * rest, and shown marked "Hidden while empty" in customise mode, where it can still be removed.
 * Drawn by core's bars display, whose own rule reads no groups as empty, so it needs no component
 * of its own in the generated map.
 */
const hidesWhenEmptyWidget = defineWidget({
  id: "widget-kit-fixture/hides-when-empty",
  title: "Test fixture: hidden while empty",
  description:
    "Exists for the e2e suite: always empty, so it leaves the dashboard at rest.",
  category: "Fixtures",
  size: { default: { w: 6, h: 4 }, min: { w: 6, h: 4 } },
  hidesWhenEmpty: true,
  load: async () => ({ buckets: [] }),
  view: "bars",
});

/**
 * A card that is always the full twelve columns, drawn by a core display, so
 * the grid spec has a widget whose minimum is the whole row to draw in the
 * one-column band. A core display needs no component, so it is not in the
 * component map.
 */
const fullWidthWidget = defineWidget({
  id: "widget-kit-fixture/full-width",
  title: "Test fixture: full width",
  description: "Exists for the e2e suite: always the full twelve columns wide.",
  category: "Fixtures",
  size: { default: { w: 12, h: 2 }, min: { w: 12, h: 2 } },
  load: async () => ({ total: 12 }),
  view: "figure",
});

/**
 * A card whose data function throws on the server, drawn by a core display, so the spec can prove
 * that card shows its own error with Retry while the cards beside it draw. Its message names a
 * customer, which must never reach the reader.
 */
const loadThrowsWidget = defineWidget({
  id: "widget-kit-fixture/load-throws",
  title: "Test fixture: failing data",
  description:
    "Exists for the e2e suite: its data function throws; the error stays in its own card.",
  category: "Fixtures",
  size: { default: { w: 6, h: 2 }, min: { w: 6, h: 2 } },
  load: async (): Promise<{ total: number }> => {
    throw new Error("the row for customer 42 could not be read");
  },
  view: "figure",
});

/**
 * A card its widget never shows for anyone: off the dashboard at rest, and shown marked
 * "Not shown for you right now" in customise mode, where it can still be removed.
 */
const notShownWidget = defineWidget({
  id: "widget-kit-fixture/not-shown",
  title: "Test fixture: not shown",
  description:
    "Exists for the e2e suite: its widget says it is not shown for this person.",
  category: "Fixtures",
  size: { default: { w: 6, h: 2 }, min: { w: 6, h: 2 } },
  shows: () => false,
  load: async () => ({ total: 7 }),
  view: "figure",
});

/**
 * A card whose one setting, its collection, has no starting value: until its reader picks one it
 * answers that it needs it, and its empty state's button opens the card's settings to do so.
 */
const needsCollectionWidget = defineWidget({
  id: "widget-kit-fixture/needs-collection",
  title: "Test fixture: needs a collection",
  description:
    "Exists for the e2e suite: asks for its collection before it shows anything.",
  category: "Fixtures",
  size: { default: { w: 6, h: 2 }, min: { w: 6, h: 2 } },
  settings: { collection: widgetSettings.collection() },
  load: async ({ settings, services }) => ({
    total: await services.count(settings.collection),
  }),
  view: "figure",
});

export const widgetKitFixturePlugin = definePlugin({
  name: "widget-kit-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    dashboard: {
      widgets: [
        kitCardWidget,
        throwingCardWidget,
        hidesWhenEmptyWidget,
        fullWidthWidget,
        loadThrowsWidget,
        notShownWidget,
        needsCollectionWidget,
      ],
    },
  },
});
