/**
 * A fixture plugin for the e2e suite: two widgets declared with `defineWidget`
 * and drawn by their own components, so e2e/tests/plugin-widget-kit.spec.ts can
 * prove a plugin card built only from `@nextlyhq/plugin-sdk/admin`'s widget kit
 * draws beside core's in light and dark, and that a component throwing while it
 * draws is that card's error alone.
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
  widths: ["half", "full"],
  width: "half",
  data: async () => ({
    total: 1234,
    groups: [
      { key: "open", label: "Open", count: 3, value: "open" },
      { key: "paid", label: "Paid", count: 5, value: "paid" },
    ],
  }),
  display: { component: KIT_CARD_COMPONENT },
});

/** A card whose component throws while it draws. */
const throwingCardWidget = defineWidget({
  id: "widget-kit-fixture/throws",
  title: "Test fixture: throwing card",
  description:
    "Exists for the e2e suite: its component throws; the error stays in its own card.",
  category: "Fixtures",
  widths: ["half", "full"],
  width: "half",
  data: async () => ({ total: 0 }),
  display: { component: THROWING_CARD_COMPONENT },
});

export const widgetKitFixturePlugin = definePlugin({
  name: "widget-kit-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    dashboard: { widgets: [kitCardWidget, throwingCardWidget] },
  },
});
