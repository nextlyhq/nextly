/**
 * A widget registered with an id a plugin also contributes is checked as the
 * one widget the admin draws from the two: the registration's query, beside its
 * settings or else the contribution's. Each declaration alone passes its own
 * door, so only the merged pair can show the fault.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { clearWidgets, registerWidget } from "../../domains/widgets/registry";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";
import {
  assertCollisionPairs,
  collisionPairFaults,
} from "../widget-collision-pairs";

const ID = "acme/orders-over-time";

/** A registration over a range, declaring no settings of its own. */
const ranged = {
  id: ID,
  title: "Orders over time",
  archetype: "custom" as const,
  component: "acme#OrdersOverTime",
  defaultSize: "md" as const,
  query: {
    source: "collection:posts",
    op: "timeseries" as const,
    dateField: "createdAt",
    range: "30d" as const,
  },
};

/** A plugin contributing the same id, with a count query and a `limit` setting. */
function contributing(settings: unknown[]): PluginDefinition {
  return {
    name: "@acme/shop",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      admin: {
        widgets: [
          {
            id: ID,
            title: "Orders",
            archetype: "custom",
            component: "acme#Orders",
            defaultSize: "md",
            query: { source: "collection:posts", op: "count" },
            settings,
          },
        ],
      },
    },
  } as unknown as PluginDefinition;
}

const limitSetting = { name: "limit", type: "number", label: "Limit" };

beforeEach(() => {
  clearWidgets();
});

describe("a widget registered over a plugin's contribution", () => {
  it("is refused when the merge puts the contribution's limit beside the registration's range", () => {
    // 🔴 Each alone is valid: the registration has no settings, and the
    // contribution's limit sits beside a count. Merged, the limit meets the
    // range, and every request the setting changed would be refused.
    registerWidget(ranged);
    const faults = collisionPairFaults([contributing([limitSetting])]);
    expect(faults).toEqual([
      {
        plugin: "@acme/shop",
        widget: ID,
        problem: expect.stringContaining(
          'declares a "limit" setting, and a query with a range'
        ),
      },
    ]);
    expect(() => assertCollisionPairs([contributing([limitSetting])])).toThrow(
      NextlyError
    );
  });

  it("is checked with the registration's own settings where it declares them", () => {
    // The merge keeps a registration's settings over the contribution's, so a
    // registration declaring its own, none of them a limit, is fine.
    registerWidget({
      ...ranged,
      settings: [{ name: "note", type: "text", label: "Note" }],
    });
    expect(collisionPairFaults([contributing([limitSetting])])).toEqual([]);
  });

  it("names nothing where no registration shares a contributed id", () => {
    // The control: the same contribution with nothing registered over it.
    registerWidget({ ...ranged, id: "acme/elsewhere" });
    expect(collisionPairFaults([contributing([limitSetting])])).toEqual([]);
  });
});
