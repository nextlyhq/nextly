import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";
import {
  publishedPluginPanel,
  reportPluginPanelWarnings,
} from "./plugin-panel";

/**
 * A standalone plugin `@acme/reports` (admin slug `acme-reports`) owning the
 * `reports` collection, an `overview` page and a `stale` attention item, with
 * the menu and groups a test gives it. A plain object rather than
 * `definePlugin`, whose module brings the runtime with it.
 */
function reportsPlugin(admin: object, extra: object = {}): PluginDefinition {
  return {
    name: "@acme/reports",
    version: "1.0.0",
    nextly: "*",
    admin: { placement: "standalone" },
    contributes: {
      collections: [{ slug: "reports" }],
      dashboard: { attention: [{ id: "acme/stale" }] },
      admin: {
        pages: [{ path: "overview", component: "@acme/reports/admin#Page" }],
        ...admin,
      },
    },
    ...extra,
  } as unknown as PluginDefinition;
}

describe("publishedPluginPanel", () => {
  it("names each thing it leaves out", () => {
    const panel = publishedPluginPanel(
      reportsPlugin({
        panel: {
          groups: [
            { id: "main", label: "Main" },
            { id: "main", label: "Again" },
          ],
        },
        menu: [
          { label: "Missing", to: "/admin/plugins/acme-reports/missing" },
          { label: "Lost", to: "/admin/collections/reports", group: "nope" },
          {
            label: "Posts",
            to: "/admin/collections/posts",
            count: { collection: "posts" },
          },
          {
            label: "Overdue",
            to: "/admin/plugins/acme-reports/overview",
            badge: { attention: "core/overdue-releases" },
          },
          {
            label: "Both",
            to: "/admin/collections/reports",
            count: { collection: "reports" },
            badge: { attention: "acme/stale" },
          },
          { label: "Neither", to: "/admin/collections/reports", count: {} },
          {
            label: "Parent",
            to: "/admin/collections/reports",
            children: [
              {
                label: "Child",
                to: "/admin/collections/reports?x=1",
                group: "main",
              },
            ],
          },
        ],
      })
    );
    expect(panel.problems.map(p => [p.kind, p.subject])).toEqual([
      ["panel-group-duplicate", "main"],
      ["panel-item-unregistered-page", "Missing"],
      ["panel-item-unknown-group", "Lost"],
      ["panel-count-unowned-collection", "Posts"],
      ["panel-count-undeclared-attention", "Overdue"],
      ["panel-item-count-and-badge", "Both"],
      ["panel-count-malformed", "Neither"],
      ["panel-child-panel-fields", "Child"],
    ]);
    expect(panel.groups).toEqual([{ id: "main", label: "Main" }]);
    expect(panel.menu.map(item => item.label)).toEqual([
      "Lost",
      "Posts",
      "Overdue",
      "Both",
      "Neither",
      "Parent",
    ]);
    for (const item of panel.menu) {
      expect(item.count).toBeUndefined();
      expect(item.badge).toBeUndefined();
      expect(item.group).toBeUndefined();
    }
    expect(panel.menu[5].children).toEqual([
      { label: "Child", to: "/admin/collections/reports?x=1" },
    ]);
  });

  it("reports nothing for a panel that names only what the plugin owns", () => {
    const panel = publishedPluginPanel(
      reportsPlugin({
        panel: { groups: [{ id: "main", label: "Main" }] },
        menu: [
          {
            label: "Reports",
            to: "/admin/collections/reports",
            group: "main",
            count: { collection: "reports" },
          },
          {
            label: "Overview",
            to: "/admin/plugins/acme-reports/overview",
            badge: { attention: "acme/stale" },
          },
        ],
      })
    );
    expect(panel.problems).toEqual([]);
    expect(panel.menu).toHaveLength(2);
  });
});

describe("reportPluginPanelWarnings", () => {
  const broken = reportsPlugin({
    menu: [
      { label: "Missing", to: "/admin/plugins/acme-reports/missing" },
      {
        label: "Posts",
        to: "/admin/collections/posts",
        count: { collection: "posts" },
      },
    ],
  });

  /** A host logger that keeps what it is told. */
  function hostLogger() {
    const lines: Array<{ message: string; meta?: Record<string, unknown> }> =
      [];
    return {
      lines,
      logger: {
        warn: (message: string, meta?: Record<string, unknown>) => {
          lines.push({ message, meta });
        },
      },
    };
  }

  it("reports to the host's logger in development, naming the plugin, the item and the value", () => {
    const { lines, logger } = hostLogger();
    reportPluginPanelWarnings([broken], "development", logger);
    expect(lines.map(line => line.meta)).toEqual([
      { kind: "panel-item-unregistered-page", plugin: "@acme/reports" },
      { kind: "panel-count-unowned-collection", plugin: "@acme/reports" },
    ]);
    expect(lines[0].message).toContain('Plugin "@acme/reports"');
    expect(lines[0].message).toContain('"Missing"');
    expect(lines[0].message).toContain("/admin/plugins/acme-reports/missing");
    expect(lines[1].message).toContain('collection "posts"');
  });

  it("is silent outside development", () => {
    const { lines, logger } = hostLogger();
    for (const env of ["production", "test", undefined]) {
      reportPluginPanelWarnings([broken], env, logger);
    }
    expect(lines).toEqual([]);
  });

  it("skips a disabled plugin, which draws no menu", () => {
    const { lines, logger } = hostLogger();
    const disabled = { ...broken, enabled: false } as PluginDefinition;
    reportPluginPanelWarnings([disabled], "development", logger);
    expect(lines).toEqual([]);
  });

  it("reports a badge read from an attention item that counts only hidden collections", () => {
    const plugin = reportsPlugin(
      {
        menu: [
          {
            label: "Stale",
            to: "/admin/plugins/acme-reports/overview",
            badge: { attention: "acme/stale" },
          },
        ],
      },
      {
        contributes: {
          // `internal` hides a collection as `admin.hidden` does.
          collections: [
            { slug: "reports", admin: { hidden: true } },
            { slug: "drafts", internal: true },
          ],
          dashboard: {
            attention: [
              { id: "acme/stale", collections: ["reports", "drafts"] },
            ],
          },
          admin: {
            pages: [{ path: "overview", component: "@acme/reports/admin#P" }],
            menu: [
              {
                label: "Stale",
                to: "/admin/plugins/acme-reports/overview",
                badge: { attention: "acme/stale" },
              },
            ],
          },
        },
      }
    );
    const { lines, logger } = hostLogger();
    reportPluginPanelWarnings([plugin], "development", logger);
    expect(lines.map(line => line.meta?.kind)).toEqual([
      "panel-count-attention-never-shown",
    ]);
    expect(lines[0].message).toContain('"acme/stale"');
    // Still sent: the number is read, and draws once the item can show.
    expect(publishedPluginPanel(plugin).menu[0].badge).toEqual({
      attention: "acme/stale",
    });
  });

  it("is silent for an attention item gated on a permission, or on a collection the dashboard lists", () => {
    const { lines, logger } = hostLogger();
    for (const gate of [
      { permission: "read-reports" },
      { collections: ["reports"] },
    ]) {
      const plugin = reportsPlugin(
        {
          menu: [
            {
              label: "Stale",
              to: "/admin/plugins/acme-reports/overview",
              badge: { attention: "acme/stale" },
            },
          ],
        },
        {}
      );
      (
        plugin.contributes as { dashboard: { attention: unknown[] } }
      ).dashboard.attention = [{ id: "acme/stale", ...gate }];
      reportPluginPanelWarnings([plugin], "development", logger);
    }
    expect(lines).toEqual([]);
  });
});
