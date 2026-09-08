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

/**
 * The gate a contribution declares, as the summary carries it.
 *
 * 🔴 This is the channel that FAILED OPEN. Boot validates a contribution with
 * the same `widgetValueProblem` that accepts an any-of array, so a plugin
 * declaring one registers cleanly -- but the summary layout resolution reads is
 * built by a separate reader, and that reader took strings only. It answered
 * `undefined` for the array, which this summary spells as "no gate", so
 * `holdsWidgetPermission` returned true and the layout endpoint published the
 * card's id and default placement to every authenticated reader.
 *
 * The symptom was invisible from the product: the browser hid the card, so the
 * only thing anyone could notice was a card MISSING for someone entitled to it,
 * while the disclosure had already happened on the wire. Asserted on the
 * summary rather than on the endpoint, because the summary is where the value
 * was lost and an endpoint test would go green the moment either half was
 * repaired.
 */
describe("a contributed permission gate survives the summary", () => {
  function gated(requiredPermission: unknown): PluginDefinition {
    return {
      name: "@acme/plugin",
      contributes: {
        admin: {
          widgets: [
            {
              id: "acme/latest",
              title: "Latest",
              archetype: "metric",
              requiredPermission,
              query: { source: "collection:posts", op: "count" },
            },
          ],
        },
      },
    } as unknown as PluginDefinition;
  }

  it("carries a single slug", () => {
    // The control. A summary that dropped EVERY gate would satisfy nothing
    // below by carrying nothing, so the string form has to be seen arriving
    // before the array's arrival means anything.
    expect(contributedWidgetSummaries([gated("read-posts")])[0]).toMatchObject({
      requiredPermission: "read-posts",
    });
  });

  it("carries an any-of array", () => {
    expect(
      contributedWidgetSummaries([gated(["read-posts", "create-posts"])])[0]
    ).toMatchObject({ requiredPermission: ["read-posts", "create-posts"] });
  });

  /*
   * A gate that is PRESENT AND UNUSABLE refuses the whole plugin at boot, which
   * is stronger than carrying it forward and was worth measuring rather than
   * assuming: an unusable value that reached the summary would still be refused
   * by `holdsWidgetPermission`, but refusing at boot puts the error in front of
   * the person who wrote the declaration instead of silently hiding a card.
   *
   * The empty array is the member of this set most likely to be written on
   * purpose, and it is the one whose plain reading is backwards -- "any of
   * nothing" is satisfied by nobody, so admitting it would gate the card for
   * everyone while looking like a widened grant.
   */
  it.each([
    ["an empty array", []],
    ["an array with a non-slug", ["read-posts", 7]],
    ["an object", { read: true }],
  ])("refuses the plugin over %s", (_label, requiredPermission) => {
    expect(() =>
      contributedWidgetSummaries([gated(requiredPermission)])
    ).toThrow(/Plugin configuration is invalid/);
  });

  it("declares no gate when the contribution omits one", () => {
    const summary = contributedWidgetSummaries([
      {
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
      } as unknown as PluginDefinition,
    ])[0];

    expect(Object.hasOwn(summary as object, "requiredPermission")).toBe(false);
  });
});
