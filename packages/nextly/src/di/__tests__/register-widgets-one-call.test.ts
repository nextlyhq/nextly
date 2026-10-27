/**
 * Every widget reaches the dashboard through one internal call: core's own
 * list, each plugin's `contributes.dashboard.widgets` and the site config's
 * `admin.dashboard.widgets`. Observed on the call itself, wrapped around the
 * real one, rather than reconstructed from what it registers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CORE_WIDGETS } from "../../domains/widgets/core-widgets";
import * as declaredWidgets from "../../domains/widgets/declaration/declared-widgets";
import { SITE_CONFIG } from "../../domains/widgets/declaration/site-dashboard";
import {
  dashboard,
  revenue,
} from "../../domains/widgets/declaration/__tests__/plugin/widgets";
import { getWidget, widgetSource } from "../../domains/widgets/registry";
import { definePlugin } from "../../plugins/plugin-context";
import { resetWidgetRegistries } from "../registrations/register-widgets";

vi.mock(
  "../../domains/widgets/declaration/declared-widgets",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../domains/widgets/declaration/declared-widgets")
      >();
    return {
      ...actual,
      registerDashboardWidgets: vi.fn(actual.registerDashboardWidgets),
    };
  }
);

const shop = definePlugin({
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard },
});

afterEach(() => {
  vi.mocked(declaredWidgets.registerDashboardWidgets).mockClear();
});

describe("the one call", () => {
  it("takes core's list, each plugin's widgets and the site's, in one call per boot", () => {
    const site = { ...revenue, id: "site/revenue" };
    resetWidgetRegistries([shop], { widgets: [site] });

    const call = vi.mocked(declaredWidgets.registerDashboardWidgets);
    expect(call).toHaveBeenCalledTimes(1);
    const [given] = call.mock.calls[0];
    expect(given.core).toBe(CORE_WIDGETS);
    expect(given.groups?.map(group => group.owner)).toEqual([
      'plugin "@acme/shop"',
    ]);
    expect(given.checkedOnly).toEqual([
      { owner: SITE_CONFIG, declarations: [site] },
    ]);
    // Through it, core's widgets reach the registry under core, and the
    // plugin's under the plugin.
    for (const widget of CORE_WIDGETS) {
      expect(widgetSource(widget.id), widget.id).toBe(
        declaredWidgets.CORE_OWNER
      );
    }
    expect(getWidget(revenue.id)).toBeDefined();
  });
});
