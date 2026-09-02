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
