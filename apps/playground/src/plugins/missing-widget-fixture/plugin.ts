/**
 * A fixture plugin that declares one dashboard widget drawn by a component the
 * playground's committed component map does not include, so the e2e suite can
 * prove the admin is refused, naming the plugin, the widget and the fix, while
 * the public site keeps serving.
 *
 * Off unless `NEXTLY_E2E_MISSING_WIDGET=1`: with it on the admin cannot be
 * served at all, by design. The component is never built, and nothing imports
 * its module; the refusal happens before anything would try.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { defineWidget } from "nextly";

/** The component the map is missing, as the refusal names it. */
export const MISSING_WIDGET_COMPONENT =
  "@nextly-e2e/missing-widget-fixture/admin#NeverBuilt";

export const missingWidgetFixturePlugin = definePlugin({
  name: "missing-widget-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    dashboard: {
      widgets: [
        defineWidget({
          id: "missing-widget-fixture/never-built",
          title: "Never built",
          description: "Draws with a component the map does not include",
          category: "Fixtures",
          widths: ["full"],
          width: "full",
          data: async () => ({ total: 0 }),
          display: { component: MISSING_WIDGET_COMPONENT },
        }),
      ],
    },
  },
});
