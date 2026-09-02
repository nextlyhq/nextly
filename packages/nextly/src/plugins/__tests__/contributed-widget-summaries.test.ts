/**
 * Which contributed widgets the server's canonical set admits.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";
import { contributedWidgetSummaries } from "../validate-admin-widgets";

function plugin(patch: Record<string, unknown>): PluginDefinition {
  return {
    name: "@acme/plugin",
    contributes: {
      admin: {
        widgets: [
          {
            id: "acme/latest",
            title: "Latest",
            archetype: "metric",
            query: { source: "collection:posts", op: "count" },
          },
        ],
      },
    },
    ...patch,
  } as unknown as PluginDefinition;
}

describe("contributed widget summaries", () => {
  it("includes a plugin with no `enabled` field", () => {
    // Absence means enabled — the reading admin-meta, reload-config and the
    // field-type registry each apply.
    expect(contributedWidgetSummaries([plugin({})]).map(w => w.id)).toEqual([
      "acme/latest",
    ]);
  });

  it("includes an explicitly enabled plugin", () => {
    expect(
      contributedWidgetSummaries([plugin({ enabled: true })]).map(w => w.id)
    ).toEqual(["acme/latest"]);
  });

  it("excludes a DISABLED plugin", () => {
    // 🔴 `buildPluginAdminMeta` withholds every behavioural admin surface from
    // a disabled plugin, so the admin has no declaration to draw one of its
    // widgets with. Admitting them here put ghost ids into default placements,
    // into `available` and into the scope token — cards the reader could
    // arrange and never see.
    expect(contributedWidgetSummaries([plugin({ enabled: false })])).toEqual(
      []
    );
  });

  it("keeps the enabled plugins when one of several is disabled", () => {
    const summaries = contributedWidgetSummaries([
      plugin({ enabled: false }),
      plugin({
        name: "@acme/other",
        enabled: true,
        contributes: {
          admin: {
            widgets: [
              {
                id: "acme/other",
                title: "Other",
                archetype: "metric",
                query: { source: "collection:pages", op: "count" },
              },
            ],
          },
        },
      }),
    ]);
    expect(summaries.map(w => w.id)).toEqual(["acme/other"]);
  });
});

describe("the size a contributed summary carries", () => {
  /** One contribution, with whatever size fields the case is about. */
  function sized(widget: Record<string, unknown>): PluginDefinition {
    return {
      name: "@acme/plugin",
      contributes: { admin: { widgets: [widget] } },
    } as unknown as PluginDefinition;
  }

  it("translates the DEPRECATED `size` alias, as the admin resolver does", () => {
    // 🔴 Reading `defaultSize` alone emitted a summary with no size for a
    // declaration that legally states only `size`. The default placement then
    // stored no geometry while the grid drew the card at half width, and a
    // later change to the plugin's declaration silently resized what the reader
    // had been told was their saved arrangement.
    expect(
      sizedSummary(
        sized({ id: "acme/w", title: "W", component: "acme#W", size: "half" })
      )
    ).toBe("lg");
  });

  it("translates the alias's other value too", () => {
    expect(
      sizedSummary(
        sized({ id: "acme/w", title: "W", component: "acme#W", size: "full" })
      )
    ).toBe("full");
  });

  it("prefers `defaultSize` where a plugin states both", () => {
    // A plugin that adopted the enum meant it, which is `resolveOne`'s rule.
    expect(
      sizedSummary(
        sized({
          id: "acme/w",
          title: "W",
          component: "acme#W",
          size: "half",
          defaultSize: "sm",
        })
      )
    ).toBe("sm");
  });

  it("states no size when the declaration states neither", () => {
    expect(
      sizedSummary(sized({ id: "acme/w", title: "W", component: "acme#W" }))
    ).toBeUndefined();
  });

  /** The one summary a single-widget plugin produces, reduced to its size. */
  function sizedSummary(plugin: PluginDefinition): string | undefined {
    const [summary] = contributedWidgetSummaries([plugin]);
    expect(summary).toBeDefined();
    return summary.defaultSize;
  }
});
